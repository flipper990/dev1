// ─────────────────────────────────────────────────────────────
// Circuit Breaker + Retry Engine — LLM provider fault tolerance
// ─────────────────────────────────────────────────────────────

import type { CircuitBreakerState, LLMProvider, ModelConfig, RetryPolicy } from './types';
import type { Logger } from './base-agent';

// ── Circuit Breaker ─────────────────────────────────────────

export interface CircuitBreakerConfig {
  failureThreshold: number;     // failures before opening
  recoveryTimeMs: number;       // how long to stay open
  halfOpenMaxAttempts: number;  // attempts in half-open before closing
}

const DEFAULT_CB_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  recoveryTimeMs: 60_000,
  halfOpenMaxAttempts: 2,
};

export class CircuitBreaker {
  private states: Map<LLMProvider, CircuitBreakerState> = new Map();
  private config: CircuitBreakerConfig;
  private logger: Logger;

  constructor(logger: Logger, config?: Partial<CircuitBreakerConfig>) {
    this.logger = logger;
    this.config = { ...DEFAULT_CB_CONFIG, ...config };
  }

  /** Check if a provider is available */
  canUse(provider: LLMProvider): boolean {
    const state = this.getState(provider);

    switch (state.state) {
      case 'closed':
        return true;

      case 'open':
        // Check if recovery time has elapsed
        if (state.openUntil && new Date() >= state.openUntil) {
          this.transition(provider, 'half-open');
          return true;
        }
        return false;

      case 'half-open':
        return true;
    }
  }

  /** Record a successful call */
  recordSuccess(provider: LLMProvider): void {
    const state = this.getState(provider);

    if (state.state === 'half-open') {
      state.successCount++;
      if (state.successCount >= this.config.halfOpenMaxAttempts) {
        this.transition(provider, 'closed');
        this.logger.info(`Circuit breaker CLOSED for ${provider}`);
      }
    } else if (state.state === 'closed') {
      // Reset failure count on success
      state.failureCount = 0;
    }
  }

  /** Record a failed call */
  recordFailure(provider: LLMProvider): void {
    const state = this.getState(provider);

    state.failureCount++;
    state.lastFailure = new Date();

    if (state.state === 'half-open') {
      // Any failure in half-open reopens the circuit
      this.transition(provider, 'open');
      this.logger.warn(`Circuit breaker RE-OPENED for ${provider}`);
    } else if (state.state === 'closed' && state.failureCount >= this.config.failureThreshold) {
      this.transition(provider, 'open');
      this.logger.warn(`Circuit breaker OPENED for ${provider} after ${state.failureCount} failures`);
    }
  }

  getState(provider: LLMProvider): CircuitBreakerState {
    if (!this.states.has(provider)) {
      this.states.set(provider, {
        provider,
        state: 'closed',
        failureCount: 0,
        successCount: 0,
      });
    }
    return this.states.get(provider)!;
  }

  private transition(provider: LLMProvider, newState: CircuitBreakerState['state']): void {
    const state = this.getState(provider);
    state.state = newState;

    if (newState === 'open') {
      state.openUntil = new Date(Date.now() + this.config.recoveryTimeMs);
      state.successCount = 0;
    } else if (newState === 'closed') {
      state.failureCount = 0;
      state.successCount = 0;
      state.openUntil = undefined;
    } else if (newState === 'half-open') {
      state.successCount = 0;
    }
  }
}

// ── Retry Engine ────────────────────────────────────────────

export interface RetryableOperation<T> {
  (): Promise<T>;
}

export interface RetryResult<T> {
  success: boolean;
  result?: T;
  error?: Error;
  attempts: number;
  totalDelayMs: number;
}

export async function executeWithRetry<T>(
  operation: RetryableOperation<T>,
  policy: RetryPolicy,
  logger: Logger,
  context?: string,
): Promise<RetryResult<T>> {
  let lastError: Error | undefined;
  let totalDelay = 0;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    try {
      const result = await operation();
      return { success: true, result, attempts: attempt, totalDelayMs: totalDelay };
    } catch (err) {
      lastError = err as Error;
      const errorCode = classifyErrorCode(lastError);

      logger.warn(`Attempt ${attempt}/${policy.maxAttempts} failed${context ? ` (${context})` : ''}`, {
        error: lastError.message,
        code: errorCode,
        retryable: policy.retryableErrors.includes(errorCode),
      });

      // Check if error is retryable
      if (!policy.retryableErrors.includes(errorCode)) {
        logger.warn(`Error code ${errorCode} is not retryable, aborting`);
        break;
      }

      // Don't delay after the last attempt
      if (attempt < policy.maxAttempts) {
        const delay = Math.min(
          policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
          policy.maxDelayMs,
        );
        // Add jitter (±25%) to prevent thundering herd
        const jitter = delay * 0.25 * (Math.random() * 2 - 1);
        const actualDelay = Math.max(0, Math.round(delay + jitter));

        totalDelay += actualDelay;
        await new Promise(resolve => setTimeout(resolve, actualDelay));
      }
    }
  }

  return {
    success: false,
    error: lastError,
    attempts: policy.maxAttempts,
    totalDelayMs: totalDelay,
  };
}

// ── Model Router with Circuit Breaker ───────────────────────

export interface LLMCallParams {
  model: ModelConfig;
  system: string;
  messages: { role: 'user' | 'assistant'; content: string }[];
}

export interface LLMCallResult {
  content: string;
  tokensIn: number;
  tokensOut: number;
  model: string;
  provider: LLMProvider;
}

export class ResilientModelRouter {
  private circuitBreaker: CircuitBreaker;
  private logger: Logger;
  private callFn: (params: LLMCallParams) => Promise<LLMCallResult>;

  constructor(
    callFn: (params: LLMCallParams) => Promise<LLMCallResult>,
    logger: Logger,
    cbConfig?: Partial<CircuitBreakerConfig>,
  ) {
    this.callFn = callFn;
    this.logger = logger;
    this.circuitBreaker = new CircuitBreaker(logger, cbConfig);
  }

  async call(
    primary: ModelConfig,
    fallback: ModelConfig | undefined,
    system: string,
    messages: { role: 'user' | 'assistant'; content: string }[],
    retryPolicy: RetryPolicy,
  ): Promise<LLMCallResult> {
    // Try primary if circuit is closed
    if (this.circuitBreaker.canUse(primary.provider)) {
      const result = await executeWithRetry(
        () => this.callFn({ model: primary, system, messages }),
        retryPolicy,
        this.logger,
        `${primary.provider}/${primary.model}`,
      );

      if (result.success) {
        this.circuitBreaker.recordSuccess(primary.provider);
        return result.result!;
      }

      this.circuitBreaker.recordFailure(primary.provider);
      this.logger.warn(`Primary model ${primary.model} exhausted retries`);
    } else {
      this.logger.warn(`Primary provider ${primary.provider} circuit is open, skipping`);
    }

    // Try fallback
    if (fallback && this.circuitBreaker.canUse(fallback.provider)) {
      this.logger.info(`Falling back to ${fallback.provider}/${fallback.model}`);

      const result = await executeWithRetry(
        () => this.callFn({ model: fallback, system, messages }),
        retryPolicy,
        this.logger,
        `${fallback.provider}/${fallback.model} (fallback)`,
      );

      if (result.success) {
        this.circuitBreaker.recordSuccess(fallback.provider);
        return result.result!;
      }

      this.circuitBreaker.recordFailure(fallback.provider);
    }

    throw new Error(
      `All models exhausted for providers: [${primary.provider}${fallback ? `, ${fallback.provider}` : ''}]`,
    );
  }
}

// ── Helpers ─────────────────────────────────────────────────

function classifyErrorCode(error: Error): string {
  const msg = error.message.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429')) return 'RATE_LIMITED';
  if (msg.includes('timeout') || msg.includes('timed out')) return 'TIMEOUT';
  if (msg.includes('500') || msg.includes('internal server')) return 'PROVIDER_ERROR';
  if (msg.includes('context length') || msg.includes('too many tokens')) return 'TOKEN_OVERFLOW';
  if (msg.includes('parse') || msg.includes('json')) return 'PARSE_ERROR';
  if (msg.includes('validation')) return 'VALIDATION_ERROR';
  if (msg.includes('auth') || msg.includes('401') || msg.includes('403')) return 'AUTH_ERROR';
  return 'UNKNOWN';
}
