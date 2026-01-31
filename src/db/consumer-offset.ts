import { getDBPool } from './connection';
import { ConsumerOffset } from '../types';
import logger from '../utils/logger';

/**
 * Consumer Offset 管理
 * 手动管理 Kafka Consumer Offset
 */
export class ConsumerOffsetManager {
  /**
   * 获取 Offset
   */
  async getOffset(
    consumerGroup: string,
    topic: string,
    partition: number
  ): Promise<number | null> {
    const pool = getDBPool();

    try {
      const [rows] = (await pool.query(
        `SELECT \`offset\` FROM consumer_offsets
         WHERE consumer_group = ? AND topic = ? AND \`partition\` = ?`,
        [consumerGroup, topic, partition]
      )) as [Array<{ offset: number }>, unknown];

      if (rows.length === 0) {
        return null;
      }

      return rows[0].offset;
    } catch (error: unknown) {
      logger.error('Failed to get consumer offset', {
        consumerGroup,
        topic,
        partition,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 更新 Offset
   */
  async updateOffset(
    consumerGroup: string,
    topic: string,
    partition: number,
    offset: number
  ): Promise<void> {
    const pool = getDBPool();

    try {
      await pool.query(
        `INSERT INTO consumer_offsets (consumer_group, topic, \`partition\`, \`offset\`)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           \`offset\` = VALUES(\`offset\`),
           updated_at = NOW()`,
        [consumerGroup, topic, partition, offset]
      );

      logger.debug('Consumer offset updated', {
        consumerGroup,
        topic,
        partition,
        offset,
      });
    } catch (error: unknown) {
      logger.error('Failed to update consumer offset', {
        consumerGroup,
        topic,
        partition,
        offset,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 获取所有 Offsets
   */
  async getAllOffsets(consumerGroup: string, topic: string): Promise<ConsumerOffset[]> {
    const pool = getDBPool();

    try {
      const [rows] = (await pool.query(
        `SELECT consumer_group, topic, \`partition\`, \`offset\`, updated_at
         FROM consumer_offsets
         WHERE consumer_group = ? AND topic = ?`,
        [consumerGroup, topic]
      )) as [Array<{
        consumer_group: string;
        topic: string;
        partition: number;
        offset: number;
        updated_at: Date;
      }>, unknown];

      return rows.map((row) => ({
        consumerGroup: row.consumer_group,
        topic: row.topic,
        partition: row.partition,
        offset: row.offset,
        updatedAt: row.updated_at,
      }));
    } catch (error: unknown) {
      logger.error('Failed to get all consumer offsets', {
        consumerGroup,
        topic,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// 单例实例
let consumerOffsetManagerInstance: ConsumerOffsetManager | null = null;

export function getConsumerOffsetManager(): ConsumerOffsetManager {
  if (!consumerOffsetManagerInstance) {
    consumerOffsetManagerInstance = new ConsumerOffsetManager();
  }
  return consumerOffsetManagerInstance;
}
