import { Consumer } from 'kafkajs';
import { createKafkaConsumer } from '../utils/kafka';
import { getBalanceService } from '../services/balance';
import { getMySQLBatchWriter } from '../services/mysql-writer';
import { getErrorHandler } from '../utils/error-handler';
import { getBalanceCache } from '../cache/memory';
import { config } from '../config';
import logger from '../utils/logger';
import { BalanceChangeRequest, KafkaMessage, TransactionStatus } from '../types';
import Decimal from 'decimal.js';

/**
 * Batch Consumer
 * 批次处理 Kafka 消息，实现高吞吐量
 */
export class BatchConsumer {
  private consumer: Consumer | null = null;
  private running = false;
  private retryMap: Map<string, number> = new Map(); // transactionId -> retryCount

  /**
   * 启动 Consumer
   */
  async start(): Promise<void> {
    if (this.running) {
      logger.warn('Consumer is already running, skipping start');
      return;
    }

    // 如果已有 consumer 实例，先断开
    if (this.consumer) {
      logger.warn('Consumer already exists, disconnecting first');
      try {
        await this.consumer.disconnect();
      } catch (error) {
        // 忽略断开连接错误
        logger.debug('Error disconnecting existing consumer', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      this.consumer = null;
    }

    this.consumer = await createKafkaConsumer();
    await this.consumer.subscribe({
      topic: config.kafka.topics.balanceChanges,
      fromBeginning: true, // 确保消费所有消息（包括重启前的消息）
    });

    this.running = true;
    logger.info('Batch Consumer started', {
      topic: config.kafka.topics.balanceChanges,
      consumerGroup: config.kafka.consumerGroup,
    });

    // 启动消费循环（只启动一次）
    this.pollLoop().catch((error) => {
      logger.error('Consumer loop error', {
        error: error instanceof Error ? error.message : String(error),
      });
      this.running = false;
    });
  }

  /**
   * 动态 poll timeout 策略的消费循环
   * 使用 eachBatch 实现批次处理
   */
  private async pollLoop(): Promise<void> {
    if (!this.consumer || !this.running) {
      return;
    }

    try {
      // consumer.run() 是阻塞调用，只调用一次
      await this.consumer.run({
        eachBatch: async ({ batch, resolveOffset, heartbeat }) => {
          if (!this.running) {
            return;
          }

          const messages = batch.messages.map((msg) => ({
            key: msg.key,
            value: msg.value,
            timestamp: msg.timestamp,
            attributes: msg.attributes,
            offset: msg.offset,
            size: msg.size,
            headers: msg.headers as Record<string, Buffer | string | Buffer[] | undefined> | undefined,
          }));

          // 达到批次大小或批次结束，处理消息
          if (messages.length > 0) {
            await this.processBatch(messages, batch.partition);
            batch.messages.forEach((msg) => resolveOffset(msg.offset));
            await heartbeat();
          }
        },
      });
    } catch (error: unknown) {
      if (this.running) {
        logger.error('Consumer run error', {
          error: error instanceof Error ? error.message : String(error),
        });
        // 如果还在运行状态，延迟后重试
        await new Promise((resolve) => setTimeout(resolve, 1000));
        if (this.running) {
          // 递归重试
          this.pollLoop().catch((retryError) => {
            logger.error('Consumer retry error', {
              error: retryError instanceof Error ? retryError.message : String(retryError),
            });
            this.running = false;
          });
        }
      }
    }
  }

  /**
   * 处理批次消息
   */
  private async processBatch(
    messages: Array<{
      key: Buffer | null;
      value: Buffer | null;
      timestamp: string;
      attributes: number;
      offset: string;
      size?: number;
      headers?: Record<string, Buffer | string | Buffer[] | undefined>;
    }>,
    partition: number
  ): Promise<void> {
    if (messages.length === 0) {
      return;
    }

    const startTime = Date.now();
    const balanceService = getBalanceService();
    const mysqlWriter = getMySQLBatchWriter();
    const errorHandler = getErrorHandler();

    // 1. 解析消息并去重（幂等性检查）
    const uniqueRequests = await this.deduplicateMessages(messages);

    if (uniqueRequests.length === 0) {
      logger.debug('All messages are duplicates, skipping batch');
      return;
    }

    // 2. 处理余额更新
    const updates: Array<{
      request: BalanceChangeRequest;
      availableBefore: Decimal;
      availableAfter: Decimal;
      frozenBefore: Decimal;
      frozenAfter: Decimal;
      status: TransactionStatus;
    }> = [];

    for (const request of uniqueRequests) {
      try {
        const result = await balanceService.updateBalance(request);
        
        updates.push({
          request,
          availableBefore: result.availableBefore,
          availableAfter: result.availableAfter,
          frozenBefore: result.frozenBefore,
          frozenAfter: result.frozenAfter,
          status: result.success ? TransactionStatus.SUCCESS : TransactionStatus.FAILED,
        });

        // 清除重试计数
        this.retryMap.delete(request.transactionId);
      } catch (error: unknown) {
        const errorObj = error instanceof Error ? error : new Error(String(error));
        
        // 处理错误（重试或 DLQ）
        const matchingMessage = messages.find((m) => {
          try {
            const msgValue = m.value?.toString() || '';
            return msgValue === JSON.stringify(request);
          } catch {
            return false;
          }
        });
        
        const kafkaMessage: KafkaMessage = {
          key: request.userId,
          value: JSON.stringify(request),
          headers: matchingMessage?.headers 
            ? (Object.fromEntries(
                Object.entries(matchingMessage.headers)
                  .filter(([_, v]) => v !== undefined)
                  .map(([k, v]) => {
                    let value: string;
                    if (typeof v === 'string') {
                      value = v;
                    } else if (Buffer.isBuffer(v)) {
                      value = v.toString();
                    } else if (Array.isArray(v)) {
                      value = v.map(x => Buffer.isBuffer(x) ? x.toString() : String(x)).join(',');
                    } else {
                      value = String(v);
                    }
                    return [k, value];
                  })
              ) as Record<string, string>)
            : undefined,
          partition: partition,
          offset: matchingMessage?.offset || '',
        };

        const retryCount = this.retryMap.get(request.transactionId) || 0;
        const retryResult = await errorHandler.handleError(kafkaMessage, errorObj, retryCount);

        if (retryResult.shouldRetry) {
          this.retryMap.set(request.transactionId, retryCount + 1);
          logger.warn('Message will be retried', {
            transactionId: request.transactionId,
            retryCount: retryCount + 1,
          });
        } else {
          // 发送到 DLQ，记录失败
          updates.push({
            request,
            availableBefore: new Decimal(0),
            availableAfter: new Decimal(0),
            frozenBefore: new Decimal(0),
            frozenAfter: new Decimal(0),
            status: TransactionStatus.FAILED,
          });
        }
      }
    }

    // 3. 批量写入 MySQL
    if (updates.length > 0) {
      try {
        // 检查 Leader Lock（在事务中）- 仅在有 leader election 时检查
        const { getLeaderElection, isLeaderElectionEnabled } = await import('../services/leader-election');
        
        let leaderCheckCallback: ((connection: any) => Promise<void>) | undefined;
        
        if (isLeaderElectionEnabled()) {
          const leaderElection = getLeaderElection();
          leaderCheckCallback = async (connection) => {
            // 在事务中检查 Leader Lock
            const isLeader = await leaderElection.checkLockInTransaction(connection);
            if (!isLeader) {
              throw new Error('Lost leader lock during transaction');
            }
          };
        }
        
        await mysqlWriter.batchWriteBalanceUpdates(updates, leaderCheckCallback);
        
        // 4. 异步更新 Redis（不阻塞）
        const { getRedisUpdaterPool } = await import('../workers/redis-updater');
        const redisUpdater = getRedisUpdaterPool();
        
        for (const update of updates) {
          if (update.status === TransactionStatus.SUCCESS) {
            // 从缓存获取最新余额
            const cache = getBalanceCache();
            const balance = cache.get(update.request.accountId, update.request.currencyCode);
            if (balance) {
              redisUpdater.enqueue(update.request.accountId, update.request.currencyCode, balance);
            }
          }
        }
      } catch (error: unknown) {
        logger.error('Failed to batch write to MySQL', {
          count: updates.length,
          error: error instanceof Error ? error.message : String(error),
        });
        // 不抛出错误，避免阻塞消费
      }
    }

    const duration = Date.now() - startTime;
    
    // 记录指标
    const { metrics } = await import('../utils/metrics');
    metrics.observeHistogram('balance_consumer_batch_duration_ms', duration, { partition: partition.toString() });
    metrics.incrementCounter('balance_consumer_batches_total', { partition: partition.toString() });
    metrics.setGauge('balance_consumer_batch_size', messages.length, { partition: partition.toString() });
    metrics.incrementCounter('balance_consumer_success_total', { partition: partition.toString() }, 
      updates.filter((u) => u.status === TransactionStatus.SUCCESS).length);
    metrics.incrementCounter('balance_consumer_failed_total', { partition: partition.toString() }, 
      updates.filter((u) => u.status === TransactionStatus.FAILED).length);
    
    logger.info('Batch processed', {
      total: messages.length,
      unique: uniqueRequests.length,
      success: updates.filter((u) => u.status === TransactionStatus.SUCCESS).length,
      failed: updates.filter((u) => u.status === TransactionStatus.FAILED).length,
      duration,
    });
  }

  /**
   * 消息去重（幂等性检查）
   */
  private async deduplicateMessages(
    messages: Array<{
      key: Buffer | null;
      value: Buffer | null;
      timestamp: string;
      attributes: number;
      offset: string;
      size?: number;
      headers?: Record<string, Buffer | string | Buffer[] | undefined>;
    }>
  ): Promise<BalanceChangeRequest[]> {
    const pool = (await import('../db/connection')).getDBPool();
    const uniqueRequests: BalanceChangeRequest[] = [];
    const transactionIds = new Set<string>();

    // 解析消息
    const requests: BalanceChangeRequest[] = [];
    for (const message of messages) {
      try {
        const messageValue = message.value?.toString() || '{}';
        const request: BalanceChangeRequest = JSON.parse(messageValue);
        
        // 转换 amount 为 Decimal
        if (typeof request.amount === 'string' || typeof request.amount === 'number') {
          request.amount = new Decimal(request.amount);
        }
        
        requests.push(request);
        transactionIds.add(request.transactionId);
      } catch (error: unknown) {
        logger.warn('Failed to parse message', {
          error: error instanceof Error ? error.message : String(error),
          offset: message.offset,
        });
      }
    }

    if (transactionIds.size === 0) {
      return [];
    }

    // 检查数据库中已处理的交易
    const placeholders = Array.from(transactionIds).map(() => '?').join(',');
    const [rows] = (await pool.query(
      `SELECT transaction_id 
       FROM balance_transactions 
       WHERE transaction_id IN (${placeholders}) 
         AND status != ?`,
      [...Array.from(transactionIds), TransactionStatus.INIT]
    )) as [Array<{ transaction_id: string }>, unknown];

    const processedIds = new Set(rows.map((row) => row.transaction_id));

    // 过滤已处理的交易
    for (const request of requests) {
      if (!processedIds.has(request.transactionId)) {
        uniqueRequests.push(request);
      } else {
        logger.debug('Duplicate transaction skipped', {
          transactionId: request.transactionId,
        });
      }
    }

    return uniqueRequests;
  }

  /**
   * 停止 Consumer
   */
  async stop(): Promise<void> {
    this.running = false;
    
    if (this.consumer) {
      await this.consumer.disconnect();
      this.consumer = null;
    }

    logger.info('Batch Consumer stopped');
  }
}

// 单例实例
let batchConsumerInstance: BatchConsumer | null = null;

export function getBatchConsumer(): BatchConsumer {
  if (!batchConsumerInstance) {
    batchConsumerInstance = new BatchConsumer();
  }
  return batchConsumerInstance;
}
