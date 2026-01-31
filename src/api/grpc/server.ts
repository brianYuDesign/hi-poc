import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import { resolve } from 'path';
import { existsSync } from 'fs';
import { config } from '../../config';
import logger from '../../utils/logger';
import { getOutboxService } from '../../services/outbox';
import { getBalanceService } from '../../services/balance';
// import { verifyHMAC } from '../../utils/hmac'; // 用于 HMAC 验证（可选）
import { BalanceChangeRequest, TransactionType } from '../../types';
import Decimal from 'decimal.js';

// 尝试导入反射支持（可选）
// 注意：@grpc/reflection 包可能不存在，需要手动实现或使用其他包
// 如果使用 grpcurl 等工具，可以指定 proto 文件路径，不需要反射 API
let addReflectionToServer: ((server: grpc.Server, packageDefinition: protoLoader.PackageDefinition) => void) | null = null;
try {
  // 尝试多种可能的包名
  let reflection: any = null;
  try {
    // @ts-ignore - 动态导入
    reflection = require('@grpc/reflection');
  } catch {
    try {
      // @ts-ignore - 尝试其他可能的包名
      reflection = require('grpc-reflection');
    } catch {
      // 如果都不存在，保持为 null
    }
  }
  
  if (reflection && reflection.addReflectionToServer) {
    addReflectionToServer = reflection.addReflectionToServer;
    logger.info('gRPC reflection support loaded');
  }
} catch (error) {
  logger.warn('gRPC reflection package not found. Reflection API will be disabled.');
  logger.warn('To enable reflection, install: npm install @grpc/reflection');
  logger.warn('Alternatively, use grpcurl with proto file: grpcurl -proto balance.proto -plaintext localhost:50051 list');
}

// 获取 proto 文件路径（支持开发和生产环境）
const getProtoPath = (): string => {
  // 可能的路径列表（按优先级）
  const possiblePaths = [
    // 1. 从源码目录（开发环境或编译后）
    resolve(__dirname, '../../src/api/proto/balance.proto'),
    // 2. 从编译后的相对路径（如果 proto 文件被复制）
    resolve(__dirname, '../proto/balance.proto'),
    // 3. 从项目根目录（绝对路径）
    resolve(process.cwd(), 'src/api/proto/balance.proto'),
    // 4. 从当前文件相对路径（开发环境）
    resolve(__dirname, '../../api/proto/balance.proto'),
  ];

  // 查找第一个存在的路径
  for (const path of possiblePaths) {
    if (existsSync(path)) {
      return path;
    }
  }

  // 如果都找不到，返回最可能的路径（用于错误提示）
  return possiblePaths[0];
};

const PROTO_PATH = getProtoPath();

// 加载 Proto 文件
let packageDefinition: protoLoader.PackageDefinition;
let balanceProto: any;

try {
  // 验证文件是否存在
  if (!existsSync(PROTO_PATH)) {
    throw new Error(`Proto file not found at ${PROTO_PATH}. Please ensure the file exists.`);
  }

  packageDefinition = protoLoader.loadSync(PROTO_PATH, {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  balanceProto = grpc.loadPackageDefinition(packageDefinition) as any;
  
  if (!balanceProto || !balanceProto.balance || !balanceProto.balance.BalanceService) {
    throw new Error(`Failed to load proto file from ${PROTO_PATH}. Service definition not found.`);
  }
  
  logger.info('Proto file loaded successfully', { path: PROTO_PATH });
} catch (error: unknown) {
  logger.error('Failed to load proto file', {
    path: PROTO_PATH,
    error: error instanceof Error ? error.message : String(error),
    cwd: process.cwd(),
    __dirname,
  });
  throw error;
}

/**
 * gRPC Server 实现
 */
class GRPCServer {
  private server: grpc.Server;

  constructor() {
    this.server = new grpc.Server();
    this.setupServices();
  }

  /**
   * 设置服务
   */
  private setupServices(): void {
    const balanceService = balanceProto.balance.BalanceService.service;

    // 实现服务方法
    this.server.addService(balanceService, {
      GetBalance: this.getBalance.bind(this),
      ChangeBalance: this.changeBalance.bind(this),
      HealthCheck: this.healthCheck.bind(this),
    });

    // 启用反射 API（如果可用）
    if (addReflectionToServer) {
      try {
        addReflectionToServer(this.server, packageDefinition);
        logger.info('gRPC reflection API enabled');
      } catch (error) {
        logger.warn('Failed to enable gRPC reflection', {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  /**
   * HMAC 验证中间件（可选使用）
   * 如需启用，在方法开头调用: if (!this.verifyAuth(call, callback)) return;
   */
  // private verifyAuth(call: grpc.ServerUnaryCall<any, any>, callback: grpc.sendUnaryData<any>): boolean {
  //   try {
  //     const metadata = call.metadata;
  //     const signature = metadata.get('x-signature')[0] as string;
  //     const timestamp = metadata.get('x-timestamp')[0] as string;
  //
  //     if (!signature || !timestamp) {
  //       callback({
  //         code: grpc.status.UNAUTHENTICATED,
  //         message: 'Missing authentication headers',
  //       });
  //       return false;
  //     }
  //
  //     // 验证 HMAC
  //     const requestBody = JSON.stringify(call.request);
  //     if (!verifyHMAC(requestBody, timestamp, signature)) {
  //       callback({
  //         code: grpc.status.UNAUTHENTICATED,
  //         message: 'Invalid signature',
  //       });
  //       return false;
  //     }
  //
  //     return true;
  //   } catch (error: unknown) {
  //     callback({
  //       code: grpc.status.INTERNAL,
  //       message: error instanceof Error ? error.message : String(error),
  //     });
  //     return false;
  //   }
  // }

  /**
   * 查询余额
   */
  private async getBalance(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): Promise<void> {
    try {
      // HMAC 验证（可选，根据需求决定是否启用）
      // if (!this.verifyAuth(call, callback)) return;

      const { account_id, currency_code } = call.request;

      if (!account_id || !currency_code) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'account_id and currency_code are required',
        });
        return;
      }

      const balanceService = getBalanceService();
      const balance = await balanceService.getBalance(account_id, currency_code);

      if (!balance) {
        callback(null, {
          success: false,
          balance: null,
          error_message: 'Balance not found',
        });
        return;
      }

      callback(null, {
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
        request: call.request,
      });

      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 变更余额
   */
  private async changeBalance(
    call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): Promise<void> {
    try {
      // HMAC 验证
      // if (!this.verifyAuth(call, callback)) return;

      const {
        transaction_id,
        account_id,
        user_id,
        currency_code,
        type,
        amount,
        description,
        metadata,
      } = call.request;

      // 参数验证
      if (!transaction_id || !account_id || !user_id || !currency_code || type === undefined || !amount) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: 'Missing required fields',
        });
        return;
      }

      // 转换类型（支持数字和字符串格式）
      const transactionTypeMap: Record<number | string, TransactionType> = {
        0: TransactionType.DEPOSIT,
        1: TransactionType.WITHDRAW,
        2: TransactionType.FREEZE,
        3: TransactionType.UNFREEZE,
        4: TransactionType.TRANSFER,
        'DEPOSIT': TransactionType.DEPOSIT,
        'WITHDRAW': TransactionType.WITHDRAW,
        'FREEZE': TransactionType.FREEZE,
        'UNFREEZE': TransactionType.UNFREEZE,
        'TRANSFER': TransactionType.TRANSFER,
      };

      const transactionType = transactionTypeMap[type];
      if (!transactionType) {
        callback({
          code: grpc.status.INVALID_ARGUMENT,
          message: `Invalid transaction type: ${type}. Valid types: DEPOSIT(0), WITHDRAW(1), FREEZE(2), UNFREEZE(3), TRANSFER(4)`,
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

      callback(null, {
        success: true,
        transaction_id: transaction_id,
        event_id: eventId,
        error_message: '',
      });
    } catch (error: unknown) {
      logger.error('ChangeBalance error', {
        error: error instanceof Error ? error.message : String(error),
        request: call.request,
      });

      const errorMessage = error instanceof Error ? error.message : String(error);
      
      // 检查是否是重复交易
      if (errorMessage.includes('Duplicate')) {
        callback({
          code: grpc.status.ALREADY_EXISTS,
          message: errorMessage,
        });
        return;
      }

      callback({
        code: grpc.status.INTERNAL,
        message: errorMessage,
      });
    }
  }

  /**
   * 健康检查
   */
  private async healthCheck(
    _call: grpc.ServerUnaryCall<any, any>,
    callback: grpc.sendUnaryData<any>
  ): Promise<void> {
    try {
      callback(null, {
        healthy: true,
        status: 'OK',
        timestamp: Date.now(),
      });
    } catch (error: unknown) {
      callback({
        code: grpc.status.INTERNAL,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * 启动服务器
   */
  start(): void {
    const address = `0.0.0.0:${config.port}`;

    this.server.bindAsync(
      address,
      grpc.ServerCredentials.createInsecure(),
      (error: Error | null, port: number) => {
        if (error) {
          logger.error('Failed to bind gRPC server', {
            error: error.message,
            address,
          });
          return;
        }

        try {
          this.server.start();
          logger.info('gRPC server started successfully', {
            address,
            port,
            protoPath: PROTO_PATH,
          });
        } catch (startError: unknown) {
          logger.error('Failed to start gRPC server', {
            error: startError instanceof Error ? startError.message : String(startError),
            address,
          });
        }
      }
    );
  }

  /**
   * 停止服务器
   */
  async stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.tryShutdown((error) => {
        if (error) {
          logger.error('Error shutting down gRPC server', {
            error: error.message,
          });
          reject(error);
        } else {
          logger.info('gRPC server stopped');
          resolve();
        }
      });
    });
  }
}

// 单例实例
let grpcServerInstance: GRPCServer | null = null;

export function getGRPCServer(): GRPCServer {
  if (!grpcServerInstance) {
    grpcServerInstance = new GRPCServer();
  }
  return grpcServerInstance;
}

export { GRPCServer };
