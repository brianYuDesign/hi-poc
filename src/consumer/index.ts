import { getBatchConsumer } from './batch-consumer';
import logger from '../utils/logger';
import { getKafkaProducer } from '../utils/kafka';

/**
 * Consumer 启动入口
 */
async function main() {
  try {
    // 初始化 Kafka Producer（确保连接）
    const producer = getKafkaProducer();
    await producer.connect();
    logger.info('Kafka Producer connected');

    // 启动 Batch Consumer
    const consumer = getBatchConsumer();
    await consumer.start();

    logger.info('Consumer started successfully');
  } catch (error: unknown) {
    logger.error('Failed to start consumer', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  }
}

// 优雅关闭
process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down consumer...');
  const consumer = getBatchConsumer();
  await consumer.stop();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down consumer...');
  const consumer = getBatchConsumer();
  await consumer.stop();
  process.exit(0);
});

// 启动
if (require.main === module) {
  main().catch((error) => {
    logger.error('Fatal error', {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exit(1);
  });
}

export { main };
