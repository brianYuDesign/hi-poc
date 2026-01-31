import { KafkaMessage } from '../types';
import { getKafkaProducer } from './kafka';
import { config } from '../config';
import logger from './logger';

export interface RetryContext {
  retryCount: number;
  lastError?: Error;
  nextRetryAt?: number;
}

/**
 * 错误处理策略：重试 + DLQ
 */
export class ErrorHandler {
  /**
   * 计算重试间隔（指数退避）
   */
  private calculateRetryInterval(retryCount: number): number {
    const baseInterval = config.consumer.retry.retryInterval;
    const multiplier = config.consumer.retry.retryBackoffMultiplier;
    return baseInterval * Math.pow(multiplier, retryCount);
  }

  /**
   * 判断是否应该重试
   */
  shouldRetry(retryCount: number, error: Error): boolean {
    // 达到最大重试次数
    if (retryCount >= config.consumer.retry.maxRetries) {
      return false;
    }

    // 某些错误不应该重试（如数据格式错误、权限错误等）
    const nonRetryableErrors = [
      'ValidationError',
      'AuthenticationError',
      'AuthorizationError',
      'InvalidFormatError',
    ];

    const errorName = error.constructor.name;
    if (nonRetryableErrors.includes(errorName)) {
      logger.warn(`Non-retryable error: ${errorName}`, { error: error.message });
      return false;
    }

    return true;
  }

  /**
   * 处理可重试的错误
   */
  async handleRetryableError(
    message: KafkaMessage,
    error: Error,
    retryCount: number
  ): Promise<{ shouldRetry: boolean; nextRetryAt?: number }> {
    if (!this.shouldRetry(retryCount, error)) {
      // 超过最大重试次数，发送到 DLQ
      await this.sendToDLQ(message, error, retryCount);
      return { shouldRetry: false };
    }

    const retryInterval = this.calculateRetryInterval(retryCount);
    const nextRetryAt = Date.now() + retryInterval;

    logger.warn(`Message will be retried`, {
      topic: message.partition,
      offset: message.offset,
      retryCount: retryCount + 1,
      maxRetries: config.consumer.retry.maxRetries,
      retryInterval,
      error: error.message,
    });

    return {
      shouldRetry: true,
      nextRetryAt,
    };
  }

  /**
   * 发送消息到死信队列（DLQ）
   */
  async sendToDLQ(message: KafkaMessage, error: Error, retryCount: number): Promise<void> {
    try {
      const producer = getKafkaProducer();

      const dlqMessage = {
        originalTopic: message.partition ? `partition-${message.partition}` : 'unknown',
        originalOffset: message.offset || 'unknown',
        originalKey: message.key,
        originalValue: message.value,
        originalHeaders: message.headers || {},
        error: {
          message: error.message,
          stack: error.stack,
          name: error.constructor.name,
        },
        retryCount,
        failedAt: new Date().toISOString(),
        dlqTopic: config.consumer.retry.dlqTopic,
      };

      await producer.send({
        topic: config.consumer.retry.dlqTopic,
        messages: [
          {
            key: message.key,
            value: JSON.stringify(dlqMessage),
            headers: {
              ...message.headers,
              'x-original-topic': message.partition?.toString() || 'unknown',
              'x-original-offset': message.offset || 'unknown',
              'x-failed-at': new Date().toISOString(),
              'x-retry-count': retryCount.toString(),
            },
          },
        ],
      });

      logger.error(`Message sent to DLQ`, {
        topic: message.partition,
        offset: message.offset,
        retryCount,
        dlqTopic: config.consumer.retry.dlqTopic,
        error: error.message,
      });
    } catch (dlqError) {
      // DLQ 发送失败，记录严重错误
      logger.error(`Failed to send message to DLQ`, {
        originalError: error.message,
        dlqError: dlqError instanceof Error ? dlqError.message : String(dlqError),
        message: {
          key: message.key,
          offset: message.offset,
        },
      });
      throw dlqError;
    }
  }

  /**
   * 延迟重试（使用 setTimeout）
   */
  async delayRetry(delayMs: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });
  }

  /**
   * 处理错误（统一入口）
   */
  async handleError(
    message: KafkaMessage,
    error: Error,
    retryCount: number
  ): Promise<{ shouldRetry: boolean; nextRetryAt?: number }> {
    logger.error(`Error processing message`, {
      topic: message.partition,
      offset: message.offset,
      retryCount,
      error: {
        name: error.constructor.name,
        message: error.message,
        stack: error.stack,
      },
    });

    return this.handleRetryableError(message, error, retryCount);
  }
}

// 单例实例
let errorHandlerInstance: ErrorHandler | null = null;

export function getErrorHandler(): ErrorHandler {
  if (!errorHandlerInstance) {
    errorHandlerInstance = new ErrorHandler();
  }
  return errorHandlerInstance;
}
