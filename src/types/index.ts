import Decimal from 'decimal.js';

// 交易类型
export enum TransactionType {
  DEPOSIT = 'DEPOSIT', // 充值
  WITHDRAW = 'WITHDRAW', // 提现
  FREEZE = 'FREEZE', // 冻结
  UNFREEZE = 'UNFREEZE', // 解冻
  TRANSFER = 'TRANSFER', // 转账
}

// 交易状态
export enum TransactionStatus {
  INIT = 'INIT', // 初始状态
  PROCESSING = 'PROCESSING', // 处理中
  SUCCESS = 'SUCCESS', // 成功
  FAILED = 'FAILED', // 失败
}

// Outbox 事件状态
export enum OutboxStatus {
  PENDING = 'PENDING', // 待发送
  SENT = 'SENT', // 已发送
  FAILED = 'FAILED', // 发送失败
}

// 余额信息
export interface Balance {
  accountId: number;
  currencyCode: string;
  available: Decimal;
  frozen: Decimal;
  version: number;
  updatedAt: number; // timestamp
}

// 余额变更请求
export interface BalanceChangeRequest {
  transactionId: string; // 唯一交易ID（幂等性保证）
  accountId: number;
  userId: string;
  currencyCode: string;
  type: TransactionType;
  amount: Decimal;
  description?: string;
  metadata?: Record<string, unknown>;
}

// 余额变更结果
export interface BalanceChangeResult {
  transactionId: string;
  accountId: number;
  currencyCode: string;
  success: boolean;
  availableBefore: Decimal;
  availableAfter: Decimal;
  frozenBefore: Decimal;
  frozenAfter: Decimal;
  errorMessage?: string;
  timestamp: number;
}

// Kafka 消息
export interface KafkaMessage {
  key: string; // partition key (user_id)
  value: string; // JSON string
  headers?: Record<string, string>;
  partition?: number;
  offset?: string;
  timestamp?: string;
}

// DLQ 消息
export interface DLQMessage {
  originalTopic: string;
  originalOffset: string;
  originalKey: string;
  originalValue: string;
  originalHeaders: Record<string, string>;
  error: {
    message: string;
    stack?: string;
    name: string;
  };
  retryCount: number;
  failedAt: string;
  dlqTopic: string;
}

// Outbox 事件
export interface OutboxEvent {
  eventId: string;
  topic: string;
  partitionKey: string;
  payload: BalanceChangeRequest;
  status: OutboxStatus;
  retryCount: number;
  errorMessage?: string;
  createdAt: Date;
  sentAt?: Date;
}

// Consumer Offset
export interface ConsumerOffset {
  consumerGroup: string;
  topic: string;
  partition: number;
  offset: number;
  updatedAt: Date;
}

// Leader Lock
export interface LeaderLock {
  id: number;
  consumerId: string;
  acquiredAt: Date;
  expiresAt: Date;
}

// 账户信息
export interface Account {
  id: number;
  userId: string;
  shardId: number;
  createdAt: Date;
  updatedAt: Date;
}

// 余额流水记录
export interface BalanceTransaction {
  id: number;
  accountId: number;
  currencyCode: string;
  transactionId: string;
  type: TransactionType;
  amount: Decimal;
  availableBefore: Decimal;
  availableAfter: Decimal;
  frozenBefore: Decimal;
  frozenAfter: Decimal;
  status: TransactionStatus;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}
