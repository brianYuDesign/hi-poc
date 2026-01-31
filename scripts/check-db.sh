#!/bin/bash
# 检查数据库状态的脚本

echo "🔍 检查数据库状态..."
echo ""

# 检查容器
echo "1. 检查 MySQL 容器状态:"
docker-compose ps mysql
echo ""

# 检查数据库
echo "2. 列出所有数据库:"
docker-compose exec -T mysql mysql -u root -prootpassword -e "SHOW DATABASES;" 2>&1
echo ""

# 检查 balance_system 数据库
echo "3. 检查 balance_system 数据库:"
docker-compose exec -T mysql mysql -u root -prootpassword -e "USE balance_system; SHOW TABLES;" 2>&1
echo ""

# 检查表数量
echo "4. 表数量统计:"
docker-compose exec -T mysql mysql -u root -prootpassword balance_system -e "SELECT COUNT(*) as table_count FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'balance_system';" 2>&1
echo ""

# 列出所有表
echo "5. 所有表列表:"
docker-compose exec -T mysql mysql -u root -prootpassword balance_system -e "SELECT TABLE_NAME, TABLE_ROWS, CREATE_TIME FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'balance_system' ORDER BY TABLE_NAME;" 2>&1
echo ""

echo "✅ 检查完成！"
echo ""
echo "如果看不到 balance_system 数据库或表，运行:"
echo "  npm run db:init"
