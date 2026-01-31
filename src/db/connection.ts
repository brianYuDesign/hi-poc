import mysql from 'mysql2/promise';
import { config } from '../config';
import logger from '../utils/logger';

let pool: mysql.Pool | null = null;

export function getDBPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: config.mysql.host,
      port: config.mysql.port,
      user: config.mysql.user,
      password: config.mysql.password,
      database: config.mysql.database,
      connectionLimit: config.mysql.connectionLimit,
      queueLimit: config.mysql.queueLimit,
      waitForConnections: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 0,
      connectTimeout: config.mysql.connectTimeout,
      // 启用 local_infile 以支持 LOAD DATA INFILE
      ...(config.mysql.enableLocalInfile && {
        flags: ['+LOCAL_INFILE'],
      }),
    });

    // 连接池事件监听
    pool.on('connection', (connection: mysql.PoolConnection) => {
      logger.debug('New database connection established', {
        threadId: connection.threadId,
      });
    });

    // 注意：mysql2 的 Pool 类型可能不支持 'error' 事件
    // 如果需要错误处理，可以在连接级别处理
  }

  return pool;
}

export async function closeDBPool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database connection pool closed');
  }
}

// 执行事务的辅助函数
export async function withTransaction<T>(
  callback: (connection: mysql.PoolConnection) => Promise<T>
): Promise<T> {
  const pool = getDBPool();
  const connection = await pool.getConnection();

  try {
    await connection.beginTransaction();
    const result = await callback(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
