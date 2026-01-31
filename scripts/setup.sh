#!/bin/bash
set -e

echo "🚀 设置高吞吐量余额系统..."

# 颜色输出
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查 Docker 是否运行
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker 未运行，请先启动 Docker"
    exit 1
fi

# 启动 Docker 服务
echo -e "${YELLOW}📦 启动 Docker 服务...${NC}"
docker-compose up -d

# 等待服务就绪
echo -e "${YELLOW}⏳ 等待服务启动...${NC}"
sleep 10

# 检查 MySQL
echo -e "${YELLOW}🔍 检查 MySQL...${NC}"
until docker-compose exec -T mysql mysqladmin ping -h localhost -u root -prootpassword > /dev/null 2>&1; do
    echo "等待 MySQL 启动..."
    sleep 2
done
echo -e "${GREEN}✅ MySQL 已就绪${NC}"

# 初始化数据库
echo -e "${YELLOW}📊 初始化数据库...${NC}"
docker-compose exec -T mysql mysql -u root -prootpassword balance_system < scripts/init-mysql.sql
echo -e "${GREEN}✅ 数据库初始化完成${NC}"

# 检查 Redis
echo -e "${YELLOW}🔍 检查 Redis...${NC}"
until docker-compose exec -T redis redis-cli ping > /dev/null 2>&1; do
    echo "等待 Redis 启动..."
    sleep 2
done
echo -e "${GREEN}✅ Redis 已就绪${NC}"

# 检查 Kafka
echo -e "${YELLOW}🔍 检查 Kafka...${NC}"
until docker-compose exec -T kafka kafka-broker-api-versions --bootstrap-server localhost:9092 > /dev/null 2>&1; do
    echo "等待 Kafka 启动..."
    sleep 2
done
echo -e "${GREEN}✅ Kafka 已就绪${NC}"

# 创建 Kafka Topics（如果需要）
echo -e "${YELLOW}📝 创建 Kafka Topics...${NC}"
docker-compose exec -T kafka kafka-topics --create --if-not-exists \
    --topic balance-changes \
    --bootstrap-server localhost:9092 \
    --partitions 3 \
    --replication-factor 1 \
    > /dev/null 2>&1 || true

docker-compose exec -T kafka kafka-topics --create --if-not-exists \
    --topic balance-changes-dlq \
    --bootstrap-server localhost:9092 \
    --partitions 1 \
    --replication-factor 1 \
    > /dev/null 2>&1 || true

docker-compose exec -T kafka kafka-topics --create --if-not-exists \
    --topic balance-results \
    --bootstrap-server localhost:9092 \
    --partitions 3 \
    --replication-factor 1 \
    > /dev/null 2>&1 || true

echo -e "${GREEN}✅ Kafka Topics 已创建${NC}"

echo ""
echo -e "${GREEN}🎉 设置完成！${NC}"
echo ""
echo "服务状态："
docker-compose ps
echo ""
echo "访问地址："
echo "  - Prometheus: http://localhost:9090"
echo "  - Grafana: http://localhost:3000 (admin/admin)"
echo "  - Metrics: http://localhost:9091/metrics"
echo ""
echo "下一步："
echo "  1. npm install"
echo "  2. npm run dev"
