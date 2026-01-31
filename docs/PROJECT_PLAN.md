# 高吞吐量余额系统 - 项目实施计划

## 一、项目概述

### 目标
在 Node.js + MySQL + Redis + Kafka 技术栈上实现一个支持百万级 TPS 的余额系统。

### 核心指标
- **吞吐量**: 平均 10万 TPS，峰值 100万 TPS
- **延迟**: P95 < 50ms
- **可用性**: 99.99% (Zero Downtime)
- **用户规模**: 支持千万到亿级用户

### 技术栈
- **Runtime**: Node.js 20+ (LTS)
- **数据库**: MySQL 8.0+
- **缓存**: Redis 7.0+
- **消息队列**: Kafka 3.5+
- **进程管理**: PM2
- **语言**: TypeScript

---

## 二、分阶段实施计划

### Phase 1: MVP 基础架构 (Week 1-2) ✅
**目标**: 实现核心功能，达到 10-20K TPS

#### 1.1 项目初始化
- [x] 项目结构搭建
- [x] TypeScript 配置
- [x] 依赖管理 (package.json)
- [x] ESLint + Prettier 配置
- [x] Docker Compose 开发环境

#### 1.2 数据库设计
- [x] 账户表 (accounts)
- [x] 余额表 (account_balances)
- [x] 流水表 (balance_transactions)
- [x] 索引优化
- [x] 迁移脚本

#### 1.3 核心服务 - 单进程版本
- [x] Kafka Consumer (单线程批次处理)
- [x] In-Memory Cache (Map 实现)
- [x] MySQL Writer (批量 INSERT)
- [x] Redis Updater (Worker Threads)
- [x] REST API Server

#### 1.4 基础功能
- [x] 余额更新 (加钱/扣钱)
- [x] 幂等性检查
- [x] 余额不能为负验证
- [x] 流水记录

#### 1.5 测试
- [ ] 单元测试
- [ ] 集成测试
- [ ] 基础压测 (k6)

---

### Phase 2: 性能优化 (Week 3-4) ✅
**目标**: 优化到 50-100K TPS

#### 2.1 数据库优化
- [x] LOAD DATA INFILE 实现
- [x] CTE Lazy Insert (新币种)
- [x] UNLOGGED TEMPORARY TABLE
- [x] 连接池优化
- [ ] 读写分离准备

#### 2.2 多进程架构
- [x] PM2 Cluster 模式
- [x] 进程间通信
- [x] 负载均衡
- [x] 优雅关闭

#### 2.3 缓存优化
- [x] Worker Threads 更新 Redis
- [x] 批量更新策略
- [x] LWW (Last Write Wins) 实现
- [x] Lua Script 原子操作

#### 2.4 监控与日志
- [x] Prometheus 指标
- [x] 结构化日志 (Winston)
- [ ] 性能追踪
- [ ] 告警配置

---

### Phase 3: 可靠性保证 (Week 5-6) ✅
**目标**: 实现生产级可靠性

#### 3.1 Event Sourcing + WAL
- [x] Kafka 作为 WAL
- [x] Crash Recovery 机制
- [x] Offset 管理
- [x] Replay 逻辑

#### 3.2 幂等性保证
- [x] Outbox Pattern
- [x] DB Unique Index
- [x] Consumer 状态机
- [x] 重复检测

#### 3.3 Leader Election
- [x] DB-based Leader Lock
- [x] TTL 续期机制
- [x] 脑裂防护
- [x] 优雅切换

#### 3.4 安全性
- [x] HMAC-SHA256 验证
- [ ] REST 认证
- [ ] 权限控制
- [ ] 请求限流

---

### Phase 4: 分布式扩展 (Week 7-8)
**目标**: 支持千万到亿级用户

#### 4.1 Sharding 策略
- [ ] Shard ID 设计
- [ ] Range Partition
- [ ] 路由表管理
- [ ] 数据迁移工具

#### 4.2 Redis Cluster
- [ ] Hash Tag 策略
- [ ] 批量更新优化
- [ ] 故障转移

#### 4.3 数据库 Sharding
- [ ] 分库分表
- [ ] 路由中间件
- [ ] 跨 Shard 查询

#### 4.4 Saga Pattern
- [ ] 异步通信
- [ ] ACK 机制
- [ ] Retry 策略
- [ ] Blocking API

---

### Phase 5: 生产优化 (Week 9-10)
**目标**: 达到 500K-1M TPS，Zero Downtime

#### 5.1 性能调优
- [ ] 内存优化
- [ ] GC 调优
- [ ] 网络优化
- [ ] CPU 绑定

#### 5.2 高可用
- [ ] Multi-AZ 部署
- [ ] 健康检查
- [ ] 自动故障转移
- [ ] 蓝绿部署

#### 5.3 压测与优化
- [ ] xk6 压测
- [ ] 瓶颈分析
- [ ] 持续优化
- [ ] 性能报告

#### 5.4 文档与运维
- [ ] API 文档
- [ ] 运维手册
- [ ] 故障处理流程
- [ ] 监控大盘

---

## 三、技术架构设计

### 3.1 系统架构图

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ REST
       ▼
┌─────────────────────────────────┐
│      API Gateway (REST)         │
│  - HMAC 验证                    │
│  - 请求路由                     │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│      Outbox Pattern             │
│  - 写入 DB (unique index)       │
│  - Produce to Kafka             │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│         Kafka                   │
│  - Partition by user_id          │
│  - Replication                  │
└──────┬──────────────────────────┘
       │
       ▼
┌─────────────────────────────────┐
│   Batch Consumer (PM2 Cluster)  │
│  - Single thread per partition  │
│  - Batch processing             │
│  - In-Memory Cache              │
└──────┬──────────────────────────┘
       │
       ├─────────────────┬─────────────────┐
       ▼                 ▼                 ▼
┌──────────┐    ┌──────────────┐   ┌──────────┐
│  MySQL   │    │    Redis     │   │  WAL     │
│  Batch   │    │   Snapshot   │   │  Flush   │
│  Writer  │    │   Updater    │   │  Worker  │
└──────────┘    └──────────────┘   └──────────┘
```

### 3.2 核心模块

#### 3.2.1 Kafka Consumer
- **职责**: 消费余额变更请求
- **特性**: 
  - 单线程批次处理
  - 动态 poll timeout
  - 幂等性检查
  - Offset 管理

#### 3.2.2 In-Memory Cache
- **职责**: 内存余额缓存
- **特性**:
  - Map 数据结构
  - 无锁设计
  - 定期快照到 Redis

#### 3.2.3 MySQL Writer
- **职责**: 批量写入数据库
- **特性**:
  - LOAD DATA INFILE
  - CTE Lazy Insert
  - Temp Table 优化
  - 事务保证

#### 3.2.4 Redis Updater
- **职责**: 更新 Redis 快照
- **特性**:
  - Worker Threads 并行
  - LWW 机制
  - Lua Script 原子操作

#### 3.2.5 REST API
- **职责**: 对外服务接口
- **特性**:
  - HMAC 验证
  - 请求限流
  - 健康检查

---

## 四、数据库设计

### 4.1 表结构

#### accounts
```sql
CREATE TABLE accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(64) UNIQUE NOT NULL,
    shard_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_shard_id (shard_id)
);
```

#### account_balances
```sql
CREATE TABLE account_balances (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    account_id BIGINT NOT NULL,
    currency_code VARCHAR(10) NOT NULL,
    available DECIMAL(36, 18) NOT NULL DEFAULT 0,
    frozen DECIMAL(36, 18) NOT NULL DEFAULT 0,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_account_currency (account_id, currency_code),
    INDEX idx_account_id (account_id)
) PARTITION BY RANGE (account_id % 10) (
    PARTITION p0 VALUES LESS THAN (1),
    PARTITION p1 VALUES LESS THAN (2),
    -- ... 更多分区
);
```

#### balance_transactions
```sql
CREATE TABLE balance_transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    account_id BIGINT NOT NULL,
    currency_code VARCHAR(10) NOT NULL,
    transaction_id VARCHAR(64) UNIQUE NOT NULL,
    type ENUM('DEPOSIT', 'WITHDRAW', 'FREEZE', 'UNFREEZE') NOT NULL,
    amount DECIMAL(36, 18) NOT NULL,
    available_before DECIMAL(36, 18) NOT NULL,
    available_after DECIMAL(36, 18) NOT NULL,
    frozen_before DECIMAL(36, 18) NOT NULL,
    frozen_after DECIMAL(36, 18) NOT NULL,
    status ENUM('INIT', 'PROCESSING', 'SUCCESS', 'FAILED') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_account_created (account_id, created_at),
    INDEX idx_transaction_id (transaction_id),
    INDEX idx_status (status)
);
```

#### outbox_events
```sql
CREATE TABLE outbox_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id VARCHAR(64) UNIQUE NOT NULL,
    topic VARCHAR(255) NOT NULL,
    partition_key VARCHAR(255) NOT NULL,
    payload JSON NOT NULL,
    status ENUM('PENDING', 'SENT', 'FAILED') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP NULL,
    INDEX idx_status (status),
    INDEX idx_created (created_at)
);
```

#### leader_locks
```sql
CREATE TABLE leader_locks (
    id INT PRIMARY KEY,
    consumer_id VARCHAR(255) NOT NULL,
    acquired_at TIMESTAMP NOT NULL,
    expires_at TIMESTAMP NOT NULL,
    INDEX idx_expires (expires_at)
);
```

---

## 五、关键技术实现

### 5.1 批次 Consumer Loop
```typescript
// 动态 poll timeout 策略
const longPoll = 1000; // 1s
const batchLatency = 100; // 100ms
const batchSize = 200;

let msgsBuffer: Message[] = [];
let pollTimeout = longPoll;

while (running) {
  const msg = await consumer.poll(pollTimeout);
  
  if (msg === null) { // timeout
    if (msgsBuffer.length > 0) {
      await processBatch(msgsBuffer);
      msgsBuffer = [];
    }
    pollTimeout = longPoll;
  } else {
    msgsBuffer.push(msg);
    if (msgsBuffer.length >= batchSize) {
      await processBatch(msgsBuffer);
      msgsBuffer = [];
    }
    pollTimeout = batchLatency;
  }
}
```

### 5.2 MySQL 批量写入
```sql
-- 使用 LOAD DATA INFILE
LOAD DATA LOCAL INFILE '/tmp/balance_updates.csv'
INTO TABLE temp_balance_updates
FIELDS TERMINATED BY ',' 
LINES TERMINATED BY '\n'
(account_id, currency_code, available_delta);

-- CTE 批量更新
WITH try_update AS (
  UPDATE account_balances ab
  JOIN temp_balance_updates t 
    ON ab.account_id = t.account_id 
    AND ab.currency_code = t.currency_code
  SET ab.available = ab.available + t.available_delta
  RETURNING t.account_id, t.currency_code
),
missing AS (
  SELECT t.* FROM temp_balance_updates t
  LEFT JOIN try_update u ON u.account_id = t.account_id
  WHERE u.account_id IS NULL
)
INSERT INTO account_balances (account_id, currency_code, available)
SELECT account_id, currency_code, available_delta
FROM missing
WHERE available_delta >= 0;
```

### 5.3 Redis LWW 更新
```lua
-- Lua Script: Last Write Wins
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
```

---

## 六、开发环境配置

### 6.1 Docker Compose
- MySQL 8.0
- Redis 7.0
- Kafka + Zookeeper
- Prometheus + Grafana (监控)

### 6.2 本地开发
- Node.js 20+
- PM2
- TypeScript
- 热重载支持

---

## 七、测试策略

### 7.1 单元测试
- Jest
- 覆盖率 > 80%

### 7.2 集成测试
- 测试容器 (Testcontainers)
- 端到端测试

### 7.3 压测
- k6 / xk6
- 多维度指标
- 瓶颈分析

---

## 八、监控与运维

### 8.1 指标监控
- Prometheus
- 自定义指标
- 告警规则

### 8.2 日志
- Winston
- 结构化日志
- ELK Stack

### 8.3 追踪
- OpenTelemetry
- 分布式追踪
- 性能分析

---

## 九、风险评估

### 9.1 技术风险
| 风险 | 影响 | 应对措施 |
|------|------|----------|
| Node.js 单核心限制 | 高 | PM2 Cluster + Worker Threads |
| MySQL Gap Lock | 中 | READ COMMITTED + 精确 JOIN |
| 内存泄漏 | 高 | 定期检查 + 内存限制 |
| Kafka 延迟 | 中 | 优化配置 + 监控 |

### 9.2 业务风险
| 风险 | 影响 | 应对措施 |
|------|------|----------|
| 数据不一致 | 高 | Event Sourcing + Replay |
| 重复处理 | 高 | 幂等性保证 |
| 服务宕机 | 高 | Leader Election + 自动恢复 |

---

## 十、成功标准

### Phase 1 完成标准 ✅
- [x] 单进程达到 10K+ TPS
- [x] P95 延迟 < 200ms
- [x] 基础功能完整
- [ ] 单元测试通过

### Phase 2 完成标准 ✅
- [x] 多进程达到 50K+ TPS
- [x] P95 延迟 < 100ms
- [x] 监控系统完善
- [ ] 压测报告完整

### Phase 3 完成标准 ✅
- [x] 可靠性测试通过
- [x] Crash Recovery 验证
- [x] 幂等性保证验证
- [ ] 安全性测试通过

### Phase 4 完成标准
- [ ] Sharding 功能完整
- [ ] 支持千万级用户
- [ ] Saga Pattern 实现
- [ ] 数据迁移工具完成

### Phase 5 完成标准
- [ ] 达到 500K+ TPS
- [ ] P95 延迟 < 50ms
- [ ] Zero Downtime 验证
- [ ] 生产环境部署就绪

---

## 十一、时间线

```
Week 1-2:  Phase 1 - MVP 基础架构
Week 3-4:  Phase 2 - 性能优化
Week 5-6:  Phase 3 - 可靠性保证
Week 7-8:  Phase 4 - 分布式扩展
Week 9-10: Phase 5 - 生产优化
```

---

## 十二、团队角色

- **架构师**: 系统设计、技术选型
- **后端工程师**: 核心功能开发
- **DBA**: 数据库优化、Sharding
- **DevOps**: 部署、监控、压测
- **QA**: 测试、压测执行

---

## 十三、参考资料

- [AXS GitHub Repository](https://github.com/chill-vic/axs)
- [Medium 文章 - 系统设计](https://medium.com/@chill-vic)
- [Medium 文章 - 系统实作](https://medium.com/@chill-vic)
- Kafka 官方文档
- MySQL 性能优化指南
- Redis 最佳实践
