import Redis from 'ioredis';
import { config } from '../config';
import logger from '../utils/logger';

let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      db: config.redis.db,
      keyPrefix: config.redis.keyPrefix,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        return delay;
      },
      maxRetriesPerRequest: 3,
      enableReadyCheck: true,
      lazyConnect: false,
    });

    redisClient.on('connect', () => {
      logger.debug('Redis connected');
    });

    redisClient.on('ready', () => {
      logger.info('Redis ready');
    });

    redisClient.on('error', (err) => {
      logger.error('Redis error', {
        error: err instanceof Error ? err.message : String(err),
      });
    });

    redisClient.on('close', () => {
      logger.info('Redis connection closed');
    });
  }

  return redisClient;
}

export async function closeRedisClient(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
    logger.info('Redis client closed');
  }
}

// LWW (Last Write Wins) Lua Script
export const LWW_SCRIPT = `
  local key = KEYS[1]
  local new_value = ARGV[1]
  local new_timestamp = tonumber(ARGV[2])
  local current = redis.call('HMGET', key, 'value', 'timestamp')
  
  if #current == 0 or tonumber(current[2] or 0) < new_timestamp then
    redis.call('HMSET', key, 'value', new_value, 'timestamp', new_timestamp)
    return 1
  else
    return 0
  end
`;

// 批量更新余额（使用 Lua Script）
export async function batchUpdateBalances(
  updates: Array<{ accountId: number; currencyCode: string; balance: string; timestamp: number }>
): Promise<number> {
  const client = getRedisClient();
  const pipeline = client.pipeline();

  for (const update of updates) {
    const key = `${update.accountId}:${update.currencyCode}`;
    pipeline.eval(LWW_SCRIPT, 1, key, update.balance, update.timestamp);
  }

  const results = await pipeline.exec();
  if (!results) {
    return 0;
  }

  // 统计成功更新的数量
  return results.filter(([err, result]) => !err && result === 1).length;
}

// 获取余额
export async function getBalance(
  accountId: number,
  currencyCode: string
): Promise<{ value: string; timestamp: number } | null> {
  const client = getRedisClient();
  const key = `${accountId}:${currencyCode}`;
  const result = await client.hmget(key, 'value', 'timestamp');

  if (!result[0]) {
    return null;
  }

  return {
    value: result[0],
    timestamp: parseInt(result[1] || '0', 10),
  };
}
