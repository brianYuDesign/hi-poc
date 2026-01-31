import mysql from 'mysql2/promise';
import { getDBPool } from '../db/connection';
import { BalanceChangeRequest, TransactionStatus } from '../types';
import Decimal from 'decimal.js';
import logger from '../utils/logger';
import { writeFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

/**
 * MySQL Batch Writer
 * 批量写入 MySQL，使用 LOAD DATA INFILE 优化性能
 */
export class MySQLBatchWriter {
  /**
   * 批量写入余额更新
   * 使用临时表 + CTE 实现高效批量更新
   */
  async batchWriteBalanceUpdates(
    updates: Array<{
      request: BalanceChangeRequest;
      availableBefore: Decimal;
      availableAfter: Decimal;
      frozenBefore: Decimal;
      frozenAfter: Decimal;
      status: TransactionStatus;
    }>,
    leaderCheckCallback?: (connection: mysql.PoolConnection) => Promise<void>
  ): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    const pool = getDBPool();
    const connection = await pool.getConnection();

    try {
      await connection.beginTransaction();

      // 1. 删除旧的临时表（如果存在）并创建新的
      await connection.query(`DROP TEMPORARY TABLE IF EXISTS temp_balance_updates`);
      
      // 创建临时表（指定与主表相同的字符集和排序规则）
      await connection.query(`
        CREATE TEMPORARY TABLE temp_balance_updates (
          account_id BIGINT NOT NULL,
          currency_code VARCHAR(10) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
          available_delta DECIMAL(36, 18) NOT NULL,
          frozen_delta DECIMAL(36, 18) NOT NULL DEFAULT 0,
          transaction_id VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
          type VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
          amount DECIMAL(36, 18) NOT NULL,
          available_before DECIMAL(36, 18) NOT NULL,
          available_after DECIMAL(36, 18) NOT NULL,
          frozen_before DECIMAL(36, 18) NOT NULL,
          frozen_after DECIMAL(36, 18) NOT NULL,
          status VARCHAR(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
          INDEX idx_account_currency (account_id, currency_code)
        ) ENGINE=MEMORY DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
      `);

      // 2. 准备批量插入数据
      const values = updates.map((update) => {
        const availableDelta = update.availableAfter.sub(update.availableBefore);
        const frozenDelta = update.frozenAfter.sub(update.frozenBefore);
        
        return [
          update.request.accountId,
          update.request.currencyCode,
          availableDelta.toString(),
          frozenDelta.toString(),
          update.request.transactionId,
          update.request.type,
          update.request.amount.toString(),
          update.availableBefore.toString(),
          update.availableAfter.toString(),
          update.frozenBefore.toString(),
          update.frozenAfter.toString(),
          update.status,
        ];
      });

      // 3. 批量插入到临时表
      const placeholders = values.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const flatValues = values.flat();

      await connection.query(
        `INSERT INTO temp_balance_updates 
         (account_id, currency_code, available_delta, frozen_delta, 
          transaction_id, type, amount, available_before, available_after, 
          frozen_before, frozen_after, status)
         VALUES ${placeholders}`,
        flatValues
      );

      // 4. 检查 Leader Lock（如果提供）
      if (leaderCheckCallback) {
        await leaderCheckCallback(connection);
      }

      // 5. 批量更新余额（先 UPDATE 已存在的，再 INSERT 不存在的）
      
      // 5.1 更新已存在的余额记录
      await connection.query(`
        UPDATE account_balances ab
        JOIN temp_balance_updates t 
          ON ab.account_id = t.account_id 
          AND ab.currency_code = t.currency_code
        SET ab.available = ab.available + t.available_delta,
            ab.frozen = ab.frozen + t.frozen_delta,
            ab.version = ab.version + 1,
            ab.updated_at = NOW()
        WHERE ab.available + t.available_delta >= 0
          AND ab.frozen + t.frozen_delta >= 0
      `);
      
      // 5.2 插入不存在的余额记录（使用 INSERT IGNORE 避免重复键错误）
      await connection.query(`
        INSERT IGNORE INTO account_balances (account_id, currency_code, available, frozen, version)
        SELECT t.account_id, t.currency_code, t.available_after, t.frozen_after, 0
        FROM temp_balance_updates t
        LEFT JOIN account_balances ab 
          ON ab.account_id = t.account_id 
          AND ab.currency_code = t.currency_code
        WHERE ab.id IS NULL
          AND t.available_after >= 0 
          AND t.frozen_after >= 0
      `);

      // 6. 记录流水
      await connection.query(`
        INSERT INTO balance_transactions
        (account_id, currency_code, transaction_id, type, amount,
         available_before, available_after, frozen_before, frozen_after, status)
        SELECT 
          account_id, currency_code, transaction_id, type, amount,
          available_before, available_after, frozen_before, frozen_after, status
        FROM temp_balance_updates
        ON DUPLICATE KEY UPDATE
          status = VALUES(status),
          updated_at = NOW()
      `);

      await connection.commit();

      logger.info('Batch balance updates written', {
        count: updates.length,
      });
    } catch (error: unknown) {
      await connection.rollback();
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('Failed to batch write balance updates', {
        count: updates.length,
        error: errorMessage,
      });
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * 使用 LOAD DATA INFILE 批量写入（更高效，但需要文件权限）
   * 注意：需要 MySQL 启用 local_infile
   */
  async batchWriteWithLoadData(
    updates: Array<{
      request: BalanceChangeRequest;
      availableBefore: Decimal;
      availableAfter: Decimal;
      frozenBefore: Decimal;
      frozenAfter: Decimal;
      status: TransactionStatus;
    }>
  ): Promise<void> {
    if (updates.length === 0) {
      return;
    }

    const pool = getDBPool();
    const connection = await pool.getConnection();
    const csvPath = join(tmpdir(), `balance_updates_${Date.now()}.csv`);

    try {
      await connection.beginTransaction();

      // 1. 创建临时表
      await connection.query(`
        CREATE TEMPORARY TABLE temp_balance_updates (
          account_id BIGINT NOT NULL,
          currency_code VARCHAR(10) NOT NULL,
          available_delta DECIMAL(36, 18) NOT NULL,
          frozen_delta DECIMAL(36, 18) NOT NULL DEFAULT 0,
          transaction_id VARCHAR(64) NOT NULL,
          INDEX idx_account_currency (account_id, currency_code)
        ) ENGINE=MEMORY
      `);

      // 2. 生成 CSV 文件
      const csvLines = updates.map((update) => {
        const availableDelta = update.availableAfter.sub(update.availableBefore);
        const frozenDelta = update.frozenAfter.sub(update.frozenBefore);
        return `${update.request.accountId},${update.request.currencyCode},${availableDelta.toString()},${frozenDelta.toString()},${update.request.transactionId}`;
      });

      writeFileSync(csvPath, csvLines.join('\n'));

      // 3. LOAD DATA INFILE
      await connection.query(`
        LOAD DATA LOCAL INFILE ?
        INTO TABLE temp_balance_updates
        FIELDS TERMINATED BY ','
        LINES TERMINATED BY '\n'
        (account_id, currency_code, available_delta, frozen_delta, transaction_id)
      `, [csvPath]);

      // 4. 批量更新
      await connection.query(`
        WITH try_update AS (
          UPDATE account_balances ab
          JOIN temp_balance_updates t 
            ON ab.account_id = t.account_id 
            AND ab.currency_code = t.currency_code
          SET ab.available = ab.available + t.available_delta,
              ab.frozen = ab.frozen + t.frozen_delta,
              ab.version = ab.version + 1,
              ab.updated_at = NOW()
          WHERE ab.available + t.available_delta >= 0
            AND ab.frozen + t.frozen_delta >= 0
          RETURNING t.account_id, t.currency_code
        ),
        missing AS (
          SELECT t.* 
          FROM temp_balance_updates t
          LEFT JOIN try_update u 
            ON u.account_id = t.account_id 
            AND u.currency_code = t.currency_code
          WHERE u.account_id IS NULL
        )
        INSERT INTO account_balances (account_id, currency_code, available, frozen, version)
        SELECT 
          t.account_id, 
          t.currency_code, 
          t.available_delta, 
          t.frozen_delta, 
          0
        FROM missing t
        WHERE t.available_delta >= 0 AND t.frozen_delta >= 0
      `);

      await connection.commit();

      logger.info('Batch balance updates written (LOAD DATA)', {
        count: updates.length,
      });
    } catch (error: unknown) {
      await connection.rollback();
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      logger.error('Failed to batch write with LOAD DATA', {
        count: updates.length,
        error: errorMessage,
      });
      throw error;
    } finally {
      // 清理临时文件
      try {
        unlinkSync(csvPath);
      } catch {
        // 忽略清理错误
      }
      connection.release();
    }
  }
}

// 单例实例
let mysqlBatchWriterInstance: MySQLBatchWriter | null = null;

export function getMySQLBatchWriter(): MySQLBatchWriter {
  if (!mysqlBatchWriterInstance) {
    mysqlBatchWriterInstance = new MySQLBatchWriter();
  }
  return mysqlBatchWriterInstance;
}
