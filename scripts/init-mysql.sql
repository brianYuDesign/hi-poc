-- 初始化数据库脚本
CREATE DATABASE IF NOT EXISTS balance_system CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE balance_system;

-- 账户表
CREATE TABLE IF NOT EXISTS accounts (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    user_id VARCHAR(64) UNIQUE NOT NULL COMMENT '用户ID',
    shard_id INT NOT NULL DEFAULT 1 COMMENT '分片ID',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_shard_id (shard_id),
    INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账户表';

-- 余额表
CREATE TABLE IF NOT EXISTS account_balances (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    account_id BIGINT NOT NULL COMMENT '账户ID',
    currency_code VARCHAR(10) NOT NULL COMMENT '币种代码',
    available DECIMAL(36, 18) NOT NULL DEFAULT 0 COMMENT '可用余额',
    frozen DECIMAL(36, 18) NOT NULL DEFAULT 0 COMMENT '冻结余额',
    version INT NOT NULL DEFAULT 0 COMMENT '版本号（乐观锁）',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_account_currency (account_id, currency_code),
    INDEX idx_account_id (account_id),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='账户余额表';

-- 余额流水表
CREATE TABLE IF NOT EXISTS balance_transactions (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    account_id BIGINT NOT NULL COMMENT '账户ID',
    currency_code VARCHAR(10) NOT NULL COMMENT '币种代码',
    transaction_id VARCHAR(64) UNIQUE NOT NULL COMMENT '交易ID（幂等性保证）',
    type ENUM('DEPOSIT', 'WITHDRAW', 'FREEZE', 'UNFREEZE', 'TRANSFER') NOT NULL COMMENT '交易类型',
    amount DECIMAL(36, 18) NOT NULL COMMENT '交易金额',
    available_before DECIMAL(36, 18) NOT NULL COMMENT '交易前可用余额',
    available_after DECIMAL(36, 18) NOT NULL COMMENT '交易后可用余额',
    frozen_before DECIMAL(36, 18) NOT NULL COMMENT '交易前冻结余额',
    frozen_after DECIMAL(36, 18) NOT NULL COMMENT '交易后冻结余额',
    status ENUM('INIT', 'PROCESSING', 'SUCCESS', 'FAILED') NOT NULL DEFAULT 'INIT' COMMENT '状态',
    error_message TEXT COMMENT '错误信息',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_account_created (account_id, created_at),
    INDEX idx_transaction_id (transaction_id),
    INDEX idx_status (status),
    INDEX idx_account_currency_created (account_id, currency_code, created_at),
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='余额流水表';

-- Outbox 事件表（Outbox Pattern）
CREATE TABLE IF NOT EXISTS outbox_events (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    event_id VARCHAR(64) UNIQUE NOT NULL COMMENT '事件ID',
    topic VARCHAR(255) NOT NULL COMMENT 'Kafka Topic',
    partition_key VARCHAR(255) NOT NULL COMMENT '分区键（user_id）',
    payload JSON NOT NULL COMMENT '事件负载',
    status ENUM('PENDING', 'SENT', 'FAILED') NOT NULL DEFAULT 'PENDING' COMMENT '状态',
    retry_count INT NOT NULL DEFAULT 0 COMMENT '重试次数',
    error_message TEXT COMMENT '错误信息',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at TIMESTAMP NULL COMMENT '发送时间',
    INDEX idx_status (status),
    INDEX idx_created (created_at),
    INDEX idx_status_created (status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Outbox 事件表';

-- Leader Lock 表（Leader Election）
CREATE TABLE IF NOT EXISTS leader_locks (
    id INT PRIMARY KEY DEFAULT 1,
    consumer_id VARCHAR(255) NOT NULL COMMENT 'Consumer ID',
    acquired_at TIMESTAMP NOT NULL COMMENT '获取锁的时间',
    expires_at TIMESTAMP NOT NULL COMMENT '锁过期时间',
    INDEX idx_expires (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Leader Lock 表';

-- Consumer Offset 表（手动管理 offset）
CREATE TABLE IF NOT EXISTS consumer_offsets (
    id BIGINT PRIMARY KEY AUTO_INCREMENT,
    consumer_group VARCHAR(255) NOT NULL COMMENT 'Consumer Group',
    topic VARCHAR(255) NOT NULL COMMENT 'Topic',
    `partition` INT NOT NULL COMMENT 'Partition',
    `offset` BIGINT NOT NULL COMMENT 'Offset',
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_group_topic_partition (consumer_group, topic, `partition`),
    INDEX idx_group_topic (consumer_group, topic)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='Consumer Offset 表';

-- 初始化数据（可选）
-- INSERT INTO accounts (user_id, shard_id) VALUES ('test_user_1', 1);
-- INSERT INTO accounts (user_id, shard_id) VALUES ('test_user_2', 1);
