// ─────────────────────────────────────────────────────────────
// Structured logger (pino)
// ─────────────────────────────────────────────────────────────

import pino from 'pino';
import { config } from './config.js';
import type { Logger } from '@agent-core/agent-contracts.js';

const pinoLogger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  transport: config.isDev
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined,
});

export function createLogger(context: string): Logger {
  const child = pinoLogger.child({ context });
  return {
    info: (msg: string, meta?: Record<string, unknown>) => child.info(meta ?? {}, msg),
    warn: (msg: string, meta?: Record<string, unknown>) => child.warn(meta ?? {}, msg),
    error: (msg: string, meta?: Record<string, unknown>) => child.error(meta ?? {}, msg),
    debug: (msg: string, meta?: Record<string, unknown>) => child.debug(meta ?? {}, msg),
  };
}

export { pinoLogger };
