import { z } from 'zod';

const configSchema = z.object({
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  port: z.number().default(3000),
  
  // MySQL 配置
  mysql: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(3306),
    user: z.string().default('appuser'),
    password: z.string().default('apppassword'),
    database: z.string().default('balance_system'),
    connectionLimit: z.number().default(15), // 小型服务器配置
    queueLimit: z.number().default(100), // 避免内存溢出
    enableLocalInfile: z.boolean().default(true),
    connectTimeout: z.number().default(30000), // 30 秒
  }),
  
  // Redis 配置
  redis: z.object({
    host: z.string().default('localhost'),
    port: z.number().default(6379),
    password: z.string().optional(),
    db: z.number().default(0),
    keyPrefix: z.string().default('balance:'),
  }),
  
  // Kafka 配置
  kafka: z.object({
    brokers: z.array(z.string()).default(['localhost:9092']),
    clientId: z.string().default('balance-system'),
    consumerGroup: z.string().default('balance-consumer-group'),
    topics: z.object({
      balanceChanges: z.string().default('balance-changes'),
      balanceResults: z.string().default('balance-results'),
    }),
  }),
  
  // Consumer 配置
  consumer: z.object({
    batchSize: z.number().default(200),
    batchLatency: z.number().default(100), // ms
    longPoll: z.number().default(1000), // ms
    maxPollRecords: z.number().default(500),
    // 错误处理配置
    retry: z.object({
      maxRetries: z.number().default(3), // 最大重试次数
      retryInterval: z.number().default(1000), // 初始重试间隔（ms）
      retryBackoffMultiplier: z.number().default(2), // 重试间隔倍数
      dlqTopic: z.string().default('balance-changes-dlq'), // 死信队列 Topic
    }),
  }),
  
  // Leader Election 配置
  leaderElection: z.object({
    lockTTL: z.number().default(5000), // ms
    renewInterval: z.number().default(2000), // ms
  }),
  
  // Redis Updater 配置
  redisUpdater: z.object({
    workerCount: z.number().default(4),
    batchSize: z.number().default(100),
    updateInterval: z.number().default(100), // ms
  }),
  
  // 安全配置
  security: z.object({
    hmacSecret: z.string().default('your-secret-key-change-in-production'),
    hmacAlgorithm: z.string().default('sha256'),
    requestTimeout: z.number().default(300000), // 5 minutes
  }),
  
  // 监控配置
  monitoring: z.object({
    prometheusPort: z.number().default(9091),
    enableMetrics: z.boolean().default(true),
  }),
});

export type Config = z.infer<typeof configSchema>;

function loadConfig(): Config {
  const rawConfig = {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    
    mysql: {
      host: process.env.MYSQL_HOST || 'localhost',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'appuser',
      password: process.env.MYSQL_PASSWORD || 'apppassword',
      database: process.env.MYSQL_DATABASE || 'balance_system',
      connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT || '15', 10),
      queueLimit: parseInt(process.env.MYSQL_QUEUE_LIMIT || '100', 10),
      enableLocalInfile: process.env.MYSQL_ENABLE_LOCAL_INFILE !== 'false',
      connectTimeout: parseInt(process.env.MYSQL_CONNECT_TIMEOUT || '30000', 10),
    },
    
    redis: {
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      password: process.env.REDIS_PASSWORD,
      db: parseInt(process.env.REDIS_DB || '0', 10),
      keyPrefix: process.env.REDIS_KEY_PREFIX || 'balance:',
    },
    
    kafka: {
      brokers: (process.env.KAFKA_BROKERS || 'localhost:9092').split(','),
      clientId: process.env.KAFKA_CLIENT_ID || 'balance-system',
      consumerGroup: process.env.KAFKA_CONSUMER_GROUP || 'balance-consumer-group',
      topics: {
        balanceChanges: process.env.KAFKA_TOPIC_BALANCE_CHANGES || 'balance-changes',
        balanceResults: process.env.KAFKA_TOPIC_BALANCE_RESULTS || 'balance-results',
      },
    },
    
    consumer: {
      batchSize: parseInt(process.env.CONSUMER_BATCH_SIZE || '200', 10),
      batchLatency: parseInt(process.env.CONSUMER_BATCH_LATENCY || '100', 10),
      longPoll: parseInt(process.env.CONSUMER_LONG_POLL || '1000', 10),
      maxPollRecords: parseInt(process.env.CONSUMER_MAX_POLL_RECORDS || '500', 10),
      retry: {
        maxRetries: parseInt(process.env.CONSUMER_MAX_RETRIES || '3', 10),
        retryInterval: parseInt(process.env.CONSUMER_RETRY_INTERVAL || '1000', 10),
        retryBackoffMultiplier: parseFloat(process.env.CONSUMER_RETRY_BACKOFF || '2'),
        dlqTopic: process.env.CONSUMER_DLQ_TOPIC || 'balance-changes-dlq',
      },
    },
    
    leaderElection: {
      lockTTL: parseInt(process.env.LEADER_LOCK_TTL || '5000', 10),
      renewInterval: parseInt(process.env.LEADER_RENEW_INTERVAL || '2000', 10),
    },
    
    redisUpdater: {
      workerCount: parseInt(process.env.REDIS_UPDATER_WORKER_COUNT || '4', 10),
      batchSize: parseInt(process.env.REDIS_UPDATER_BATCH_SIZE || '100', 10),
      updateInterval: parseInt(process.env.REDIS_UPDATER_INTERVAL || '100', 10),
    },
    
    security: {
      hmacSecret: process.env.HMAC_SECRET || 'your-secret-key-change-in-production',
      hmacAlgorithm: process.env.HMAC_ALGORITHM || 'sha256',
      requestTimeout: parseInt(process.env.REQUEST_TIMEOUT || '300000', 10),
    },
    
    monitoring: {
      prometheusPort: parseInt(process.env.PROMETHEUS_PORT || '9091', 10),
      enableMetrics: process.env.ENABLE_METRICS !== 'false',
    },
  };
  
  return configSchema.parse(rawConfig);
}

export const config = loadConfig();
