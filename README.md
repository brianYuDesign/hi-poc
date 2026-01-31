# 高吞吐量余额系统 (Hi-PoC)

基于 Node.js + MySQL + Redis + Kafka 的高吞吐量余额系统实现。

## 项目概述

本项目旨在实现一个支持百万级 TPS 的余额系统，核心特性包括：

- **高吞吐量**: 平均 10万 TPS，峰值 100万 TPS
- **低延迟**: P95 < 50ms
- **高可用**: 99.99% 可用性，Zero Downtime
- **可扩展**: 支持千万到亿级用户

## 技术栈

- **Runtime**: Node.js 20+ (LTS)
- **Language**: TypeScript
- **Database**: MySQL 8.0+
- **Cache**: Redis 7.0+
- **Message Queue**: Kafka 3.5+
- **Process Manager**: PM2
- **Monitoring**: Prometheus + Grafana

## 核心架构

### 系统架构图

```
Client → API Gateway → Outbox Pattern → Kafka → Batch Consumer → In-Memory Cache
                                                      ↓
                                              MySQL / Redis
```

### 核心设计

1. **消除锁竞争**: Single Thread Per User + Batch Processing
2. **In-Memory Cache**: 微秒级操作，达到百万级吞吐
3. **Event Sourcing**: Kafka 作为 WAL，支持 Crash Recovery
4. **幂等性保证**: Outbox Pattern + Unique Index
5. **Leader Election**: 防止脑裂，保证一致性

## 🚀 快速开始

> 📖 **新手入门？** 请先阅读 [GETTING_STARTED.md](./GETTING_STARTED.md) 获取详细的入门指南和系统介绍。

### 前置要求

- Node.js 20+
- Docker & Docker Compose
- MySQL 8.0+ (或使用 Docker)
- Redis 7.0+ (或使用 Docker)
- Kafka 3.5+ (或使用 Docker)

### 一键启动（推荐）

```bash
# 1. 安装依赖
npm install

# 2. 启动所有服务并初始化
npm run setup

# 3. 启动应用
npm run dev
```

### 手动启动

```bash
# 1. 安装依赖
npm install

# 2. 启动 Docker 服务
docker-compose up -d

# 3. 初始化数据库
npm run db:init

# 4. 启动应用
npm run dev
```

### 启动生产环境

```bash
# 构建项目
npm run build

# 使用 PM2 启动
npm run start:pm2
```

## 项目结构

```
hi-poc/
├── src/
│   ├── api/              # API 服务
│   ├── consumer/          # Kafka Consumer
│   ├── services/          # 业务服务
│   ├── db/                # 数据库相关
│   ├── cache/             # 缓存相关
│   ├── workers/           # Worker Threads
│   ├── utils/             # 工具函数
│   ├── types/             # TypeScript 类型定义
│   └── config/            # 配置管理
├── scripts/               # 脚本文件
├── config/                # 配置文件
├── logs/                  # 日志文件
├── docker-compose.yml     # Docker Compose 配置
├── ecosystem.config.js    # PM2 配置
└── package.json
```

## 开发计划

### Phase 1: MVP 基础架构 (Week 1-2) ✅
- [x] 项目结构搭建
- [x] 数据库设计
- [x] 核心服务实现
- [x] 基础功能测试

### Phase 2: 性能优化 (Week 3-4) ✅
- [x] 数据库优化 (LOAD DATA INFILE)
- [x] 多进程架构 (PM2 Cluster)
- [x] 缓存优化 (In-Memory + Redis)
- [x] 监控系统 (Prometheus + Grafana)

### Phase 3: 可靠性保证 (Week 5-6) ✅
- [x] Event Sourcing + WAL (Kafka)
- [x] 幂等性保证 (Outbox Pattern)
- [x] Leader Election
- [x] 安全性 (HMAC)

### Phase 4: 分布式扩展 (Week 7-8)
- [ ] Sharding 策略
- [ ] Redis Cluster
- [ ] 数据库 Sharding
- [ ] Saga Pattern

### Phase 5: 生产优化 (Week 9-10)
- [ ] 性能调优
- [ ] 高可用部署
- [ ] 压测与优化
- [ ] 文档与运维

详细计划请参考 [PROJECT_PLAN.md](./PROJECT_PLAN.md)

## 配置说明

### 环境变量

创建 `.env` 文件：

```env
NODE_ENV=development
PORT=50051

# MySQL
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=appuser
MYSQL_PASSWORD=apppassword
MYSQL_DATABASE=balance_system

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Kafka
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=balance-system
KAFKA_CONSUMER_GROUP=balance-consumer-group

# Security
HMAC_SECRET=your-secret-key-change-in-production
```

### PM2 配置

使用 `ecosystem.config.js` 配置多进程部署：

- `balance-api`: API 服务 (1 实例)
- `balance-consumer`: Kafka Consumer (3 实例)
- `balance-redis-updater`: Redis Updater (4 Worker Threads)

## 测试

```bash
# 运行单元测试
npm test

# 运行测试并生成覆盖率报告
npm run test:coverage

# 运行集成测试
npm run test:integration
```

## 监控

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000 (admin/admin)

## 📚 文档

所有文档位于 [`docs/`](./docs/) 目录：

- **[快速入门指南](./docs/GETTING_STARTED.md)** ⭐ - 新手必读，包含系统介绍和启动步骤
- [项目计划](./docs/PROJECT_PLAN.md) - 详细的项目实施计划
- [架构设计](./docs/ARCHITECTURE.md) - 系统架构设计文档
- [快速开始](./docs/QUICKSTART.md) - 快速启动指南
- [决策总结](./docs/DECISIONS_SUMMARY.md) - 技术决策汇总
- [功能完成清单](./docs/FEATURES_COMPLETED.md) - 已完成功能列表

完整文档索引请查看 [docs/README.md](./docs/README.md)

## 性能目标

| 指标 | 目标值 |
|------|--------|
| 平均 TPS | 10万 |
| 峰值 TPS | 100万 |
| P95 延迟 | < 50ms |
| 可用性 | 99.99% |
| 用户规模 | 千万到亿级 |

## 参考资料

- [AXS GitHub Repository](https://github.com/chill-vic/axs) - 原始 Golang 实现
- [Medium 文章 - 系统设计](https://medium.com/@chill-vic)
- [Medium 文章 - 系统实作](https://medium.com/@chill-vic)

## License

MIT
