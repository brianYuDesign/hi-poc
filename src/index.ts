import { config } from './config';
import logger from './utils/logger';
import { closeDBPool } from './db/connection';
import { closeRedisClient } from './cache/redis';
import { closeKafkaProducer } from './utils/kafka';

// 优雅关闭处理
async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown...`);

  try {
    // 关闭 Kafka Producer
    await closeKafkaProducer();

    // 关闭 Redis
    await closeRedisClient();

    // 关闭数据库连接池
    await closeDBPool();

    logger.info('Graceful shutdown completed');
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

logger.info('Balance System starting...');
logger.info(`Environment: ${config.nodeEnv}`);

// 启动 Prometheus 指标服务器
if (config.monitoring.enableMetrics) {
  const { getMetrics } = require('./utils/metrics');
  const metrics = getMetrics();
  metrics.start();
  logger.info('Prometheus metrics server started');
}

// 启动 REST API Server
if (process.env.START_API !== 'false') {
  const { getRESTServer } = require('./api/rest/server');
  const restServer = getRESTServer();
  restServer.start();
  logger.info('REST API Server started');
}

// 启动 Consumer
if (process.env.START_CONSUMER !== 'false') {
  const { getBatchConsumer } = require('./consumer/batch-consumer');
  const { getLeaderElection, enableLeaderElection } = require('./services/leader-election');
  
  const leaderElection = getLeaderElection();
  const consumer = getBatchConsumer();
  
  // 尝试获取 Leader Lock
  leaderElection.acquireLock().then((acquired: boolean) => {
    if (acquired) {
      leaderElection.startRenewal();
      enableLeaderElection(); // 标记 leader election 已启用
      consumer.start();
      logger.info('Consumer started as leader');
    } else {
      logger.info('Consumer started as follower (waiting for leader)');
      // 定期尝试获取锁
      const retryInterval = setInterval(async () => {
        const acquired = await leaderElection.acquireLock();
        if (acquired) {
          clearInterval(retryInterval);
          leaderElection.startRenewal();
          enableLeaderElection(); // 标记 leader election 已启用
          consumer.start();
          logger.info('Consumer promoted to leader');
        }
      }, 5000);
    }
  });
}

// 启动 Redis Updater Worker
if (process.env.START_REDIS_UPDATER !== 'false') {
  const { getRedisUpdaterPool } = require('./workers/redis-updater');
  const redisUpdater = getRedisUpdaterPool();
  redisUpdater.start(config.redisUpdater.updateInterval);
  logger.info('Redis Updater Worker started');
}

logger.info('Balance System started successfully');
