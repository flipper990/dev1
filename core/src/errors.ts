export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(message, 'VALIDATION_ERROR', 400, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, 'NOT_FOUND', 404);
    this.name = 'NotFoundError';
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Unauthorized') {
    super(message, 'UNAUTHORIZED', 401);
    this.name = 'UnauthorizedError';
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Rate limit exceeded') {
    super(message, 'RATE_LIMIT', 429);
    this.name = 'RateLimitError';
  }
}

export class LLMError extends AppError {
  constructor(
    message: string,
    public readonly provider: string,
    public readonly model: string,
    public readonly retryable: boolean = false,
  ) {
    super(message, 'LLM_ERROR', 502);
    this.name = 'LLMError';
  }
}

export class BudgetExceededError extends AppError {
  constructor(message: string) {
    super(message, 'BUDGET_EXCEEDED', 402);
    this.name = 'BudgetExceededError';
  }
}

export class CostLimitError extends AppError {
  constructor(
    message: string,
    public readonly kind: 'generation_count' | 'cost_usd',
    public readonly currentValue: number,
    public readonly limit: number,
  ) {
    super(message, 'COST_LIMIT_EXCEEDED', 402, { kind, currentValue, limit });
    this.name = 'CostLimitError';
  }
}

export class ConcurrencyLimitError extends AppError {
  constructor() {
    super('Maximum concurrent sessions reached', 'CONCURRENCY_LIMIT', 503);
    this.name = 'ConcurrencyLimitError';
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}
