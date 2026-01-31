#!/bin/bash
# 初始化数据库脚本（避免 TTY 错误）

set -e

echo "初始化数据库..."

# 使用 -T 标志避免 TTY 错误
docker-compose exec -T mysql mysql -u root -prootpassword balance_system < scripts/init-mysql.sql

echo "数据库初始化完成！"
