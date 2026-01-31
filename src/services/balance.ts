import Decimal from 'decimal.js';
import { getDBPool } from '../db/connection';
import { getBalanceCache } from '../cache/memory';
import { Balance, BalanceChangeRequest, BalanceChangeResult, TransactionType, TransactionStatus } from '../types';
import logger from '../utils/logger';

/**
 * Balance Service
 * 处理余额相关的业务逻辑
 */
export class BalanceService {
  /**
   * 获取余额（优先从数据库，然后更新缓存）
   * 注意：为确保跨进程一致性，每次都从数据库读取最新数据
   * 生产环境应使用 Redis 作为分布式缓存
   */
  async getBalance(accountId: number, currencyCode: string): Promise<Balance | null> {
    // 直接从数据库加载最新数据（确保一致性）
    return this.loadBalanceFromDB(accountId, currencyCode);
  }

  /**
   * 从数据库加载余额
   */
  private async loadBalanceFromDB(
    accountId: number,
    currencyCode: string
  ): Promise<Balance | null> {
    const pool = getDBPool();

    try {
      const [rows] = (await pool.query(
        `SELECT account_id as accountId, currency_code as currencyCode,
                available, frozen, version, 
                UNIX_TIMESTAMP(updated_at) * 1000 as updatedAt
         FROM account_balances
         WHERE account_id = ? AND currency_code = ?`,
        [accountId, currencyCode]
      )) as [Array<{
        accountId: number;
        currencyCode: string;
        available: string;
        frozen: string;
        version: number;
        updatedAt: string;
      }>, unknown];

      if (rows.length === 0) {
        return null;
      }

      const balance: Balance = {
        accountId: rows[0].accountId,
        currencyCode: rows[0].currencyCode,
        available: new Decimal(rows[0].available),
        frozen: new Decimal(rows[0].frozen),
        version: rows[0].version,
        updatedAt: Number(rows[0].updatedAt),
      };

      // 更新到缓存
      const cache = getBalanceCache();
      cache.set(accountId, currencyCode, balance);

      return balance;
    } catch (error: unknown) {
      logger.error('Failed to load balance from DB', {
        accountId,
        currencyCode,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * 更新余额（核心业务逻辑）
   */
  async updateBalance(request: BalanceChangeRequest): Promise<BalanceChangeResult> {
    const cache = getBalanceCache();

    // 1. 获取当前余额
    let currentBalance = await this.getBalance(request.accountId, request.currencyCode);

    // 2. 如果余额不存在，创建新记录
    if (!currentBalance) {
      if (request.type === TransactionType.DEPOSIT && request.amount.gte(0)) {
        currentBalance = {
          accountId: request.accountId,
          currencyCode: request.currencyCode,
          available: new Decimal(0),
          frozen: new Decimal(0),
          version: 0,
          updatedAt: Date.now(),
        };
        cache.set(request.accountId, request.currencyCode, currentBalance);
      } else {
        throw new Error(`Balance not found for account ${request.accountId}, currency ${request.currencyCode}`);
      }
    }

    const availableBefore = currentBalance.available;
    const frozenBefore = currentBalance.frozen;

    // 3. 计算新余额
    let availableAfter: Decimal;
    let frozenAfter: Decimal;

    switch (request.type) {
      case TransactionType.DEPOSIT:
        availableAfter = availableBefore.add(request.amount);
        frozenAfter = frozenBefore;
        break;

      case TransactionType.WITHDRAW:
        availableAfter = availableBefore.sub(request.amount);
        frozenAfter = frozenBefore;
        if (availableAfter.lt(0)) {
          throw new Error(`Insufficient balance: available ${availableBefore.toString()}, requested ${request.amount.toString()}`);
        }
        break;

      case TransactionType.FREEZE:
        availableAfter = availableBefore.sub(request.amount);
        frozenAfter = frozenBefore.add(request.amount);
        if (availableAfter.lt(0)) {
          throw new Error(`Insufficient balance to freeze: available ${availableBefore.toString()}, requested ${request.amount.toString()}`);
        }
        break;

      case TransactionType.UNFREEZE:
        availableAfter = availableBefore.add(request.amount);
        frozenAfter = frozenBefore.sub(request.amount);
        if (frozenAfter.lt(0)) {
          throw new Error(`Insufficient frozen balance: frozen ${frozenBefore.toString()}, requested ${request.amount.toString()}`);
        }
        break;

      default:
        throw new Error(`Unknown transaction type: ${request.type}`);
    }

      // 4. 更新内存缓存
      try {
        cache.update(
          request.accountId,
          request.currencyCode,
          availableAfter.sub(availableBefore),
          frozenAfter.sub(frozenBefore)
        );

      // 5. 记录流水（异步，不阻塞）
      this.recordTransaction(request, availableBefore, availableAfter, frozenBefore, frozenAfter, TransactionStatus.SUCCESS)
        .catch((error) => {
          logger.error('Failed to record transaction', {
            transactionId: request.transactionId,
            error: error instanceof Error ? error.message : String(error),
          });
        });

      return {
        transactionId: request.transactionId,
        accountId: request.accountId,
        currencyCode: request.currencyCode,
        success: true,
        availableBefore,
        availableAfter,
        frozenBefore,
        frozenAfter,
        timestamp: Date.now(),
      };
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 记录失败流水
      this.recordTransaction(
        request,
        availableBefore,
        availableBefore,
        frozenBefore,
        frozenBefore,
        TransactionStatus.FAILED,
        errorMessage
      ).catch(() => {
        // 忽略记录失败的错误
      });

      return {
        transactionId: request.transactionId,
        accountId: request.accountId,
        currencyCode: request.currencyCode,
        success: false,
        availableBefore,
        availableAfter: availableBefore,
        frozenBefore,
        frozenAfter: frozenBefore,
        errorMessage,
        timestamp: Date.now(),
      };
    }
  }

  /**
   * 记录余额流水
   */
  private async recordTransaction(
    request: BalanceChangeRequest,
    availableBefore: Decimal,
    availableAfter: Decimal,
    frozenBefore: Decimal,
    frozenAfter: Decimal,
    status: TransactionStatus,
    errorMessage?: string
  ): Promise<void> {
    // 使用 getDBPool 获取连接池
    const pool = getDBPool();

    try {
      await pool.query(
        `INSERT INTO balance_transactions
         (account_id, currency_code, transaction_id, type, amount,
          available_before, available_after, frozen_before, frozen_after, status, error_message)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          request.accountId,
          request.currencyCode,
          request.transactionId,
          request.type,
          request.amount.toString(),
          availableBefore.toString(),
          availableAfter.toString(),
          frozenBefore.toString(),
          frozenAfter.toString(),
          status,
          errorMessage || null,
        ]
      );
    } catch (error: unknown) {
      // 如果是重复记录（幂等性），忽略错误
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage.includes('Duplicate entry') || errorMessage.includes('UNIQUE constraint')) {
        logger.debug('Duplicate transaction record', {
          transactionId: request.transactionId,
        });
        return;
      }
      throw error;
    }
  }

  /**
   * 验证余额是否足够
   */
  async validateBalance(
    accountId: number,
    currencyCode: string,
    amount: Decimal
  ): Promise<boolean> {
    const balance = await this.getBalance(accountId, currencyCode);
    if (!balance) {
      return false;
    }
    return balance.available.gte(amount);
  }

  /**
   * 批量加载余额到缓存（用于启动时恢复）
   */
  async loadBalancesToCache(accountIds: number[], currencyCodes: string[]): Promise<number> {
    const pool = getDBPool();
    const cache = getBalanceCache();

    try {
      const placeholders = accountIds.map(() => '?').join(',');
      const currencyPlaceholders = currencyCodes.map(() => '?').join(',');

      const [rows] = (await pool.query(
        `SELECT account_id as accountId, currency_code as currencyCode,
                available, frozen, version,
                UNIX_TIMESTAMP(updated_at) * 1000 as updatedAt
         FROM account_balances
         WHERE account_id IN (${placeholders})
           AND currency_code IN (${currencyPlaceholders})`,
        [...accountIds, ...currencyCodes]
      )) as [Array<{
        accountId: number;
        currencyCode: string;
        available: string;
        frozen: string;
        version: number;
        updatedAt: string;
      }>, unknown];

      const balances: Balance[] = rows.map((row: {
        accountId: number;
        currencyCode: string;
        available: string | Decimal;
        frozen: string | Decimal;
        version: number;
        updatedAt: number | string;
      }) => ({
        accountId: row.accountId,
        currencyCode: row.currencyCode,
        available: row.available instanceof Decimal ? row.available : new Decimal(row.available),
        frozen: row.frozen instanceof Decimal ? row.frozen : new Decimal(row.frozen),
        version: row.version,
        updatedAt: typeof row.updatedAt === 'number' ? row.updatedAt : Number(row.updatedAt),
      }));

      cache.batchSet(balances);

      logger.info('Balances loaded to cache', {
        count: balances.length,
      });

      return balances.length;
    } catch (error: unknown) {
      logger.error('Failed to load balances to cache', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

// 单例实例
let balanceServiceInstance: BalanceService | null = null;

export function getBalanceService(): BalanceService {
  if (!balanceServiceInstance) {
    balanceServiceInstance = new BalanceService();
  }
  return balanceServiceInstance;
}
