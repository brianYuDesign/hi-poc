/**
 * Redis Updater 独立入口文件
 * 仅在需要将 Redis Updater 作为独立进程运行时使用
 */

import { config } from '../config';
import logger from '../utils/logger';
import { getRedisUpdaterPool } from './redis-updater';
import { closeRedisClient } from '../cache/redis';

// 优雅关闭处理
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    const redisUpdater = getRedisUpdaterPool();
    redisUpdater.stop();

    await closeRedisClient();

    logger.info('Redis Updater shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown:', error);
    process.exit(1);
  }
}

// 注册信号处理器
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// 未捕获的异常处理
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception:', error);
  gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
  logger.error('Unhandled rejection at:', promise, 'reason:', reason);
  gracefulShutdown('unhandledRejection');
});

// 启动 Redis Updater
logger.info('Redis Updater starting...');
logger.info(`Environment: ${config.nodeEnv}`);

try {
  const redisUpdater = getRedisUpdaterPool();
  redisUpdater.start(config.redisUpdater.updateInterval);
  logger.info('Redis Updater started successfully');
} catch (error) {
  logger.error('Failed to start Redis Updater', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}
