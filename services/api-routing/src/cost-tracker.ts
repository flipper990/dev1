import { Logger, BudgetExceededError } from '@devteam/core';
import type { LLMProvider } from '@devteam/core';
import { config } from '@devteam/core';

// ─── Cost Tracker ─────────────────────────────────────────────────────────────

interface ProviderCost {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  requestCount: number;
}

export class CostTracker {
  private readonly byProvider = new Map<LLMProvider, ProviderCost>();
  private totalSpentUsd = 0;
  private readonly logger = new Logger('cost-tracker');

  record(
    provider: LLMProvider,
    inputTokens: number,
    outputTokens: number,
    costUsd: number,
  ): void {
    const existing = this.byProvider.get(provider) ?? {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd: 0,
      requestCount: 0,
    };

    existing.totalInputTokens += inputTokens;
    existing.totalOutputTokens += outputTokens;
    existing.totalCostUsd += costUsd;
    existing.requestCount++;

    this.byProvider.set(provider, existing);
    this.totalSpentUsd += costUsd;

    if (this.totalSpentUsd > config.limits.monthlyBudgetUsd) {
      this.logger.warn('Monthly budget exceeded', {
        spent: this.totalSpentUsd,
        limit: config.limits.monthlyBudgetUsd,
      });
      throw new BudgetExceededError(
        `Monthly budget of $${config.limits.monthlyBudgetUsd} exceeded (spent: $${this.totalSpentUsd.toFixed(4)})`,
      );
    }
  }

  getSummary(): {
    totalSpentUsd: number;
    byProvider: Record<string, ProviderCost>;
    budgetRemainingUsd: number;
  } {
    return {
      totalSpentUsd: this.totalSpentUsd,
      byProvider: Object.fromEntries(this.byProvider),
      budgetRemainingUsd: Math.max(0, config.limits.monthlyBudgetUsd - this.totalSpentUsd),
    };
  }

  reset(): void {
    this.byProvider.clear();
    this.totalSpentUsd = 0;
  }
}

export const globalCostTracker = new CostTracker();
