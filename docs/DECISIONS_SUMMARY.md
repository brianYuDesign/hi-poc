# 决策总结

本文档记录所有关键决策及其理由。

## 决策概览

| # | 议题 | 决策 | 日期 | 状态 |
|---|------|------|------|------|
| 1 | API 协议 | 混合方案（内部 gRPC + 对外 REST） | 2024-01-XX | ✅ |
| 2 | 监控方案 | Prometheus + Grafana | 2024-01-XX | ✅ |
| 3 | 日志方案 | Loki + Grafana | 2024-01-XX | ✅ |
| 4 | 部署方案 | Docker Compose + PM2 | 2024-01-XX | ✅ |
| 5 | 连接池策略 | 小型服务器配置 | 2024-01-XX | ✅ |
| 6 | 分区策略 | 保持 3 个分区 | 2024-01-XX | ✅ |
| 7 | 错误处理 | 重试 + DLQ 组合 | 2024-01-XX | ✅ |

---

## 详细决策记录

### 1. API 协议选择

**决策**: 混合方案（内部 gRPC + 对外 REST）

**理由**:
- 内部服务间通信使用 gRPC，获得最佳性能
- 对外 API 使用 REST，保证兼容性
- 可以分阶段实施（先 gRPC，后 REST）

**实施**:
- Phase 1: 实现 gRPC API（内部服务）
- Phase 2: 实现 REST API（对外服务）

**配置文件**:
- `src/api/grpc/` - gRPC 服务
- `src/api/rest/` - REST API（待实现）

---

### 2. 监控方案

**决策**: Prometheus + Grafana

**理由**:
- 已在 docker-compose 中配置
- 开源免费，适合 PoC 和初期项目
- 功能完整，满足需求
- 后续可以迁移到商业方案

**实施**:
- ✅ Prometheus 已配置
- ✅ Grafana 已配置
- ✅ 数据源已配置

**访问地址**:
- Prometheus: http://localhost:9090
- Grafana: http://localhost:3000

---

### 3. 日志方案

**决策**: Loki + Grafana

**理由**:
- 轻量级，适合 PoC
- 与已有 Grafana 集成
- 功能足够（搜索、过滤、可视化）
- 后续可以升级到 ELK

**实施**:
- ✅ Loki 已添加到 docker-compose
- ✅ Promtail 已配置（日志收集）
- ✅ Grafana 数据源已配置

**配置**:
- `config/loki-config.yml` - Loki 配置
- `config/promtail-config.yml` - Promtail 配置
- `config/grafana-datasources.yml` - Grafana 数据源

---

### 4. 部署方案

**决策**: Docker Compose + PM2（PoC 阶段）

**理由**:
- PoC 阶段，简单直接
- 易于理解和管理
- 资源消耗低
- 快速部署和验证

**后续计划**:
- 生产环境考虑迁移到 Kubernetes

**配置**:
- `docker-compose.yml` - Docker 服务编排
- `ecosystem.config.js` - PM2 进程管理

---

### 5. 数据库连接池策略

**决策**: 小型服务器配置

**参数**:
- 连接池大小: **15**
- 队列限制: **100**
- 连接超时: **30 秒**

**理由**:
- 小型服务器（2-4 核）
- 低并发场景
- 队列限制避免内存溢出

**配置位置**:
- `src/config/index.ts` - 配置定义
- `src/db/connection.ts` - 连接池实现

**环境变量**:
```env
MYSQL_CONNECTION_LIMIT=15
MYSQL_QUEUE_LIMIT=100
MYSQL_CONNECT_TIMEOUT=30000
```

---

### 6. Kafka 分区策略

**决策**: 保持 3 个分区

**理由**:
- 适合 PoC 阶段
- 3 个 Consumer 实例
- 资源消耗低
- 简单管理

**当前配置**:
- 分区数: 3
- Consumer 实例数: 3（PM2 cluster）
- 1:1 映射关系

**后续扩展**:
- 如需更多并行度，可增加到 10-20 个分区

**配置位置**:
- `docker-compose.yml` - Kafka 配置
- `ecosystem.config.js` - Consumer 实例数

---

### 7. 错误处理策略

**决策**: 重试 + DLQ 组合

**策略**:
1. **前 3 次失败**: 自动重试（指数退避）
   - 第 1 次: 1 秒后重试
   - 第 2 次: 2 秒后重试
   - 第 3 次: 4 秒后重试

2. **超过 3 次**: 发送到死信队列（DLQ）
   - Topic: `balance-changes-dlq`
   - 包含原始消息和错误信息
   - 可后续手动处理

3. **非重试错误**: 直接进入 DLQ
   - 数据格式错误
   - 权限错误
   - 验证错误

**实施**:
- ✅ `src/utils/error-handler.ts` - 错误处理实现
- ✅ 配置已添加到 `src/config/index.ts`

**配置参数**:
```typescript
consumer: {
  retry: {
    maxRetries: 3,
    retryInterval: 1000, // ms
    retryBackoffMultiplier: 2,
    dlqTopic: 'balance-changes-dlq',
  }
}
```

**DLQ 消息格式**:
```json
{
  "originalTopic": "balance-changes",
  "originalOffset": "12345",
  "originalKey": "user_id",
  "originalValue": "{...}",
  "error": {
    "message": "Error message",
    "stack": "Error stack",
    "name": "ErrorType"
  },
  "retryCount": 3,
  "failedAt": "2024-01-XX..."
}
```

---

## 配置更新清单

### ✅ 已更新配置

1. **数据库连接池** (`src/config/index.ts`, `src/db/connection.ts`)
   - 连接池: 15
   - 队列限制: 100
   - 连接超时: 30 秒

2. **Kafka 分区** (`docker-compose.yml`)
   - 保持 3 个分区

3. **错误处理** (`src/config/index.ts`, `src/utils/error-handler.ts`)
   - 重试策略: 3 次，指数退避
   - DLQ Topic: `balance-changes-dlq`

4. **日志系统** (`docker-compose.yml`, `config/`)
   - Loki + Promtail 已添加
   - Grafana 数据源已配置

---

## 下一步行动

1. ✅ 所有关键决策已完成
2. ⏳ 开始实现核心服务（参考 IMPLEMENTATION_ROADMAP.md）
3. ⏳ 创建 DLQ Topic（Kafka）
4. ⏳ 实现错误处理逻辑（Consumer）
5. ⏳ 添加监控指标（Prometheus）

---

## 决策回顾

如需修改决策，请：
1. 更新本文档
2. 更新 `IMPLEMENTATION_ROADMAP.md`
3. 更新相关配置文件
4. 记录修改理由

---

**最后更新**: 2024-01-XX
**状态**: 所有关键决策已完成 ✅
