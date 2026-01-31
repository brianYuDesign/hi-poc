import Decimal from 'decimal.js';
import { Balance } from '../types';

/**
 * In-Memory 余额缓存
 * 使用 Map 存储，无锁设计（单线程处理）
 */
export class BalanceCache {
  private cache: Map<string, Balance> = new Map();

  /**
   * 生成缓存键
   */
  private getKey(accountId: number, currencyCode: string): string {
    return `${accountId}:${currencyCode}`;
  }

  /**
   * 获取余额
   */
  get(accountId: number, currencyCode: string): Balance | null {
    const key = this.getKey(accountId, currencyCode);
    return this.cache.get(key) || null;
  }

  /**
   * 设置余额
   */
  set(accountId: number, currencyCode: string, balance: Balance): void {
    const key = this.getKey(accountId, currencyCode);
    this.cache.set(key, balance);
  }

  /**
   * 更新余额（原子操作）
   */
  update(
    accountId: number,
    currencyCode: string,
    availableDelta: Decimal,
    frozenDelta: Decimal = new Decimal(0)
  ): Balance {
    const key = this.getKey(accountId, currencyCode);
    const current = this.cache.get(key);

    if (current) {
      const newAvailable = current.available.add(availableDelta);
      const newFrozen = current.frozen.add(frozenDelta);

      // 检查余额不能为负
      if (newAvailable.lt(0)) {
        throw new Error(`Insufficient balance: available would be ${newAvailable.toString()}`);
      }
      if (newFrozen.lt(0)) {
        throw new Error(`Insufficient frozen balance: frozen would be ${newFrozen.toString()}`);
      }

      const updated: Balance = {
        ...current,
        available: newAvailable,
        frozen: newFrozen,
        version: current.version + 1,
        updatedAt: Date.now(),
      };

      this.cache.set(key, updated);
      return updated;
    } else {
      // 余额不存在，需要从 DB 加载
      throw new Error(`Balance not found in cache: ${key}`);
    }
  }

  /**
   * 批量更新余额
   */
  batchUpdate(
    updates: Array<{
      accountId: number;
      currencyCode: string;
      availableDelta: Decimal;
      frozenDelta?: Decimal;
    }>
  ): Balance[] {
    const results: Balance[] = [];

    for (const update of updates) {
      try {
        const balance = this.update(
          update.accountId,
          update.currencyCode,
          update.availableDelta,
          update.frozenDelta || new Decimal(0)
        );
        results.push(balance);
      } catch (error) {
        // 如果余额不存在，需要先加载
        throw error;
      }
    }

    return results;
  }

  /**
   * 删除余额
   */
  delete(accountId: number, currencyCode: string): boolean {
    const key = this.getKey(accountId, currencyCode);
    return this.cache.delete(key);
  }

  /**
   * 清空缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 获取缓存大小
   */
  size(): number {
    return this.cache.size;
  }

  /**
   * 获取所有余额（用于快照）
   */
  getAll(): Balance[] {
    return Array.from(this.cache.values());
  }

  /**
   * 批量设置余额（用于从 DB 加载）
   */
  batchSet(balances: Balance[]): void {
    for (const balance of balances) {
      const key = this.getKey(balance.accountId, balance.currencyCode);
      this.cache.set(key, balance);
    }
  }
}

// 单例实例
let balanceCacheInstance: BalanceCache | null = null;

export function getBalanceCache(): BalanceCache {
  if (!balanceCacheInstance) {
    balanceCacheInstance = new BalanceCache();
  }
  return balanceCacheInstance;
}
