import { getDBPool } from '../db/connection';
import { config } from '../config';
import logger from '../utils/logger';
import type { PoolConnection } from 'mysql2/promise';

/**
 * Leader Election Service
 * 实现 Leader Election 机制，防止脑裂
 */
export class LeaderElection {
  private consumerId: string;
  private lockTTL: number;
  private renewInterval: number;
  private renewTimer: NodeJS.Timeout | null = null;
  private isLeader = false;

  constructor(consumerId?: string) {
    this.consumerId = consumerId || `consumer-${process.pid}-${Date.now()}`;
    this.lockTTL = config.leaderElection.lockTTL;
    this.renewInterval = config.leaderElection.renewInterval;
  }

  /**
   * 获取 Leader Lock
   */
  async acquireLock(): Promise<boolean> {
    const pool = getDBPool();

    try {
      const result = await pool.query(
        `INSERT INTO leader_locks (id, consumer_id, acquired_at, expires_at)
         VALUES (1, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
         ON DUPLICATE KEY UPDATE
           consumer_id = IF(expires_at < NOW(), VALUES(consumer_id), consumer_id),
           acquired_at = IF(expires_at < NOW(), NOW(), acquired_at),
           expires_at = IF(expires_at < NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), expires_at)`,
        [this.consumerId, this.lockTTL / 1000, this.lockTTL / 1000]
      );

      const [rows] = result as [any, any];
      
      // 检查是否成功获取锁
      if (rows.affectedRows > 0) {
        const [lockRows] = await pool.query(
          `SELECT consumer_id, expires_at FROM leader_locks WHERE id = 1`
        ) as [Array<{ consumer_id: string; expires_at: Date }>, any];

        if (lockRows.length > 0 && lockRows[0].consumer_id === this.consumerId) {
          this.isLeader = true;
          logger.info('Leader lock acquired', {
            consumerId: this.consumerId,
            expiresAt: lockRows[0].expires_at,
          });
          return true;
        }
      }

      return false;
    } catch (error: unknown) {
      logger.error('Failed to acquire leader lock', {
        consumerId: this.consumerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 续期 Leader Lock
   */
  async renewLock(): Promise<boolean> {
    if (!this.isLeader) {
      return false;
    }

    const pool = getDBPool();

    try {
      const result = await pool.query(
        `UPDATE leader_locks
         SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
         WHERE id = 1 
           AND consumer_id = ?
           AND expires_at > NOW()`,
        [this.lockTTL / 1000, this.consumerId]
      );

      const [rows] = result as [any, any];
      const renewed = rows.affectedRows > 0;

      if (!renewed) {
        // Lock 已丢失
        this.isLeader = false;
        logger.warn('Leader lock lost', {
          consumerId: this.consumerId,
        });
      }

      return renewed;
    } catch (error: unknown) {
      logger.error('Failed to renew leader lock', {
        consumerId: this.consumerId,
        error: error instanceof Error ? error.message : String(error),
      });
      this.isLeader = false;
      return false;
    }
  }

  /**
   * 在事务中检查 Leader Lock
   */
  async checkLockInTransaction(connection: PoolConnection): Promise<boolean> {
    try {
      const [rows] = await connection.query(
        `SELECT consumer_id FROM leader_locks
         WHERE id = 1 AND consumer_id = ? AND expires_at > NOW()`,
        [this.consumerId]
      ) as [Array<{ consumer_id: string }>, any];

      const isLeader = rows.length > 0 && rows[0].consumer_id === this.consumerId;

      if (!isLeader && this.isLeader) {
        // Lock 在事务中被抢走
        logger.warn('Leader lock lost during transaction', {
          consumerId: this.consumerId,
        });
        this.isLeader = false;
      }

      return isLeader;
    } catch (error: unknown) {
      logger.error('Failed to check leader lock in transaction', {
        consumerId: this.consumerId,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  /**
   * 启动续期机制
   */
  startRenewal(): void {
    if (this.renewTimer) {
      return;
    }

    this.renewTimer = setInterval(async () => {
      const renewed = await this.renewLock();
      if (!renewed && this.isLeader) {
        // Lock 丢失，停止续期
        this.stopRenewal();
        logger.warn('Leader lock renewal stopped', {
          consumerId: this.consumerId,
        });
      }
    }, this.renewInterval);

    logger.info('Leader lock renewal started', {
      consumerId: this.consumerId,
      interval: this.renewInterval,
    });
  }

  /**
   * 停止续期机制
   */
  stopRenewal(): void {
    if (this.renewTimer) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }

  /**
   * 释放 Leader Lock（优雅关闭）
   */
  async releaseLock(): Promise<void> {
    if (!this.isLeader) {
      return;
    }

    const pool = getDBPool();

    try {
      await pool.query(
        `DELETE FROM leader_locks WHERE id = 1 AND consumer_id = ?`,
        [this.consumerId]
      );

      this.isLeader = false;
      this.stopRenewal();

      logger.info('Leader lock released', {
        consumerId: this.consumerId,
      });
    } catch (error: unknown) {
      logger.error('Failed to release leader lock', {
        consumerId: this.consumerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 检查是否是 Leader
   */
  isCurrentLeader(): boolean {
    return this.isLeader;
  }

  /**
   * 获取 Consumer ID
   */
  getConsumerId(): string {
    return this.consumerId;
  }
}

// 单例实例
let leaderElectionInstance: LeaderElection | null = null;
let leaderElectionEnabled = false;

export function getLeaderElection(consumerId?: string): LeaderElection {
  if (!leaderElectionInstance) {
    leaderElectionInstance = new LeaderElection(consumerId);
  }
  return leaderElectionInstance;
}

/**
 * 启用 Leader Election（在获取锁之后调用）
 */
export function enableLeaderElection(): void {
  leaderElectionEnabled = true;
}

/**
 * 禁用 Leader Election
 */
export function disableLeaderElection(): void {
  leaderElectionEnabled = false;
}

/**
 * 检查 Leader Election 是否已启用
 */
export function isLeaderElectionEnabled(): boolean {
  return leaderElectionEnabled && leaderElectionInstance !== null && leaderElectionInstance.isCurrentLeader();
}
