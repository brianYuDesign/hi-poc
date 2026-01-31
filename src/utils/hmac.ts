import crypto from 'crypto';
import { config } from '../config';

/**
 * 生成 HMAC 签名
 */
export function generateHMAC(data: string, timestamp: string): string {
  const hmac = crypto.createHmac(config.security.hmacAlgorithm, config.security.hmacSecret);
  hmac.update(`${timestamp}:${data}`);
  return hmac.digest('hex');
}

/**
 * 验证 HMAC 签名
 */
export function verifyHMAC(data: string, timestamp: string, signature: string): boolean {
  // 检查时间戳（防止重放攻击）
  const requestTime = parseInt(timestamp, 10);
  const now = Date.now();
  const timeDiff = Math.abs(now - requestTime);

  if (timeDiff > config.security.requestTimeout) {
    throw new Error('Request expired');
  }

  // 验证签名
  const expected = generateHMAC(data, timestamp);
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

/**
 * 生成事件ID（用于幂等性）
 */
export function generateEventId(): string {
  return `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
}

/**
 * 生成交易ID（用于幂等性）
 */
export function generateTransactionId(): string {
  return `txn-${Date.now()}-${crypto.randomBytes(12).toString('hex')}`;
}
