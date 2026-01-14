import { Request, Response, NextFunction } from 'express';
import { config } from '../config/env.js';

class Logger {
  private shouldLog: boolean;

  constructor() {
    this.shouldLog = config.shouldLog;
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog) {
      console.log(`[DEBUG] ${message}`, meta ? JSON.stringify(meta) : '');
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    if (this.shouldLog) {
      console.log(`[INFO] ${message}`, meta ? JSON.stringify(meta) : '');
    }
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    console.warn(`[WARN] ${message}`, meta ? JSON.stringify(meta) : '');
  }

  error(message: string, meta?: Record<string, unknown>): void {
    // Always log errors, but sanitize in production
    const safeMeta = config.isProduction ? undefined : meta;
    console.error(`[ERROR] ${message}`, safeMeta ? JSON.stringify(safeMeta) : '');
  }
}

export const logger = new Logger();

// Simple request logging - only in debug mode
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  if (config.shouldLog) {
    const start = Date.now();
    res.on('finish', () => {
      logger.debug(`${req.method} ${req.path} ${res.statusCode} (${Date.now() - start}ms)`);
    });
  }
  next();
}

// Error logging
export function errorLogger(
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
): void {
  logger.error(err.message, config.shouldLog ? { stack: err.stack, path: req.path } : undefined);
  next(err);
}
