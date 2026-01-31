import { createServer, Server } from 'http';
import { config } from '../config';
import logger from './logger';

/**
 * Prometheus 指标收集
 */
class Metrics {
  private server: Server | null = null;
  private metrics: Map<string, number> = new Map();
  private counters: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();

  /**
   * 增加计数器
   */
  incrementCounter(name: string, labels?: Record<string, string>, value: number = 1): void {
    const key = this.getKey(name, labels);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  /**
   * 设置指标值
   */
  setGauge(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    this.metrics.set(key, value);
  }

  /**
   * 记录直方图值
   */
  observeHistogram(name: string, value: number, labels?: Record<string, string>): void {
    const key = this.getKey(name, labels);
    const values = this.histograms.get(key) || [];
    values.push(value);
    // 只保留最近 1000 个值
    if (values.length > 1000) {
      values.shift();
    }
    this.histograms.set(key, values);
  }

  /**
   * 生成指标键
   */
  private getKey(name: string, labels?: Record<string, string>): string {
    if (!labels || Object.keys(labels).length === 0) {
      return name;
    }
    const labelStr = Object.entries(labels)
      .map(([k, v]) => `${k}="${v}"`)
      .join(',');
    return `${name}{${labelStr}}`;
  }

  /**
   * 生成 Prometheus 格式的指标
   */
  private generateMetrics(): string {
    const lines: string[] = [];

    // Counters
    for (const [key, value] of this.counters.entries()) {
      lines.push(`# TYPE ${key.split('{')[0]} counter`);
      lines.push(`${key} ${value}`);
    }

    // Gauges
    for (const [key, value] of this.metrics.entries()) {
      lines.push(`# TYPE ${key.split('{')[0]} gauge`);
      lines.push(`${key} ${value}`);
    }

    // Histograms
    for (const [key, values] of this.histograms.entries()) {
      if (values.length === 0) continue;

      const sorted = [...values].sort((a, b) => a - b);
      const sum = values.reduce((a, b) => a + b, 0);
      const count = values.length;
      // 计算分位数（用于未来扩展）
      // const p50 = sorted[Math.floor(count * 0.5)] || 0;
      // const p95 = sorted[Math.floor(count * 0.95)] || 0;
      // const p99 = sorted[Math.floor(count * 0.99)] || 0;

      const baseName = key.split('{')[0];
      lines.push(`# TYPE ${baseName} histogram`);
      lines.push(`${baseName}_sum{${key.includes('{') ? key.split('{')[1] : ''}} ${sum}`);
      lines.push(`${baseName}_count{${key.includes('{') ? key.split('{')[1] : ''}} ${count}`);
      lines.push(`${baseName}_bucket{le="0.05",${key.includes('{') ? key.split('{')[1] : ''}} ${sorted.filter(v => v <= 0.05).length}`);
      lines.push(`${baseName}_bucket{le="0.5",${key.includes('{') ? key.split('{')[1] : ''}} ${sorted.filter(v => v <= 0.5).length}`);
      lines.push(`${baseName}_bucket{le="0.95",${key.includes('{') ? key.split('{')[1] : ''}} ${sorted.filter(v => v <= 0.95).length}`);
      lines.push(`${baseName}_bucket{le="0.99",${key.includes('{') ? key.split('{')[1] : ''}} ${sorted.filter(v => v <= 0.99).length}`);
      lines.push(`${baseName}_bucket{le="+Inf",${key.includes('{') ? key.split('{')[1] : ''}} ${count}`);
    }

    return lines.join('\n') + '\n';
  }

  /**
   * 启动指标服务器
   */
  start(): void {
    if (!config.monitoring.enableMetrics) {
      logger.info('Metrics disabled');
      return;
    }

    this.server = createServer((req, res) => {
      if (req.url === '/metrics') {
        res.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
        res.end(this.generateMetrics());
      } else {
        res.writeHead(404);
        res.end('Not Found');
      }
    });

    this.server.listen(config.monitoring.prometheusPort, () => {
      logger.info('Metrics server started', {
        port: config.monitoring.prometheusPort,
        endpoint: '/metrics',
      });
    });
  }

  /**
   * 停止指标服务器
   */
  stop(): void {
    if (this.server) {
      this.server.close();
      this.server = null;
      logger.info('Metrics server stopped');
    }
  }
}

// 单例实例
let metricsInstance: Metrics | null = null;

export function getMetrics(): Metrics {
  if (!metricsInstance) {
    metricsInstance = new Metrics();
  }
  return metricsInstance;
}

// 便捷函数
export const metrics = {
  incrementCounter: (name: string, labels?: Record<string, string>, value?: number) => {
    getMetrics().incrementCounter(name, labels, value);
  },
  setGauge: (name: string, value: number, labels?: Record<string, string>) => {
    getMetrics().setGauge(name, value, labels);
  },
  observeHistogram: (name: string, value: number, labels?: Record<string, string>) => {
    getMetrics().observeHistogram(name, value, labels);
  },
};
