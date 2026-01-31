# 🚀 快速入门指南

欢迎使用高吞吐量余额系统！本指南将帮助你快速了解系统架构并启动服务。

## 📖 目录

1. [系统介绍](#系统介绍)
2. [架构概述](#架构概述)
3. [前置要求](#前置要求)
4. [快速启动](#快速启动)
5. [服务说明](#服务说明)
6. [验证服务](#验证服务)
7. [常见问题](#常见问题)

---

## 📖 系统介绍

### 什么是高吞吐量余额系统？

这是一个专为加密货币交易所设计的高性能余额管理系统，能够：

- **高吞吐量**: 支持每秒处理 10 万+ 笔余额更新，峰值可达 100 万 TPS
- **低延迟**: P95 延迟 < 50ms
- **高可用**: Zero Downtime 更新，支持多实例部署
- **强一致性**: 保证余额不会变负，支持幂等性
- **可扩展**: 支持千万到亿级用户

### 核心特性

✅ **性能优化**
- Single Thread Per User（消除锁竞争）
- In-Memory Cache（微秒级操作）
- Batch Processing（批量处理）
- MySQL 批量写入优化

✅ **可靠性保证**
- Event Sourcing（Kafka 作为 WAL）
- 幂等性保证（Outbox Pattern）
- Leader Election（防止脑裂）
- 错误处理（重试 + DLQ）

✅ **可扩展性**
- Sharding 支持
- 多进程架构
- Worker Threads
- 分区策略

---

## 🏗️ 架构概述

### 系统架构图

```
┌─────────────┐
│   Client    │
└──────┬──────┘
       │ HTTP/REST
       ▼
┌─────────────────┐
│  REST API Server│
└──────┬──────────┘
       │
       ▼
┌─────────────────┐
│ Outbox Service  │──┐
│ (幂等性保证)     │  │
└──────┬──────────┘  │
       │              │
       ▼              │
┌─────────────┐      │
│   MySQL     │      │
└─────────────┘      │
                     │
       ┌─────────────┘
       │
       ▼
┌─────────────┐
│    Kafka    │
│  (WAL)      │
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│ Batch Consumer  │
│ (单线程批处理)   │
└──────┬──────────┘
       │
       ├──────────────┐
       │              │
       ▼              ▼
┌─────────────┐  ┌─────────────┐
│ In-Memory   │  │ MySQL Batch │
│   Cache     │  │   Writer    │
└──────┬──────┘  └─────────────┘
       │
       ▼
┌─────────────────┐
│ Redis Updater   │
│ (Worker Threads)│
└─────────────────┘
```

### 数据流

#### 写入流程
1. **Client** 发送余额变更请求到 **REST API**
2. **Outbox Service** 写入数据库（保证幂等性）
3. **Outbox Service** 发送消息到 **Kafka**
4. **Batch Consumer** 消费消息
5. 更新 **In-Memory Cache**
6. 批量写入 **MySQL**
7. 异步更新 **Redis** 快照

#### 查询流程
1. **Client** 查询余额
2. **REST API** 优先查询 **In-Memory Cache**
3. 缓存未命中时查询 **MySQL**
4. 返回结果

---

## 📋 前置要求

### 必需软件

- **Node.js** 20.0.0 或更高版本
- **Docker** 和 **Docker Compose**
- **npm** 或 **yarn**

### 检查安装

```bash
# 检查 Node.js
node --version  # 应该 >= 20.0.0

# 检查 Docker
docker --version
docker-compose --version

# 检查 npm
npm --version
```

### 系统要求

- **内存**: 至少 4GB（推荐 8GB+）
- **磁盘**: 至少 10GB 可用空间
- **CPU**: 2 核心（推荐 4 核心+）

---

## 🚀 快速启动

### 第一步：克隆项目（如果还没有）

```bash
cd /Users/brianyu/Project/hi-poc
```

### 第二步：安装依赖

```bash
npm install
```

### 第三步：启动 Docker 服务

**方法一：使用自动化脚本（推荐）**

```bash
# 一键启动所有服务并初始化数据库
npm run setup

# 或直接运行脚本
./scripts/setup.sh
```

**方法二：手动启动**

```bash
# 1. 启动 Docker 服务
docker-compose up -d

# 2. 等待服务就绪（约 30-60 秒）
sleep 30

# 3. 初始化数据库
npm run db:init
# 或
docker-compose exec -T mysql mysql -u root -prootpassword balance_system < scripts/init-mysql.sql
```

### 第四步：验证服务

```bash
# 检查所有服务状态
docker-compose ps

# 检查 MySQL
docker-compose exec -T mysql mysqladmin ping -h localhost -u root -prootpassword

# 检查 Redis
docker-compose exec -T redis redis-cli PING

# 检查 Kafka
docker-compose exec -T kafka kafka-topics --list --bootstrap-server localhost:9092
```

### 第五步：启动应用

```bash
# 开发模式（自动重启）
npm run dev

# 或生产模式
npm run build
npm start
```

### 第六步：验证应用

应用启动后，你应该看到类似输出：

```
[INFO] Balance System starting...
[INFO] Environment: development
[INFO] Prometheus metrics server started
[INFO] REST API Server started
[INFO] Consumer started as leader
[INFO] Redis Updater Worker started
[INFO] Balance System started successfully
```

---

## 🔧 服务说明

### Docker 服务

系统使用 Docker Compose 管理以下服务：

| 服务 | 端口 | 说明 |
|------|------|------|
| MySQL | 3306 | 主数据库 |
| Redis | 6379 | 缓存和快照 |
| Kafka | 9092 | 消息队列（WAL） |
| Zookeeper | 2181 | Kafka 协调服务 |
| Prometheus | 9090 | 指标收集 |
| Grafana | 3000 | 监控面板 |
| Loki | 3100 | 日志聚合 |
| Promtail | - | 日志收集 |

### 应用服务

应用启动后提供以下服务：

| 服务 | 端口 | 说明 |
|------|------|------|
| REST API | 3000 | 余额查询和变更 API |
| Prometheus Metrics | 9091 | 应用指标端点 |

### 环境变量

可以通过环境变量控制启动哪些组件：

```bash
# 只启动 API Server
START_CONSUMER=false START_REDIS_UPDATER=false npm run dev

# 只启动 Consumer
START_API=false START_REDIS_UPDATER=false npm run dev

# 只启动 Redis Updater
START_API=false START_CONSUMER=false npm run dev
```

---

## ✅ 验证服务

### 1. 检查服务状态

```bash
# Docker 服务
docker-compose ps

# 应用日志
# 查看终端输出，应该看到所有服务启动成功
```

### 2. 访问监控面板

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin/admin)
- **Metrics**: http://localhost:9091/metrics

### 3. 测试 REST API

使用 curl 或任何 HTTP 客户端工具：

```bash
# 测试健康检查
curl http://localhost:3000/health

# 查询余额
curl http://localhost:3000/api/v1/balance/1/USDT

# 变更余额（充值）
curl -X POST http://localhost:3000/api/v1/balance/change \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "tx_001",
    "account_id": 1,
    "user_id": "user_001",
    "currency_code": "USDT",
    "type": 0,
    "amount": "100.00",
    "description": "测试充值"
  }'
```

### 4. 查看日志

```bash
# Docker 服务日志
docker-compose logs -f mysql
docker-compose logs -f kafka
docker-compose logs -f redis

# 应用日志
# 日志文件在 logs/ 目录下
tail -f logs/app.log
```

---

## 📊 监控和指标

### Prometheus 指标

应用暴露以下指标（访问 http://localhost:9091/metrics）：

- `balance_consumer_messages_total` - 消费的消息总数
- `balance_consumer_batches_total` - 处理的批次总数
- `balance_consumer_batch_duration_ms` - 批次处理延迟
- `balance_consumer_batch_size` - 批次大小
- `balance_consumer_success_total` - 成功处理数
- `balance_consumer_failed_total` - 失败处理数
- `balance_outbox_events_created_total` - 创建的 Outbox 事件数

### Grafana 仪表板

1. 访问 http://localhost:3000
2. 登录（admin/admin）
3. 数据源已自动配置（Prometheus 和 Loki）
4. 可以创建自定义仪表板

---

## 🧪 测试示例

### 创建测试账户

```sql
-- 连接到 MySQL
docker-compose exec mysql mysql -u root -prootpassword balance_system

-- 插入测试账户
INSERT INTO accounts (user_id, shard_id) VALUES ('test_user_1', 1);
INSERT INTO accounts (user_id, shard_id) VALUES ('test_user_2', 1);

-- 查看账户
SELECT * FROM accounts;
```

### 使用 REST API 测试

```bash
# 查询余额（需要先创建账户）
curl http://localhost:3000/api/v1/balance/1/USDT

# 变更余额（充值）
curl -X POST http://localhost:3000/api/v1/balance/change \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "tx_001",
    "account_id": 1,
    "user_id": "test_user_1",
    "currency_code": "USDT",
    "type": 0,
    "amount": "100.00",
    "description": "测试充值"
  }'

# 变更余额（提现）
curl -X POST http://localhost:3000/api/v1/balance/change \
  -H "Content-Type: application/json" \
  -d '{
    "transaction_id": "tx_002",
    "account_id": 1,
    "user_id": "test_user_1",
    "currency_code": "USDT",
    "type": 1,
    "amount": "50.00",
    "description": "测试提现"
  }'
```

---

## ❓ 常见问题

### 1. "the input device is not a TTY" 错误

**解决方案**: 使用提供的脚本或添加 `-T` 标志

```bash
# ✅ 正确
docker-compose exec -T mysql mysql ...

# ❌ 错误
docker-compose exec mysql mysql ...
```

### 2. 端口被占用

```bash
# 检查端口占用
lsof -i :3306  # MySQL
lsof -i :6379  # Redis
lsof -i :9092  # Kafka

# 修改 docker-compose.yml 中的端口映射
```

### 3. 服务启动失败

```bash
# 查看日志
docker-compose logs [service_name]

# 重启服务
docker-compose restart [service_name]

# 完全重启
docker-compose down
docker-compose up -d
```

### 4. 数据库连接失败

```bash
# 检查 MySQL 是否运行
docker-compose ps mysql

# 检查连接
docker-compose exec -T mysql mysqladmin ping -h localhost -u root -prootpassword

# 查看 MySQL 日志
docker-compose logs mysql
```

### 5. Kafka Topic 不存在

```bash
# 创建 Topics
docker-compose exec -T kafka kafka-topics --create \
    --topic balance-changes \
    --bootstrap-server localhost:9092 \
    --partitions 3 \
    --replication-factor 1
```

更多问题请参考 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md)

---

## 📚 下一步

1. **阅读架构文档**: [ARCHITECTURE.md](./ARCHITECTURE.md)
2. **查看已完成功能**: [FEATURES_COMPLETED.md](./FEATURES_COMPLETED.md)
3. **了解配置**: [../src/config/index.ts](../src/config/index.ts)
4. **查看 API 定义**: [../src/api/rest/server.ts](../src/api/rest/server.ts)
5. **PM2 使用指南**: [PM2_GUIDE.md](./PM2_GUIDE.md)

---

## 🎯 快速命令参考

```bash
# 启动所有服务
npm run setup

# 初始化数据库
npm run db:init

# 启动应用（开发模式）
npm run dev

# 构建项目
npm run build

# 启动应用（生产模式）
npm start

# 使用 PM2 启动
npm run start:pm2

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f

# 停止所有服务
docker-compose down
```

---

**祝你使用愉快！** 🎉

如有问题，请查看 [TROUBLESHOOTING.md](./TROUBLESHOOTING.md) 或提交 Issue。
