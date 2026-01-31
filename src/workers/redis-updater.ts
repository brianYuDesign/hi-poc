import { Worker, isMainThread, parentPort } from 'worker_threads';
import { batchUpdateBalances } from '../cache/redis';
import { getBalanceCache } from '../cache/memory';
import { Balance } from '../types';
import logger from '../utils/logger';

/**
 * Redis Updater Worker
 * 使用 Worker Threads 更新 Redis 快照
 */

// Worker 线程代码
if (!isMainThread && parentPort) {
  parentPort.on('message', async (updates: Array<{
    accountId: number;
    currencyCode: string;
    balance: Balance;
  }>) => {
    try {
      // 准备更新数据
      const redisUpdates = updates.map((update) => ({
        accountId: update.accountId,
        currencyCode: update.currencyCode,
        balance: JSON.stringify({
          available: update.balance.available.toString(),
          frozen: update.balance.frozen.toString(),
          version: update.balance.version,
        }),
        timestamp: update.balance.updatedAt,
      }));

      // 批量更新 Redis
      const successCount = await batchUpdateBalances(redisUpdates);

      // 发送结果回主线程
      parentPort?.postMessage({
        success: true,
        processed: updates.length,
        updated: successCount,
      });
    } catch (error: unknown) {
      logger.error('Redis updater worker error', {
        error: error instanceof Error ? error.message : String(error),
      });

      parentPort?.postMessage({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

// 主线程代码
export class RedisUpdaterPool {
  private workers: Worker[] = [];
  private workerCount: number;
  private updateQueue: Array<{
    accountId: number;
    currencyCode: string;
    balance: Balance;
  }> = [];
  private updateInterval: NodeJS.Timeout | null = null;

  constructor(workerCount: number = 4) {
    this.workerCount = workerCount;
    this.initializeWorkers();
  }

  /**
   * 初始化 Worker Threads
   */
  private initializeWorkers(): void {
    // Worker Threads 在开发环境无法直接加载 TypeScript
    // 在开发环境，我们使用编译后的文件（如果存在）或跳过 Worker
    const fs = require('fs');
    const path = require('path');
    
    let workerPath: string;
    
    if (process.env.NODE_ENV === 'production') {
      // 生产环境：使用编译后的 JavaScript 文件
      workerPath = __filename.replace(/\.ts$/, '.js');
    } else {
      // 开发环境：尝试使用编译后的文件
      const compiledPath = path.join(__dirname, 'redis-updater.js');
      if (fs.existsSync(compiledPath)) {
        workerPath = compiledPath;
      } else {
        // 如果编译文件不存在，记录警告但不创建 Worker
        logger.warn('Redis Updater Worker: Compiled JS file not found. Workers will not be initialized in development mode. Run "npm run build" first or set START_REDIS_UPDATER=false.');
        return;
      }
    }

    for (let i = 0; i < this.workerCount; i++) {
      // 在开发环境，使用 tsx 运行 TypeScript
      const execArgv = process.env.NODE_ENV !== 'production' && workerPath.endsWith('.ts')
        ? ['--loader', 'tsx/esm']
        : [];
      
      const worker = new Worker(workerPath, {
        workerData: { workerId: i },
        execArgv,
      });

      worker.on('message', (result) => {
        if (!result.success) {
          logger.error('Worker update failed', {
            workerId: i,
            error: result.error,
          });
        } else {
          logger.debug('Worker update completed', {
            workerId: i,
            processed: result.processed,
            updated: result.updated,
          });
        }
      });

      worker.on('error', (error) => {
        logger.error('Worker error', {
          workerId: i,
          error: error.message,
        });
      });

      worker.on('exit', (code) => {
        if (code !== 0) {
          logger.warn('Worker exited', {
            workerId: i,
            code,
          });
        }
      });

      this.workers.push(worker);
    }

    logger.info('Redis updater workers initialized', {
      workerCount: this.workerCount,
    });
  }

  /**
   * 将余额更新加入队列
   */
  enqueue(accountId: number, currencyCode: string, balance: Balance): void {
    this.updateQueue.push({
      accountId,
      currencyCode,
      balance,
    });
  }

  /**
   * 批量将余额更新加入队列
   */
  batchEnqueue(updates: Array<{ accountId: number; currencyCode: string; balance: Balance }>): void {
    this.updateQueue.push(...updates);
  }

  /**
   * 启动定期更新
   */
  start(interval: number = 100): void {
    if (this.updateInterval) {
      return;
    }

    this.updateInterval = setInterval(() => {
      this.flush();
    }, interval);

    logger.info('Redis updater started', {
      interval,
    });
  }

  /**
   * 停止定期更新
   */
  stop(): void {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    // 刷新剩余更新
    this.flush();

    // 关闭所有 workers
    this.workers.forEach((worker) => {
      worker.terminate();
    });

    logger.info('Redis updater stopped');
  }

  /**
   * 刷新队列，分发到 workers
   */
  private flush(): void {
    if (this.updateQueue.length === 0) {
      return;
    }

    // 按 shard_id 分组（简化实现，使用 accountId 取模）
    const shardedUpdates: Array<Array<{
      accountId: number;
      currencyCode: string;
      balance: Balance;
    }>> = Array.from({ length: this.workerCount }, () => []);

    for (const update of this.updateQueue) {
      const shardIndex = update.accountId % this.workerCount;
      shardedUpdates[shardIndex].push(update);
    }

    // 清空队列
    this.updateQueue = [];

    // 分发到 workers
    for (let i = 0; i < this.workers.length; i++) {
      if (shardedUpdates[i].length > 0) {
        this.workers[i].postMessage(shardedUpdates[i]);
      }
    }
  }

  /**
   * 从内存缓存同步所有余额到 Redis
   */
  async syncAllFromCache(): Promise<number> {
    const cache = getBalanceCache();
    const allBalances = cache.getAll();

    if (allBalances.length === 0) {
      return 0;
    }

    // 准备更新数据
    const updates = allBalances.map((balance) => ({
      accountId: balance.accountId,
      currencyCode: balance.currencyCode,
      balance,
    }));

    // 批量更新
    this.batchEnqueue(updates);
    this.flush();

    logger.info('Synced all balances from cache to Redis', {
      count: allBalances.length,
    });

    return allBalances.length;
  }
}

// 单例实例
let redisUpdaterPoolInstance: RedisUpdaterPool | null = null;

export function getRedisUpdaterPool(): RedisUpdaterPool {
  if (!redisUpdaterPoolInstance) {
    const workerCount = require('../config').config.redisUpdater.workerCount;
    redisUpdaterPoolInstance = new RedisUpdaterPool(workerCount);
  }
  return redisUpdaterPoolInstance;
}
