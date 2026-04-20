import { Logger, LLMError } from '@devteam/core';
import type { LLMProvider } from '@devteam/core';

// ─── Circuit Breaker ──────────────────────────────────────────────────────────

const FAILURE_THRESHOLD = 5;
const RECOVERY_TIMEOUT_MS = 60_000;

type CircuitState = 'closed' | 'open' | 'half-open';

interface CircuitStatus {
  state: CircuitState;
  failures: number;
  openedAt?: number;
  lastFailure?: number;
}

export class CircuitBreaker {
  private readonly circuits = new Map<string, CircuitStatus>();
  private readonly logger = new Logger('circuit-breaker');

  isAvailable(provider: LLMProvider): boolean {
    const status = this.circuits.get(provider);
    if (!status || status.state === 'closed') return true;

    if (status.state === 'open') {
      const elapsed = Date.now() - (status.openedAt ?? 0);
      if (elapsed >= RECOVERY_TIMEOUT_MS) {
        status.state = 'half-open';
        this.logger.info('Circuit half-open', { provider });
        return true;
      }
      return false;
    }

    return true; // half-open: allow one probe
  }

  recordSuccess(provider: LLMProvider): void {
    const status = this.circuits.get(provider);
    if (!status) return;
    if (status.state === 'half-open') {
      this.logger.info('Circuit closed after recovery', { provider });
    }
    this.circuits.set(provider, { state: 'closed', failures: 0 });
  }

  recordFailure(provider: LLMProvider): void {
    const existing = this.circuits.get(provider) ?? { state: 'closed', failures: 0 };
    existing.failures++;
    existing.lastFailure = Date.now();

    if (existing.failures >= FAILURE_THRESHOLD || existing.state === 'half-open') {
      existing.state = 'open';
      existing.openedAt = Date.now();
      this.logger.warn('Circuit opened', { provider, failures: existing.failures });
    }

    this.circuits.set(provider, existing);
  }

  getStatus(): Record<string, CircuitStatus> {
    return Object.fromEntries(this.circuits);
  }
}
