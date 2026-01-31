import { getDBPool } from '../db/connection';
import { ensureProducerConnected } from '../utils/kafka';
import { generateEventId } from '../utils/hmac';
import { config } from '../config';
import logger from '../utils/logger';
import { BalanceChangeRequest, OutboxStatus } from '../types';

/**
 * Outbox Pattern Service
 * 保证消息至少发送一次，防止重复发送
 */
export class OutboxService {
  /**
   * 创建余额变更请求（Outbox Pattern）
   * 1. 写入 DB (outbox_events, unique index)
   * 2. 提交事务
   * 3. 异步发送到 Kafka
   * 4. 更新状态
   */
  async createBalanceChange(request: BalanceChangeRequest): Promise<string> {
    const eventId = generateEventId();
    const pool = getDBPool();

    try {
      // 1. 写入 outbox_events (unique index 防止重复)
      await pool.query(
        `INSERT INTO outbox_events 
         (event_id, topic, partition_key, payload, status)
         VALUES (?, ?, ?, ?, ?)`,
        [
          eventId,
          config.kafka.topics.balanceChanges,
          request.userId, // partition key
          JSON.stringify(request),
          OutboxStatus.PENDING,
        ]
      );

      logger.info('Outbox event created', {
        eventId,
        transactionId: request.transactionId,
        userId: request.userId,
      });

      // 记录指标
      const { metrics } = await import('../utils/metrics');
      metrics.incrementCounter('balance_outbox_events_created_total');

      // 2. 异步发送到 Kafka（不阻塞）
      this.sendToKafka(eventId, request).catch((error) => {
        logger.error('Failed to send to Kafka', {
          eventId,
          error: error instanceof Error ? error.message : String(error),
        });
      });

      return eventId;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 检查是否是重复事件（unique index 冲突）
      if (errorMessage.includes('Duplicate entry') || errorMessage.includes('UNIQUE constraint')) {
        logger.warn('Duplicate event detected', {
          eventId,
          transactionId: request.transactionId,
        });
        throw new Error(`Duplicate event: ${request.transactionId}`);
      }

      logger.error('Failed to create outbox event', {
        eventId,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * 发送事件到 Kafka
   */
  private async sendToKafka(
    eventId: string,
    request: BalanceChangeRequest
  ): Promise<void> {
    const producer = await ensureProducerConnected();
    const pool = getDBPool();

    try {
      // 发送到 Kafka
      await producer.send({
        topic: config.kafka.topics.balanceChanges,
        messages: [
          {
            key: request.userId, // partition key
            value: JSON.stringify(request),
            headers: {
              eventId,
              transactionId: request.transactionId,
            },
          },
        ],
      });

      // 更新状态为 SENT
      await pool.query(
        `UPDATE outbox_events 
         SET status = ?, sent_at = NOW()
         WHERE event_id = ?`,
        [OutboxStatus.SENT, eventId]
      );

      logger.info('Event sent to Kafka', {
        eventId,
        topic: config.kafka.topics.balanceChanges,
        partitionKey: request.userId,
      });
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 更新状态为 FAILED
      await pool.query(
        `UPDATE outbox_events 
         SET status = ?, error_message = ?
         WHERE event_id = ?`,
        [OutboxStatus.FAILED, errorMessage, eventId]
      );

      logger.error('Failed to send event to Kafka', {
        eventId,
        error: errorMessage,
      });
      throw error;
    }
  }

  /**
   * 重试发送失败的事件
   */
  async retryFailedEvents(limit: number = 100): Promise<number> {
    const pool = getDBPool();
    const producer = await ensureProducerConnected();

    try {
      // 查询失败的事件
      const [rows] = (await pool.query(
        `SELECT event_id, topic, partition_key, payload, retry_count
         FROM outbox_events
         WHERE status = ?
         ORDER BY created_at ASC
         LIMIT ?`,
        [OutboxStatus.FAILED, limit]
      )) as [Array<{
        event_id: string;
        topic: string;
        partition_key: string;
        payload: string;
        retry_count: number;
      }>, unknown];

      let successCount = 0;

      for (const event of rows) {
        try {
          const request: BalanceChangeRequest = JSON.parse(event.payload);

          // 发送到 Kafka
          await producer.send({
            topic: event.topic,
            messages: [
              {
                key: event.partition_key,
                value: event.payload,
                headers: {
                  eventId: event.event_id,
                  transactionId: request.transactionId,
                },
              },
            ],
          });

          // 更新状态
          await pool.query(
            `UPDATE outbox_events 
             SET status = ?, sent_at = NOW(), retry_count = retry_count + 1
             WHERE event_id = ?`,
            [OutboxStatus.SENT, event.event_id]
          );

          successCount++;
        } catch (error: unknown) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          
          // 增加重试次数
          await pool.query(
            `UPDATE outbox_events 
             SET retry_count = retry_count + 1, error_message = ?
             WHERE event_id = ?`,
            [errorMessage, event.event_id]
          );

          logger.warn('Retry failed', {
            eventId: event.event_id,
            error: errorMessage,
          });
        }
      }

      logger.info('Retry completed', {
        total: rows.length,
        success: successCount,
        failed: rows.length - successCount,
      });

      return successCount;
    } catch (error: unknown) {
      logger.error('Failed to retry events', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 获取待发送的事件数量
   */
  async getPendingEventCount(): Promise<number> {
    const pool = getDBPool();

    try {
      const [rows] = (await pool.query(
        `SELECT COUNT(*) as count
         FROM outbox_events
         WHERE status = ?`,
        [OutboxStatus.PENDING]
      )) as [Array<{ count: number }>, unknown];

      return rows[0]?.count || 0;
    } catch (error: unknown) {
      logger.error('Failed to get pending event count', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }
}

// 单例实例
let outboxServiceInstance: OutboxService | null = null;

export function getOutboxService(): OutboxService {
  if (!outboxServiceInstance) {
    outboxServiceInstance = new OutboxService();
  }
  return outboxServiceInstance;
}
