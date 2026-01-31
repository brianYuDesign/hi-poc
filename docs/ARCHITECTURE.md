# 系统架构设计文档

## 一、整体架构

### 1.1 架构分层

```
┌─────────────────────────────────────────────────────────┐
│                    Client Layer                          │
│              (gRPC Clients / Web API)                    │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                   API Gateway Layer                     │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │  Auth        │  │  Rate Limit  │  │  Validation  │ │
│  │  (HMAC)      │  │              │  │              │ │
│  └──────────────┘  └──────────────┘  └──────────────┘ │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                 Business Logic Layer                     │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Outbox Pattern Service                   │  │
│  │  - 写入 DB (unique index)                        │  │
│  │  - Produce to Kafka                              │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│                  Message Queue Layer                    │
│  ┌──────────────────────────────────────────────────┐  │
│  │              Kafka Cluster                       │  │
│  │  - Partition by user_id (shard_id)               │  │
│  │  - Replication Factor: 3                         │  │
│  │  - Retention: 7 days                             │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────┬────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────┐
│              Processing Layer (PM2 Cluster)             │
│  ┌──────────────────────────────────────────────────┐  │
│  │         Batch Consumer (Per Process)              │  │
│  │  - Single thread per partition                   │  │
│  │  - Batch processing (200 msgs / 100ms)          │  │
│  │  - In-Memory Cache (Map)                         │  │
│  └──────────────────────────────────────────────────┘  │
└─────┬──────────────────────┬──────────────────────┬─────┘
      │                      │                      │
      ▼                      ▼                      ▼
┌──────────┐        ┌──────────────┐      ┌──────────────┐
│  MySQL   │        │    Redis     │      │   WAL Flush  │
│  Writer  │        │   Updater    │      │   Worker     │
│          │        │              │      │              │
│  Batch   │        │  Worker      │      │  Offset      │
│  Update  │        │  Threads     │      │  Commit      │
└──────────┘        └──────────────┘      └──────────────┘
```

### 1.2 数据流

#### 写入流程
```
Client Request
    ↓
API Gateway (HMAC 验证)
    ↓
Outbox Service
    ├─→ 写入 DB (outbox_events, unique index)
    └─→ Produce to Kafka (partition by user_id)
    ↓
Kafka Topic
    ↓
Batch Consumer
    ├─→ 幂等性检查 (transaction_id)
    ├─→ In-Memory Cache 更新
    ├─→ 批量写入 MySQL
    ├─→ 更新 Redis 快照 (Worker Threads)
    └─→ Commit Offset
```

#### 查询流程
```
Client Query Request
    ↓
API Gateway
    ↓
Query Service
    ├─→ 查询 In-Memory Cache (优先)
    ├─→ 查询 Redis (次选)
    └─→ 查询 MySQL (兜底)
```

#### 恢复流程
```
Service Crash
    ↓
Restart
    ├─→ 从 MySQL 加载余额快照
    ├─→ 获取最后 committed offset
    └─→ 从 offset 开始 replay Kafka
```

---

## 二、核心模块设计

### 2.1 API Gateway

**职责**:
- 请求认证 (HMAC-SHA256)
- 请求限流
- 参数验证
- 路由分发

**技术栈**:
- gRPC (主要)
- Express (可选，用于管理接口)

**关键实现**:
```typescript
// HMAC 验证中间件
async function verifyHMAC(ctx: Context, next: Next) {
  const signature = ctx.headers['x-signature'];
  const timestamp = ctx.headers['x-timestamp'];
  const expected = generateHMAC(ctx.body, timestamp, secret);
  
  if (signature !== expected) {
    throw new Error('Invalid signature');
  }
  
  // 防重放攻击
  if (Date.now() - parseInt(timestamp) > 300000) {
    throw new Error('Request expired');
  }
  
  await next();
}
```

### 2.2 Outbox Pattern Service

**职责**:
- 保证消息至少发送一次
- 防止重复发送
- 事务一致性

**实现**:
```typescript
async function createBalanceChange(request: BalanceChangeRequest) {
  const transaction = await db.beginTransaction();
  
  try {
    // 1. 写入 outbox_events (unique index 防止重复)
    const eventId = generateEventId();
    await db.query(`
      INSERT INTO outbox_events 
      (event_id, topic, partition_key, payload, status)
      VALUES (?, ?, ?, ?, 'PENDING')
    `, [eventId, 'balance-changes', request.userId, JSON.stringify(request)]);
    
    // 2. 提交事务
    await transaction.commit();
    
    // 3. 异步发送到 Kafka
    await kafkaProducer.send({
      topic: 'balance-changes',
      messages: [{
        key: request.userId, // partition key
        value: JSON.stringify(request),
        headers: { eventId }
      }]
    });
    
    // 4. 更新状态
    await db.query(`
      UPDATE outbox_events 
      SET status = 'SENT', sent_at = NOW()
      WHERE event_id = ?
    `, [eventId]);
    
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
```

### 2.3 Batch Consumer

**职责**:
- 消费 Kafka 消息
- 批次处理
- 幂等性保证
- 内存缓存更新

**核心循环**:
```typescript
class BatchConsumer {
  private cache: Map<string, Balance> = new Map();
  private batchBuffer: Message[] = [];
  
  async start() {
    const longPoll = 1000; // 1s
    const batchLatency = 100; // 100ms
    const batchSize = 200;
    
    let pollTimeout = longPoll;
    
    while (this.running) {
      const msg = await this.consumer.poll(pollTimeout);
      
      if (msg === null) { // timeout
        if (this.batchBuffer.length > 0) {
          await this.processBatch(this.batchBuffer);
          this.batchBuffer = [];
        }
        pollTimeout = longPoll;
      } else {
        this.batchBuffer.push(msg);
        
        if (this.batchBuffer.length >= batchSize) {
          await this.processBatch(this.batchBuffer);
          this.batchBuffer = [];
        }
        
        pollTimeout = batchLatency;
      }
    }
  }
  
  private async processBatch(messages: Message[]) {
    // 1. 幂等性检查
    const uniqueMessages = await this.deduplicate(messages);
    
    // 2. 更新内存缓存
    for (const msg of uniqueMessages) {
      this.updateCache(msg);
    }
    
    // 3. 批量写入 MySQL
    await this.batchWriteToDB(uniqueMessages);
    
    // 4. 异步更新 Redis
    this.redisUpdater.enqueue(uniqueMessages);
    
    // 5. Commit offset
    await this.consumer.commit();
  }
}
```

### 2.4 In-Memory Cache

**数据结构**:
```typescript
interface Balance {
  accountId: number;
  currencyCode: string;
  available: Decimal;
  frozen: Decimal;
  version: number; // 用于乐观锁
  updatedAt: number; // timestamp
}

class BalanceCache {
  private cache: Map<string, Balance> = new Map();
  
  // Key: `${accountId}:${currencyCode}`
  get(accountId: number, currencyCode: string): Balance | null {
    return this.cache.get(`${accountId}:${currencyCode}`) || null;
  }
  
  update(accountId: number, currencyCode: string, delta: Decimal) {
    const key = `${accountId}:${currencyCode}`;
    const current = this.cache.get(key);
    
    if (current) {
      current.available = current.available.add(delta);
      current.version++;
      current.updatedAt = Date.now();
    } else {
      // 从 DB 加载
      this.loadFromDB(accountId, currencyCode);
    }
  }
}
```

### 2.5 MySQL Batch Writer

**优化策略**:
1. LOAD DATA INFILE (最快)
2. 临时表 + JOIN UPDATE
3. CTE Lazy Insert

**实现**:
```typescript
class MySQLBatchWriter {
  async batchWrite(updates: BalanceUpdate[]) {
    // 1. 创建临时表
    await this.db.query(`
      CREATE TEMPORARY TABLE temp_balance_updates (
        account_id BIGINT,
        currency_code VARCHAR(10),
        available_delta DECIMAL(36, 18),
        transaction_id VARCHAR(64),
        INDEX idx_account_currency (account_id, currency_code)
      )
    `);
    
    // 2. LOAD DATA INFILE
    const csv = this.generateCSV(updates);
    await this.db.query(`
      LOAD DATA LOCAL INFILE ?
      INTO TABLE temp_balance_updates
      FIELDS TERMINATED BY ',' 
      LINES TERMINATED BY '\n'
    `, [csv]);
    
    // 3. CTE 批量更新
    await this.db.query(`
      WITH try_update AS (
        UPDATE account_balances ab
        JOIN temp_balance_updates t 
          ON ab.account_id = t.account_id 
          AND ab.currency_code = t.currency_code
        SET ab.available = ab.available + t.available_delta,
            ab.updated_at = NOW()
        WHERE ab.available + t.available_delta >= 0
        RETURNING t.account_id, t.currency_code, t.transaction_id
      ),
      missing AS (
        SELECT t.* FROM temp_balance_updates t
        LEFT JOIN try_update u ON u.account_id = t.account_id
        WHERE u.account_id IS NULL
      )
      INSERT INTO account_balances (account_id, currency_code, available)
      SELECT account_id, currency_code, available_delta
      FROM missing
      WHERE available_delta >= 0
    `);
    
    // 4. 记录流水
    await this.recordTransactions(updates);
  }
}
```

### 2.6 Redis Updater (Worker Threads)

**设计**:
- 使用 Worker Threads 实现多核心并行
- LWW (Last Write Wins) 机制
- Lua Script 原子操作

**实现**:
```typescript
// Main Thread
class RedisUpdater {
  private workerPool: Worker[] = [];
  
  constructor(workerCount: number = 4) {
    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker('./redis-updater-worker.js');
      this.workerPool.push(worker);
    }
  }
  
  async enqueue(updates: BalanceUpdate[]) {
    // 按 shard_id 分组
    const sharded = this.shardByShardId(updates);
    
    // 分发到不同的 worker
    const promises = sharded.map((shardUpdates, index) => {
      const worker = this.workerPool[index % this.workerPool.length];
      return worker.postMessage(shardUpdates);
    });
    
    await Promise.all(promises);
  }
}

// Worker Thread
// redis-updater-worker.js
const { parentPort } = require('worker_threads');
const redis = require('redis');

const client = redis.createClient();

const lwwScript = `
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

parentPort.on('message', async (updates) => {
  const pipeline = client.pipeline();
  
  for (const update of updates) {
    const key = `balance:${update.accountId}:${update.currencyCode}`;
    const value = JSON.stringify({
      available: update.available,
      frozen: update.frozen
    });
    const timestamp = Date.now();
    
    pipeline.eval(lwwScript, 1, key, value, timestamp);
  }
  
  await pipeline.exec();
  parentPort.postMessage('done');
});
```

### 2.7 Leader Election

**实现**:
```typescript
class LeaderElection {
  private consumerId: string;
  private lockTTL: number = 5000; // 5s
  private renewInterval: number = 2000; // 2s
  
  async acquireLock(): Promise<boolean> {
    const result = await this.db.query(`
      INSERT INTO leader_locks (id, consumer_id, acquired_at, expires_at)
      VALUES (1, ?, NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND))
      ON DUPLICATE KEY UPDATE
        consumer_id = IF(expires_at < NOW(), VALUES(consumer_id), consumer_id),
        acquired_at = IF(expires_at < NOW(), NOW(), acquired_at),
        expires_at = IF(expires_at < NOW(), DATE_ADD(NOW(), INTERVAL ? SECOND), expires_at)
    `, [this.consumerId, this.lockTTL / 1000, this.lockTTL / 1000]);
    
    return result.affectedRows > 0;
  }
  
  async renewLock(): Promise<boolean> {
    const result = await this.db.query(`
      UPDATE leader_locks
      SET expires_at = DATE_ADD(NOW(), INTERVAL ? SECOND)
      WHERE id = 1 
        AND consumer_id = ?
        AND expires_at > NOW()
    `, [this.lockTTL / 1000, this.consumerId]);
    
    return result.affectedRows > 0;
  }
  
  async checkLockInTransaction(transaction: Transaction): Promise<boolean> {
    const result = await transaction.query(`
      SELECT consumer_id FROM leader_locks
      WHERE id = 1 AND consumer_id = ? AND expires_at > NOW()
    `, [this.consumerId]);
    
    return result.length > 0;
  }
  
  startRenewal() {
    setInterval(async () => {
      const renewed = await this.renewLock();
      if (!renewed) {
        // Lock lost, stop processing
        this.onLockLost();
      }
    }, this.renewInterval);
  }
}
```

---

## 三、数据一致性保证

### 3.1 幂等性保证

**三层防护**:
1. **Producer 端**: Outbox Pattern + Unique Index
2. **Consumer 端**: Transaction Status Check
3. **业务层**: Transaction ID 唯一性

```typescript
// Consumer 幂等性检查
async function processMessage(msg: Message) {
  const request = JSON.parse(msg.value);
  const transaction = await this.db.beginTransaction();
  
  try {
    // 检查是否已处理
    const existing = await transaction.query(`
      SELECT status FROM balance_transactions
      WHERE transaction_id = ?
    `, [request.transactionId]);
    
    if (existing.length > 0 && existing[0].status !== 'INIT') {
      // 已处理，跳过
      await transaction.commit();
      return;
    }
    
    // 处理业务逻辑
    await this.updateBalance(request, transaction);
    
    // 更新状态
    await transaction.query(`
      UPDATE balance_transactions
      SET status = 'SUCCESS'
      WHERE transaction_id = ? AND status = 'INIT'
    `, [request.transactionId]);
    
    // 检查 Leader Lock
    const isLeader = await this.leaderElection.checkLockInTransaction(transaction);
    if (!isLeader) {
      throw new Error('Lost leader lock');
    }
    
    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
```

### 3.2 事务一致性

**Transaction 绑定三件事**:
1. 余额更新状态 (WHERE status = 'INIT')
2. Consumer offset 更新
3. Leader lock 检查

```typescript
async function batchProcess(messages: Message[]) {
  const transaction = await this.db.beginTransaction();
  
  try {
    // 1. 批量更新余额
    await this.batchUpdateBalances(messages, transaction);
    
    // 2. 更新 offset
    await this.updateOffset(messages[messages.length - 1].offset, transaction);
    
    // 3. 检查 Leader Lock
    const isLeader = await this.leaderElection.checkLockInTransaction(transaction);
    if (!isLeader) {
      throw new Error('Lost leader lock');
    }
    
    await transaction.commit();
    
    // 4. 更新内存缓存
    this.updateCache(messages);
    
  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
```

---

## 四、性能优化策略

### 4.1 数据库优化

1. **索引优化**
   - 主键索引
   - 唯一索引 (account_id, currency_code)
   - 分区索引

2. **查询优化**
   - 避免全表扫描
   - 使用覆盖索引
   - 批量操作

3. **连接池**
   - 合理设置连接数
   - 连接复用
   - 超时控制

### 4.2 缓存优化

1. **内存缓存**
   - LRU 淘汰策略
   - 定期快照
   - 内存限制

2. **Redis 优化**
   - Pipeline 批量操作
   - Lua Script 原子性
   - Hash Tag 分片

### 4.3 网络优化

1. **Kafka 优化**
   - 批量发送
   - 压缩
   - 分区策略

2. **gRPC 优化**
   - 连接复用
   - 流式传输
   - 压缩

---

## 五、监控指标

### 5.1 业务指标
- TPS (Transactions Per Second)
- 成功率
- 余额准确性

### 5.2 性能指标
- P50/P95/P99 延迟
- 吞吐量
- 错误率

### 5.3 系统指标
- CPU 使用率
- 内存使用率
- 数据库连接数
- Kafka lag

### 5.4 告警规则
- TPS 下降 > 50%
- P95 延迟 > 100ms
- 错误率 > 1%
- Kafka lag > 1000

---

## 六、扩展性设计

### 6.1 水平扩展
- PM2 Cluster 模式
- Kafka Partition 增加
- 数据库 Sharding

### 6.2 垂直扩展
- 增加内存
- 增加 CPU
- SSD 存储

### 6.3 容量规划
- 单机容量评估
- 扩展阈值
- 扩容方案
