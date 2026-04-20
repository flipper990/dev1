// ─────────────────────────────────────────────────────────────
// Agent Middleware — Composable cross-cutting concerns
// Built-in: logging, metrics, timeout, validation, rate limit
// ─────────────────────────────────────────────────────────────

import type {
  AgentMiddleware,
  AgentMiddlewareFn,
  ExecutionContext,
  Task,
} from './types';
import type { Logger } from './base-agent';

// ── Middleware Factory ───────────────────────────────────────

export function createMiddleware(
  name: string,
  order: number,
  fn: AgentMiddlewareFn,
): AgentMiddleware {
  return { name, order, fn };
}

// ── Built-in: Logging Middleware ─────────────────────────────

export function loggingMiddleware(logger: Logger): AgentMiddleware {
  return createMiddleware('logging', 10, async (ctx, task, next) => {
    const start = Date.now();
    logger.info(`[MW:logging] Agent ${ctx.agentRole} starting`, {
      traceId: ctx.traceId,
      spanId: ctx.spanId,
      taskId: task.id,
      attempt: ctx.attempt,
    });

    try {
      const result = await next();
      const duration = Date.now() - start;

      logger.info(`[MW:logging] Agent ${ctx.agentRole} finished`, {
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        taskId: task.id,
        status: result.status,
        durationMs: duration,
        tokensIn: result.metadata?.tokensIn,
        tokensOut: result.metadata?.tokensOut,
      });

      return result;
    } catch (err) {
      const duration = Date.now() - start;
      logger.error(`[MW:logging] Agent ${ctx.agentRole} threw`, {
        traceId: ctx.traceId,
        taskId: task.id,
        durationMs: duration,
        error: (err as Error).message,
      });
      throw err;
    }
  });
}

// ── Built-in: Timeout Middleware ─────────────────────────────

export function timeoutMiddleware(timeoutMs: number): AgentMiddleware {
  return createMiddleware('timeout', 20, async (ctx, task, next) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const result = await Promise.race([
        next(),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener('abort', () => {
            reject(new Error(`Agent ${ctx.agentRole} timed out after ${timeoutMs}ms`));
          });
        }),
      ]);
      return result;
    } finally {
      clearTimeout(timer);
    }
  });
}

// ── Built-in: Validation Middleware ──────────────────────────

export interface ValidationRule {
  field: string;
  validate: (value: unknown) => boolean;
  message: string;
}

export function inputValidationMiddleware(rules: ValidationRule[]): AgentMiddleware {
  return createMiddleware('input-validation', 30, async (ctx, task, next) => {
    for (const rule of rules) {
      const value = task.input[rule.field];
      if (!rule.validate(value)) {
        task.status = 'failed';
        task.error = {
          code: 'VALIDATION_ERROR',
          message: `Input validation failed: ${rule.message} (field: ${rule.field})`,
          retryable: false,
        };
        return task;
      }
    }
    return next();
  });
}

// ── Built-in: Rate Limit Middleware ──────────────────────────

export function rateLimitMiddleware(
  maxPerMinute: number,
  logger: Logger,
): AgentMiddleware {
  const windows: Map<string, number[]> = new Map();

  return createMiddleware('rate-limit', 15, async (ctx, _task, next) => {
    const key = ctx.agentRole;
    const now = Date.now();
    const windowMs = 60_000;

    let timestamps = windows.get(key) ?? [];
    timestamps = timestamps.filter(t => now - t < windowMs);

    if (timestamps.length >= maxPerMinute) {
      const waitMs = timestamps[0] + windowMs - now;
      logger.warn(`[MW:rate-limit] Agent ${key} rate limited, waiting ${waitMs}ms`, {
        traceId: ctx.traceId,
        currentRate: timestamps.length,
        maxRate: maxPerMinute,
      });
      await new Promise(resolve => setTimeout(resolve, waitMs));
      // Recalculate after wait
      timestamps = timestamps.filter(t => Date.now() - t < windowMs);
    }

    timestamps.push(now);
    windows.set(key, timestamps);

    return next();
  });
}

// ── Built-in: Retry Middleware ───────────────────────────────

export interface RetryOptions {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableCodes: string[];
}

export function retryMiddleware(options: RetryOptions, logger: Logger): AgentMiddleware {
  return createMiddleware('retry', 5, async (ctx, task, next) => {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
      ctx.attempt = attempt;

      if (attempt > 1) {
        const delay = Math.min(
          options.baseDelayMs * Math.pow(options.backoffMultiplier, attempt - 1),
          options.maxDelayMs,
        );
        const jitter = delay * 0.25 * (Math.random() * 2 - 1);
        const actualDelay = Math.max(0, Math.round(delay + jitter));

        logger.info(`[MW:retry] Agent ${ctx.agentRole} retry ${attempt}/${options.maxAttempts} in ${actualDelay}ms`, {
          traceId: ctx.traceId,
        });

        await new Promise(resolve => setTimeout(resolve, actualDelay));
      }

      const result = await next();

      if (result.status === 'completed') {
        return result;
      }

      // Check if error is retryable
      if (result.error) {
        if (!result.error.retryable || !options.retryableCodes.includes(result.error.code)) {
          logger.warn(`[MW:retry] Non-retryable error ${result.error.code}, aborting`, {
            traceId: ctx.traceId,
          });
          return result;
        }
        lastError = new Error(result.error.message);
      }

      if (attempt === options.maxAttempts) {
        logger.error(`[MW:retry] All ${options.maxAttempts} attempts exhausted for ${ctx.agentRole}`, {
          traceId: ctx.traceId,
        });
        return result;
      }
    }

    // Should not reach here, but safety net
    task.status = 'failed';
    task.error = {
      code: 'RETRY_EXHAUSTED',
      message: lastError?.message ?? 'All retry attempts failed',
      retryable: false,
    };
    return task;
  });
}

// ── Built-in: Metrics Collection Middleware ──────────────────

export interface MetricsCollector {
  recordExecution(role: string, durationMs: number, success: boolean, tokensIn: number, tokensOut: number): void;
}

export function metricsMiddleware(collector: MetricsCollector): AgentMiddleware {
  return createMiddleware('metrics', 8, async (ctx, _task, next) => {
    const start = Date.now();
    const result = await next();
    const duration = Date.now() - start;

    collector.recordExecution(
      ctx.agentRole,
      duration,
      result.status === 'completed',
      result.metadata?.tokensIn ?? 0,
      result.metadata?.tokensOut ?? 0,
    );

    return result;
  });
}

// ── Middleware Composition Helper ────────────────────────────

/** Compose multiple middleware into a sorted stack */
export function composeMiddleware(...middlewares: AgentMiddleware[]): AgentMiddleware[] {
  return [...middlewares].sort((a, b) => a.order - b.order);
}

/** Create a production-ready middleware stack with sensible defaults */
export function createProductionMiddleware(
  logger: Logger,
  options?: {
    timeoutMs?: number;
    maxPerMinute?: number;
    retryOptions?: RetryOptions;
    metricsCollector?: MetricsCollector;
  },
): AgentMiddleware[] {
  const stack: AgentMiddleware[] = [
    loggingMiddleware(logger),
  ];

  if (options?.retryOptions) {
    stack.push(retryMiddleware(options.retryOptions, logger));
  }

  if (options?.metricsCollector) {
    stack.push(metricsMiddleware(options.metricsCollector));
  }

  if (options?.maxPerMinute) {
    stack.push(rateLimitMiddleware(options.maxPerMinute, logger));
  }

  if (options?.timeoutMs) {
    stack.push(timeoutMiddleware(options.timeoutMs));
  }

  return composeMiddleware(...stack);
}
