// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LLM Routing System â€” Shared types
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { LLMProvider, ModelConfig, AgentRole } from '../../../../packages/agent-core/src/types.js';

// â”€â”€ Provider Interface â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Every LLM provider must implement this interface. */
export interface LLMProviderClient {
  readonly providerId: LLMProvider;
  readonly displayName: string;

  chatSync(params: LLMRequestParams): Promise<LLMResponse>;
  chatStream(params: LLMRequestParams): AsyncGenerator<string, void, unknown>;

  /** Optional health check. If not implemented, provider is assumed healthy. */
  healthCheck?(): Promise<boolean>;
}

// â”€â”€ Request / Response â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface LLMRequestParams {
  model: ModelConfig;
  system: string;
  messages: ChatMessage[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LLMResponse {
  content: string;
  tokensIn: number;
  tokensOut: number;
}

// â”€â”€ Enriched Response (from router) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RoutedLLMResponse extends LLMResponse {
  /** Which model actually handled the request */
  model: string;
  /** Which provider handled it */
  provider: LLMProvider;
  /** Was a fallback used? */
  usedFallback: boolean;
  /** Total latency in ms */
  latencyMs: number;
  /** Estimated cost in USD */
  costUsd: number;
  /** Unique request ID for tracing */
  requestId: string;
}

// â”€â”€ Task Classification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Broad task categories that influence model selection. */
export type TaskCategory =
  | 'planning'       // decomposition, strategy â€” Claude excels
  | 'reasoning'      // analysis, review, debugging â€” Claude excels
  | 'code-generation'// writing code â€” either, but OpenAI often preferred
  | 'code-review'    // reviewing code â€” Claude excels
  | 'testing'        // generating tests â€” either
  | 'infrastructure' // devops, config â€” lightweight model
  | 'general';       // fallback category

/** Maps agent roles to task categories for routing. */
export const ROLE_TO_CATEGORY: Record<AgentRole, TaskCategory> = {
  intent_expander:  'planning',
  planner:          'planning',
  architect:        'reasoning',
  developer:        'code-generation',
  reviewer:         'code-review',
  tester:           'testing',
  debugger:         'reasoning',
  devops:           'infrastructure',
  optimizer:        'code-review',
  quality_enforcer: 'code-review',
};

// â”€â”€ Routing Rule â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** A routing rule maps a task category to a preferred model chain. */
export interface RoutingRule {
  category: TaskCategory;
  /** Primary model to use. */
  primary: ModelConfig;
  /** Ordered fallback chain â€” tried in sequence if primary fails. */
  fallbacks: ModelConfig[];
}

// â”€â”€ Router Configuration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface RouterConfig {
  /** Per-category routing rules. If a category has no rule, uses defaultModel. */
  rules: RoutingRule[];
  /** Default model when no rule matches. */
  defaultModel: ModelConfig;
  /** Default fallback when no rule-specific fallbacks available. */
  defaultFallback?: ModelConfig;
  /** Enable circuit breaker (default true). */
  enableCircuitBreaker?: boolean;
  /** Enable cost tracking (default true). */
  enableCostTracking?: boolean;
  /** Max retries per attempt (default 3). */
  maxRetries?: number;
  /** Base delay for retry backoff in ms (default 1000). */
  retryBaseDelayMs?: number;
}

// â”€â”€ Cost Tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface CostRecord {
  requestId: string;
  timestamp: Date;
  provider: LLMProvider;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  latencyMs: number;
  agentRole?: AgentRole;
  taskCategory?: TaskCategory;
  usedFallback: boolean;
  success: boolean;
  error?: string;
}

export interface CostSummary {
  totalRequests: number;
  totalCostUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  avgLatencyMs: number;
  byProvider: Record<string, { requests: number; costUsd: number; tokens: number }>;
  byModel: Record<string, { requests: number; costUsd: number; tokens: number }>;
  byCategory: Record<string, { requests: number; costUsd: number }>;
  fallbackRate: number;
  errorRate: number;
}

// â”€â”€ Model Override â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

/** Runtime override for a specific agent or category. */
export interface ModelOverride {
  /** Target â€” either a role or category. */
  target: AgentRole | TaskCategory;
  targetType: 'role' | 'category';
  /** Override model. */
  model: ModelConfig;
  /** Optional expiry â€” after this, override is removed. */
  expiresAt?: Date;
}
