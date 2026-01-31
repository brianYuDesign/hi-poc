import express, { Express, Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import logger from '../../utils/logger';
import { getOutboxService } from '../../services/outbox';
import { getBalanceService } from '../../services/balance';
import { BalanceChangeRequest, TransactionType } from '../../types';
import Decimal from 'decimal.js';

/**
 * REST API Server 实现
 */
class RESTServer {
  private app: Express;
  private server: any;

  constructor() {
    this.app = express();
    this.setupMiddleware();
    this.setupRoutes();
  }

  /**
   * 设置中间件
   */
  private setupMiddleware(): void {
    // JSON 解析
    this.app.use(express.json({ limit: '10mb' }));
    
    // 请求日志
    this.app.use((req: Request, _res: Response, next: NextFunction) => {
      logger.info('HTTP Request', {
        method: req.method,
        path: req.path,
        ip: req.ip,
      });
      next();
    });

    // 错误处理中间件
    this.app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
      logger.error('HTTP Error', {
        error: err.message,
        path: req.path,
        stack: err.stack,
      });
      res.status(500).json({
        success: false,
        error: 'Internal server error',
        message: err.message,
      });
    });
  }

  /**
   * 设置路由
   */
  private setupRoutes(): void {
    // 健康检查
    this.app.get('/health', this.healthCheck.bind(this));
    
    // 查询余额
    this.app.get('/api/v1/balance/:accountId/:currencyCode', this.getBalance.bind(this));
    
    // 变更余额
    this.app.post('/api/v1/balance/change', this.changeBalance.bind(this));
  }

  /**
   * 健康检查
   */
  private async healthCheck(_req: Request, res: Response): Promise<void> {
    try {
      res.json({
        healthy: true,
        status: 'OK',
        timestamp: Date.now(),
      });
    } catch (error: unknown) {
      logger.error('HealthCheck error', {
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({
        healthy: false,
        status: 'ERROR',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 查询余额
   */
  private async getBalance(req: Request, res: Response): Promise<void> {
    try {
      const accountId = parseInt(req.params.accountId, 10);
      const currencyCode = req.params.currencyCode;

      if (!accountId || !currencyCode) {
        res.status(400).json({
          success: false,
          error: 'account_id and currency_code are required',
        });
        return;
      }

      const balanceService = getBalanceService();
      const balance = await balanceService.getBalance(accountId, currencyCode);

      if (!balance) {
        res.status(404).json({
          success: false,
          balance: null,
          error_message: 'Balance not found',
        });
        return;
      }

      res.json({
        success: true,
        balance: {
          account_id: balance.accountId,
          currency_code: balance.currencyCode,
          available: balance.available.toString(),
          frozen: balance.frozen.toString(),
          version: balance.version,
          updated_at: balance.updatedAt,
        },
        error_message: '',
      });
    } catch (error: unknown) {
      logger.error('GetBalance error', {
        error: error instanceof Error ? error.message : String(error),
        params: req.params,
      });

      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 变更余额
   */
  private async changeBalance(req: Request, res: Response): Promise<void> {
    try {
      const {
        transaction_id,
        account_id,
        user_id,
        currency_code,
        type,
        amount,
        description,
        metadata,
      } = req.body;

      // 参数验证
      if (!transaction_id || !account_id || !user_id || !currency_code || type === undefined || !amount) {
        res.status(400).json({
          success: false,
          error: 'Missing required fields',
        });
        return;
      }

      // 转换类型
      const transactionTypeMap: Record<number, TransactionType> = {
        0: TransactionType.DEPOSIT,
        1: TransactionType.WITHDRAW,
        2: TransactionType.FREEZE,
        3: TransactionType.UNFREEZE,
        4: TransactionType.TRANSFER,
      };

      const transactionType = transactionTypeMap[type];
      if (!transactionType) {
        res.status(400).json({
          success: false,
          error: `Invalid transaction type: ${type}`,
        });
        return;
      }

      // 构建请求
      const request: BalanceChangeRequest = {
        transactionId: transaction_id,
        accountId: account_id,
        userId: user_id,
        currencyCode: currency_code,
        type: transactionType,
        amount: new Decimal(amount),
        description: description || undefined,
        metadata: metadata || undefined,
      };

      // 通过 Outbox Pattern 创建余额变更
      const outboxService = getOutboxService();
      const eventId = await outboxService.createBalanceChange(request);

      res.json({
        success: true,
        transaction_id: transaction_id,
        event_id: eventId,
        error_message: '',
      });
    } catch (error: unknown) {
      logger.error('ChangeBalance error', {
        error: error instanceof Error ? error.message : String(error),
        body: req.body,
      });

      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 检查是否是重复交易
      if (errorMessage.includes('Duplicate')) {
        res.status(409).json({
          success: false,
          error: errorMessage,
        });
        return;
      }

      res.status(500).json({
        success: false,
        error: errorMessage,
      });
    }
  }

  /**
   * 启动服务器
   */
  start(): void {
    const port = config.port;

    this.server = this.app.listen(port, () => {
      logger.info('REST API server started successfully', {
        port,
        environment: config.nodeEnv,
      });
    });

    this.server.on('error', (error: Error) => {
      logger.error('REST API server error', {
        error: error.message,
        port,
      });
    });
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error: Error | undefined) => {
        if (error) {
          logger.error('Error shutting down REST API server', {
            error: error.message,
          });
          reject(error);
        } else {
          logger.info('REST API server stopped');
          resolve();
        }
      });
    });
  }
}

// 单例实例
let restServerInstance: RESTServer | null = null;

export function getRESTServer(): RESTServer {
  if (!restServerInstance) {
    restServerInstance = new RESTServer();
  }
  return restServerInstance;
}

export { RESTServer };
