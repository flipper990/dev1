// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Cost Tracker â€” Per-request cost estimation and aggregation
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { LLMProvider } from '../../../../packages/agent-core/src/types.js';
import type { CostRecord, CostSummary, TaskCategory } from './types.js';

// â”€â”€ Pricing Table (USD per 1M tokens) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Updated periodically. Add new models here when providers
// release them.

interface ModelPricing {
  inputPer1M: number;
  outputPer1M: number;
}

const PRICING: Record<string, ModelPricing> = {
  // Anthropic Claude
  'claude-opus-4-20250514':       { inputPer1M: 15.00,  outputPer1M: 75.00  },
  'claude-sonnet-4-20250514':     { inputPer1M: 3.00,   outputPer1M: 15.00  },
  'claude-3-5-sonnet-20241022':   { inputPer1M: 3.00,   outputPer1M: 15.00  },
  'claude-3-opus-20240229':       { inputPer1M: 15.00,  outputPer1M: 75.00  },
  'claude-3-haiku-20240307':      { inputPer1M: 0.25,   outputPer1M: 1.25   },

  // OpenAI
  'gpt-4o':                       { inputPer1M: 2.50,   outputPer1M: 10.00  },
  'gpt-4o-2024-11-20':            { inputPer1M: 2.50,   outputPer1M: 10.00  },
  'gpt-4o-mini':                  { inputPer1M: 0.15,   outputPer1M: 0.60   },
  'gpt-4o-mini-2024-07-18':       { inputPer1M: 0.15,   outputPer1M: 0.60   },
  'gpt-4-turbo':                  { inputPer1M: 10.00,  outputPer1M: 30.00  },
  'o1':                           { inputPer1M: 15.00,  outputPer1M: 60.00  },
  'o1-mini':                      { inputPer1M: 3.00,   outputPer1M: 12.00  },

  // Google Gemini
  'gemini-2.0-pro':               { inputPer1M: 1.25,   outputPer1M: 5.00   },
  'gemini-2.0-flash':             { inputPer1M: 0.10,   outputPer1M: 0.40   },
  'gemini-1.5-pro':               { inputPer1M: 1.25,   outputPer1M: 5.00   },
};

// Fallback pricing when model not in table
const DEFAULT_PRICING: ModelPricing = { inputPer1M: 5.00, outputPer1M: 15.00 };

export class CostTracker {
  private records: CostRecord[] = [];
  private maxRecords: number;

  constructor(maxRecords = 10_000) {
    this.maxRecords = maxRecords;
  }

  /** Estimate cost for a given model + token counts. */
  static estimateCost(model: string, tokensIn: number, tokensOut: number): number {
    const pricing = PRICING[model] ?? DEFAULT_PRICING;
    return (tokensIn * pricing.inputPer1M + tokensOut * pricing.outputPer1M) / 1_000_000;
  }

  /** Get the pricing entry for a model (for display). */
  static getPricing(model: string): ModelPricing {
    return PRICING[model] ?? DEFAULT_PRICING;
  }

  /** Register a new model's pricing at runtime. */
  static registerPricing(model: string, pricing: ModelPricing): void {
    PRICING[model] = pricing;
  }

  /** Record a completed (or failed) request. */
  record(record: CostRecord): void {
    this.records.push(record);

    // Evict oldest records when over capacity
    if (this.records.length > this.maxRecords) {
      this.records = this.records.slice(-Math.floor(this.maxRecords * 0.9));
    }
  }

  /** Get all records, optionally filtered. */
  getRecords(filter?: {
    provider?: LLMProvider;
    model?: string;
    category?: TaskCategory;
    since?: Date;
  }): CostRecord[] {
    let result = this.records;
    if (filter?.provider) result = result.filter(r => r.provider === filter.provider);
    if (filter?.model)    result = result.filter(r => r.model === filter.model);
    if (filter?.category) result = result.filter(r => r.taskCategory === filter.category);
    if (filter?.since)    result = result.filter(r => r.timestamp >= filter.since!);
    return result;
  }

  /** Compute aggregate summary. */
  getSummary(since?: Date): CostSummary {
    const records = since ? this.records.filter(r => r.timestamp >= since) : this.records;
    if (records.length === 0) {
      return {
        totalRequests: 0, totalCostUsd: 0, totalTokensIn: 0, totalTokensOut: 0,
        avgLatencyMs: 0, byProvider: {}, byModel: {}, byCategory: {},
        fallbackRate: 0, errorRate: 0,
      };
    }

    const byProvider: CostSummary['byProvider'] = {};
    const byModel: CostSummary['byModel'] = {};
    const byCategory: CostSummary['byCategory'] = {};
    let totalCost = 0, totalIn = 0, totalOut = 0, totalLatency = 0;
    let fallbacks = 0, errors = 0;

    for (const r of records) {
      totalCost += r.costUsd;
      totalIn += r.tokensIn;
      totalOut += r.tokensOut;
      totalLatency += r.latencyMs;
      if (r.usedFallback) fallbacks++;
      if (!r.success) errors++;

      // By provider
      const p = byProvider[r.provider] ??= { requests: 0, costUsd: 0, tokens: 0 };
      p.requests++;
      p.costUsd += r.costUsd;
      p.tokens += r.tokensIn + r.tokensOut;

      // By model
      const m = byModel[r.model] ??= { requests: 0, costUsd: 0, tokens: 0 };
      m.requests++;
      m.costUsd += r.costUsd;
      m.tokens += r.tokensIn + r.tokensOut;

      // By category
      if (r.taskCategory) {
        const c = byCategory[r.taskCategory] ??= { requests: 0, costUsd: 0 };
        c.requests++;
        c.costUsd += r.costUsd;
      }
    }

    return {
      totalRequests: records.length,
      totalCostUsd: totalCost,
      totalTokensIn: totalIn,
      totalTokensOut: totalOut,
      avgLatencyMs: totalLatency / records.length,
      byProvider,
      byModel,
      byCategory,
      fallbackRate: fallbacks / records.length,
      errorRate: errors / records.length,
    };
  }

  /** Clear all records. */
  clear(): void {
    this.records = [];
  }
}
