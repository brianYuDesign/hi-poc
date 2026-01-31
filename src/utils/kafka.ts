import { Kafka, Producer, Consumer } from 'kafkajs';
import { config } from '../config';

let kafkaInstance: Kafka | null = null;
let producerInstance: Producer | null = null;
let producerConnected: boolean = false;

export function getKafkaInstance(): Kafka {
  if (!kafkaInstance) {
    kafkaInstance = new Kafka({
      clientId: config.kafka.clientId,
      brokers: config.kafka.brokers,
      retry: {
        retries: 8,
        initialRetryTime: 100,
        multiplier: 2,
        maxRetryTime: 30000,
      },
      requestTimeout: 30000,
      connectionTimeout: 3000,
    });
  }

  return kafkaInstance;
}

export function getKafkaProducer(): Producer {
  if (!producerInstance) {
    const kafka = getKafkaInstance();
    const { Partitioners } = require('kafkajs');
    
    producerInstance = kafka.producer({
      maxInFlightRequests: 1, // 保证顺序
      idempotent: true, // 幂等性
      transactionTimeout: 30000,
      // 使用 Legacy Partitioner 避免警告
      createPartitioner: Partitioners.LegacyPartitioner,
      // 增加重试次数以满足 EoS 要求
      retry: {
        retries: 10,
        initialRetryTime: 100,
        multiplier: 2,
        maxRetryTime: 30000,
      },
    });
  }

  return producerInstance;
}

/**
 * 连接 Kafka Producer（在应用启动时调用）
 */
export async function connectKafkaProducer(): Promise<void> {
  if (producerConnected) {
    return;
  }
  
  const producer = getKafkaProducer();
  await producer.connect();
  producerConnected = true;
  
  const logger = require('./logger').default;
  logger.info('Kafka Producer connected');
}

/**
 * 确保 Producer 已连接（在发送消息前调用）
 */
export async function ensureProducerConnected(): Promise<Producer> {
  if (!producerConnected) {
    await connectKafkaProducer();
  }
  return getKafkaProducer();
}

export async function createKafkaConsumer(groupId?: string): Promise<Consumer> {
  const kafka = getKafkaInstance();
  return kafka.consumer({
    groupId: groupId || config.kafka.consumerGroup,
    sessionTimeout: 30000,
    heartbeatInterval: 3000,
    maxBytesPerPartition: 1048576, // 1MB
    minBytes: 1,
    maxBytes: 10485760, // 10MB
    maxWaitTimeInMs: 5000,
  });
}

export async function closeKafkaProducer(): Promise<void> {
  if (producerInstance) {
    await producerInstance.disconnect();
    producerInstance = null;
    producerConnected = false;
    // 使用 logger 而不是 console.log
    const logger = require('./logger').default;
    logger.info('Kafka Producer disconnected');
  }
}
