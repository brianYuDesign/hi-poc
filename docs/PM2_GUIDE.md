# PM2 使用指南

## 📦 安装

PM2 已全局安装。如果未安装，运行：

```bash
npm install -g pm2
```

## 🚀 基本使用

### 启动应用

```bash
# 使用 ecosystem.config.js 配置启动
npm run start:pm2

# 或直接使用 PM2
pm2 start ecosystem.config.js
```

### 查看状态

```bash
# 查看所有进程
pm2 list

# 查看详细信息
pm2 show balance-api
pm2 show balance-consumer

# 查看日志
pm2 logs
pm2 logs balance-api
pm2 logs balance-consumer --lines 100
```

### 管理进程

```bash
# 停止进程
pm2 stop balance-api
pm2 stop all

# 重启进程
pm2 restart balance-api
pm2 restart all

# 删除进程
pm2 delete balance-api
pm2 delete all

# 重载（零停机重启）
pm2 reload balance-api
pm2 reload all
```

### 监控

```bash
# 实时监控
pm2 monit

# 查看进程信息
pm2 info balance-api

# 查看进程树
pm2 list
```

## 📊 配置说明

### ecosystem.config.js

项目已配置 PM2 配置文件，包含以下应用：

1. **balance-api** - gRPC API 服务
   - 实例数: 1（fork 模式）
   - 端口: 50051
   - 自动重启: 是
   - 日志: `logs/api-out.log`, `logs/api-error.log`
   - 内存限制: 1G

2. **balance-consumer** - Kafka Consumer
   - 实例数: 3（cluster 模式，对应 Kafka partitions）
   - 自动重启: 是
   - 日志: `logs/consumer-out.log`, `logs/consumer-error.log`
   - 内存限制: 2G

## 🔧 常用命令

### 启动和停止

```bash
# 启动所有服务
pm2 start ecosystem.config.js

# 启动特定服务
pm2 start ecosystem.config.js --only balance-api

# 停止所有服务
pm2 stop all

# 停止特定服务
pm2 stop balance-api
```

### 日志管理

```bash
# 查看所有日志
pm2 logs

# 查看特定服务日志
pm2 logs balance-api

# 查看最后 100 行
pm2 logs balance-api --lines 100

# 清空日志
pm2 flush

# 实时查看日志
pm2 logs --lines 0
```

### 进程管理

```bash
# 查看进程列表
pm2 list

# 查看详细信息
pm2 describe balance-api

# 重启进程
pm2 restart balance-api

# 重载进程（零停机）
pm2 reload balance-api

# 删除进程
pm2 delete balance-api
```

### 监控和性能

```bash
# 实时监控
pm2 monit

# 查看进程信息
pm2 info balance-api

# 查看性能指标
pm2 show balance-api
```

## 🔄 自动启动

### 保存当前进程列表

```bash
# 保存当前 PM2 进程列表
pm2 save

# 设置开机自启
pm2 startup

# 取消开机自启
pm2 unstartup
```

### 系统服务（推荐）

```bash
# 生成启动脚本
pm2 startup

# 按照提示执行命令（通常是 sudo 命令）

# 保存当前进程列表
pm2 save
```

## 📈 集群模式

如果需要更多实例，修改 `ecosystem.config.js`:

```javascript
{
  name: 'balance-api',
  script: 'dist/index.js',
  instances: 4,  // 改为 4 个实例
  exec_mode: 'cluster',
  // ...
}
```

然后重启：

```bash
pm2 restart ecosystem.config.js
```

## 🛠️ 故障排查

### 查看错误日志

```bash
# 查看错误日志
pm2 logs balance-api --err

# 查看所有错误
pm2 logs --err
```

### 重启失败的服务

```bash
# 查看失败的服务
pm2 list

# 重启失败的服务
pm2 restart balance-api
```

### 查看进程详情

```bash
# 查看详细信息
pm2 describe balance-api

# 查看环境变量
pm2 env balance-api
```

## 📝 最佳实践

1. **使用配置文件**: 始终使用 `ecosystem.config.js` 而不是命令行参数
2. **保存进程列表**: 修改后运行 `pm2 save`
3. **监控日志**: 定期检查 `pm2 logs`
4. **设置日志轮转**: 配置 `pm2-logrotate` 避免日志文件过大
5. **使用集群模式**: 对于 API 服务，使用集群模式提高性能

## 🔐 安全建议

1. **不要在生产环境使用 root 用户运行 PM2**
2. **设置适当的文件权限**
3. **定期更新 PM2**: `npm update -g pm2`
4. **监控资源使用**: 使用 `pm2 monit` 监控 CPU 和内存

## 📊 PM2 Plus 监控

PM2 Plus 提供云端监控仪表板，可以远程监控应用状态。

### 启用 PM2 Plus

```bash
# 登录 PM2 Plus
pm2 monitor

# 按照提示完成 OAuth 认证
# 成功后会显示：
# [PM2 I/O] Successfully connected to bucket PM2 Plus Monitoring
# [PM2 I/O] You can use the web interface over there: https://app.pm2.io/#/bucket/xxx
```

### 访问监控仪表板

认证成功后，可以通过以下方式访问：

1. **Web 界面**: https://app.pm2.io
2. **命令行打开**: `pm2 open`

### PM2 Plus 功能

- **实时监控**: CPU、内存使用率
- **日志聚合**: 集中查看所有实例日志
- **异常追踪**: 自动捕获错误和异常
- **性能分析**: 事务追踪和性能指标
- **告警通知**: 邮件、Slack 等通知渠道

### 断开连接

```bash
# 断开 PM2 Plus 连接
pm2 logout
```

## 📚 更多资源

- [PM2 官方文档](https://pm2.keymetrics.io/docs/usage/quick-start/)
- [PM2 生态系统文件](https://pm2.keymetrics.io/docs/usage/application-declaration/)
- [PM2 Plus 文档](https://pm2.io/docs/plus/overview/)

---

**提示**: 使用 `pm2 --help` 查看所有可用命令。
