# 快速开始指南

## 前置要求

确保你的系统已安装：

- **Node.js** 20+ (LTS)
- **Docker** & **Docker Compose**
- **npm** 或 **yarn**

## 第一步：安装依赖

```bash
npm install
```

## 第二步：启动开发环境

### 启动 Docker 服务

```bash
# 启动所有服务（MySQL, Redis, Kafka, Prometheus, Grafana）
docker-compose up -d

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 等待服务就绪

等待所有服务启动完成（约 30-60 秒），你可以通过以下命令检查：

```bash
# 检查 MySQL
docker-compose exec mysql mysqladmin ping -h localhost -u root -prootpassword

# 检查 Redis
docker-compose exec redis redis-cli ping

# 检查 Kafka
docker-compose exec kafka kafka-broker-api-versions --bootstrap-server localhost:9092
```

## 第三步：初始化数据库

```bash
# 运行数据库初始化脚本
docker-compose exec mysql mysql -u root -prootpassword balance_system < scripts/init-mysql.sql

# 或者使用 MySQL 客户端连接后执行
docker-compose exec mysql mysql -u root -prootpassword balance_system
# 然后执行: source /docker-entrypoint-initdb.d/init.sql
```

## 第四步：配置环境变量

创建 `.env` 文件（可选，已有默认值）：

```bash
cp .env.example .env  # 如果存在
```

编辑 `.env` 文件：

```env
NODE_ENV=development
PORT=3000

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

## 第五步：启动应用

### 开发模式

```bash
# 启动开发服务器（热重载）
npm run dev
```

### 生产模式

```bash
# 构建项目
npm run build

# 使用 PM2 启动
npm run start:pm2

# 查看 PM2 状态
pm2 status

# 查看日志
pm2 logs
```

## 验证安装

### 1. 检查服务健康

```bash
# REST 健康检查（需要指定 proto 文件）
curl -proto src/api/proto/balance.proto -plaintext localhost:3000 balance.BalanceService/HealthCheck

# Prometheus 指标
curl http://localhost:9091/metrics
```

### 2. 检查数据库

```bash
# 使用 -T 标志避免 TTY 错误
docker-compose exec -T mysql mysql -u root -prootpassword balance_system -e "SHOW TABLES;"
```

### 3. 检查 Redis

```bash
# 使用 -T 标志
docker-compose exec -T redis redis-cli PING
docker-compose exec -T redis redis-cli KEYS '*'

# 或交互式（需要 TTY）
docker-compose exec redis redis-cli
```

### 4. 检查 Kafka

```bash
# 列出 Topics（使用 -T 标志）
docker-compose exec -T kafka kafka-topics --list --bootstrap-server localhost:9092

# 创建测试 Topic（如果需要）
docker-compose exec -T kafka kafka-topics --create --topic test-topic --bootstrap-server localhost:9092 --partitions 3 --replication-factor 1
```

## 访问监控面板

- **Prometheus**: http://localhost:9090
- **Grafana**: http://localhost:3000
  - 用户名: `admin`
  - 密码: `admin`

## 常见问题

### 1. "the input device is not a TTY" 错误

**问题**: 在非交互式环境中运行 Docker 命令时出现此错误

**解决方案**: 在 `docker-compose exec` 命令中添加 `-T` 标志

```bash
# ❌ 错误
docker-compose exec mysql mysql -u root -prootpassword ...

# ✅ 正确
docker-compose exec -T mysql mysql -u root -prootpassword ...
```

**注意**: 如果需要在交互式环境中运行（如进入容器），不要使用 `-T` 标志

### 2. Docker 服务启动失败

```bash
# 检查端口占用
lsof -i :3306  # MySQL
lsof -i :6379  # Redis
lsof -i :9092  # Kafka

# 清理并重启
docker-compose down
docker-compose up -d
```

### 3. MySQL 连接失败

```bash
# 检查 MySQL 是否运行
docker-compose ps mysql

# 查看 MySQL 日志
docker-compose logs mysql

# 检查 MySQL 配置（使用 -T 标志）
docker-compose exec -T mysql mysql -u root -prootpassword -e "SHOW VARIABLES LIKE 'local_infile';"
```

### 4. Kafka 连接失败

```bash
# 检查 Kafka 是否运行
docker-compose ps kafka

# 查看 Kafka 日志
docker-compose logs kafka

# 检查 Zookeeper 连接（使用 -T 标志）
docker-compose exec -T kafka kafka-broker-api-versions --bootstrap-server localhost:9092
```

### 4. 权限问题

```bash
# 确保脚本有执行权限
chmod +x scripts/*.sh

# 确保日志目录可写
mkdir -p logs
chmod 755 logs
```

## 开发工作流

### 1. 代码开发

```bash
# 启动开发服务器（自动重载）
npm run dev

# 在另一个终端运行测试
npm test
```

### 2. 代码检查

```bash
# 运行 ESLint
npm run lint

# 自动修复
npm run lint:fix

# 格式化代码
npm run format
```

### 3. 数据库迁移

```bash
# 运行迁移（待实现）
npm run db:migrate

# 填充测试数据（待实现）
npm run db:seed
```

## 下一步

1. 阅读 [PROJECT_PLAN.md](./PROJECT_PLAN.md) 了解项目计划
2. 阅读 [ARCHITECTURE.md](./ARCHITECTURE.md) 了解系统架构
3. 阅读 [FEATURES_COMPLETED.md](./FEATURES_COMPLETED.md) 了解已完成功能
4. 阅读 [PM2_GUIDE.md](./PM2_GUIDE.md) 了解 PM2 使用方法

## 获取帮助

- 查看项目文档
- 检查 GitHub Issues
- 联系项目维护者

---

**提示**: 如果遇到问题，请先查看日志文件 `logs/` 目录下的错误日志。
