// ─────────────────────────────────────────────────────────────
// Smart LLM Router — Task-aware routing with fallback, retry,
// circuit breaker, cost tracking, and dynamic model switching.
// Implements the LLMClient interface from base-agent.ts so it
// can be used as a drop-in replacement everywhere.
// ─────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';
import type { AgentRole, LLMProvider, ModelConfig } from '../../../packages/agent-core/src/types.js';
import type { LLMClient, Logger } from '../../../packages/agent-core/src/base-agent.js';
import { CircuitBreaker } from '../../../packages/agent-core/src/resilience.js';
import type { CircuitBreakerConfig } from '../../../packages/agent-core/src/resilience.js';
import { ProviderRegistry } from './provider-registry.js';
import { CostTracker } from './cost-tracker.js';
import type {
  ChatMessage,
  CostRecord,
  CostSummary,
  LLMProviderClient,
  LLMRequestParams,
  LLMResponse,
  ModelOverride,
  RoutedLLMResponse,
  RouterConfig,
  RoutingRule,
  TaskCategory,
  ROLE_TO_CATEGORY,
} from './types.js';
import { ROLE_TO_CATEGORY as roleToCategory } from './types.js';

// ── Default Routing Rules ───────────────────────────────────

const CLAUDE_OPUS: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-opus-4-20250514',
  maxTokens: 8192,
  temperature: 0.3,
};

const CLAUDE_SONNET: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 8192,
  temperature: 0.4,
};

const GPT_4O: ModelConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  maxTokens: 8192,
  temperature: 0.3,
};

const GPT_4O_MINI: ModelConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  maxTokens: 4096,
  temperature: 0.3,
};

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  // Planning & reasoning → Claude (best at nuanced analysis)
  { category: 'planning',        primary: CLAUDE_OPUS,   fallbacks: [GPT_4O, CLAUDE_SONNET] },
  { category: 'reasoning',       primary: CLAUDE_OPUS,   fallbacks: [GPT_4O, CLAUDE_SONNET] },
  { category: 'code-review',     primary: CLAUDE_OPUS,   fallbacks: [GPT_4O] },

  // Code generation → OpenAI (strong at structured code output)
  { category: 'code-generation', primary: GPT_4O,        fallbacks: [CLAUDE_SONNET, GPT_4O_MINI] },

  // Testing → Sonnet (good balance)
  { category: 'testing',         primary: CLAUDE_SONNET,  fallbacks: [GPT_4O_MINI] },

  // Infrastructure → lightweight model (cost-efficient)
  { category: 'infrastructure',  primary: GPT_4O_MINI,   fallbacks: [CLAUDE_SONNET] },

  // General fallback
  { category: 'general',         primary: CLAUDE_SONNET,  fallbacks: [GPT_4O] },
];

// ── Smart Router ────────────────────────────────────────────

export class SmartLLMRouter implements LLMClient {
  private registry: ProviderRegistry;
  private costTracker: CostTracker;
  private circuitBreaker: CircuitBreaker;
  private logger: Logger;
  private rules: Map<TaskCategory, RoutingRule>;
  private overrides: ModelOverride[] = [];
  private defaultModel: ModelConfig;
  private defaultFallback?: ModelConfig;
  private maxRetries: number;
  private retryBaseDelayMs: number;

  constructor(
    registry: ProviderRegistry,
    logger: Logger,
    config?: Partial<RouterConfig>,
    cbConfig?: Partial<CircuitBreakerConfig>,
  ) {
    this.registry = registry;
    this.logger = logger;
    this.costTracker = new CostTracker();
    this.circuitBreaker = new CircuitBreaker(logger, cbConfig);

    // Index rules by category
    this.rules = new Map();
    for (const rule of config?.rules ?? DEFAULT_ROUTING_RULES) {
      this.rules.set(rule.category, rule);
    }

    this.defaultModel = config?.defaultModel ?? CLAUDE_SONNET;
    this.defaultFallback = config?.defaultFallback ?? GPT_4O;
    this.maxRetries = config?.maxRetries ?? 3;
    this.retryBaseDelayMs = config?.retryBaseDelayMs ?? 1000;
  }

  // ── LLMClient interface (drop-in for base-agent) ─────────

  async chatSync(params: {
    model: ModelConfig;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{ content: string; tokensIn: number; tokensOut: number }> {
    // When called via LLMClient interface, we honor the model from the
    // agent definition but still add retry/fallback/cost-tracking.
    const result = await this.routedCall(params.model, params.system, params.messages);
    return { content: result.content, tokensIn: result.tokensIn, tokensOut: result.tokensOut };
  }

  async *chat(params: {
    model: ModelConfig;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    stream?: boolean;
  }): AsyncGenerator<string, void, unknown> {
    // Check circuit breaker before streaming — fall back to non-streaming on open circuit
    if (!this.circuitBreaker.canUse(params.model.provider)) {
      // Find first available fallback provider
      const fallback = this.defaultFallback;
      if (fallback && fallback.model !== params.model.model && this.circuitBreaker.canUse(fallback.provider) && this.registry.has(fallback.provider)) {
        this.logger.warn(`Streaming circuit open for ${params.model.provider}, falling back to ${fallback.provider}/${fallback.model}`);
        const client = this.getProviderClient(fallback.provider);
        yield* client.chatStream({ ...params, model: fallback });
        return;
      }
      throw new Error(`Circuit open for provider ${params.model.provider} and no streaming fallback available`);
    }

    if (!this.registry.has(params.model.provider)) {
      throw new Error(`Provider ${params.model.provider} not registered`);
    }

    try {
      const client = this.getProviderClient(params.model.provider);
      yield* client.chatStream(params);
      this.circuitBreaker.recordSuccess(params.model.provider);
    } catch (err) {
      this.circuitBreaker.recordFailure(params.model.provider);
      throw err;
    }
  }

  // ── Task-aware routing ────────────────────────────────────

  /**
   * Route a request by agent role. Uses the role → category mapping
   * to pick the best model, applying any active overrides.
   */
  async routeByRole(
    role: AgentRole,
    system: string,
    messages: ChatMessage[],
    modelHint?: ModelConfig,
  ): Promise<RoutedLLMResponse> {
    const category = roleToCategory[role];
    return this.routeByCategory(category, system, messages, modelHint, role);
  }

  /**
   * Route a request by task category. Resolves model from routing
   * rules, applies overrides, then calls with retry + fallback.
   */
  async routeByCategory(
    category: TaskCategory,
    system: string,
    messages: ChatMessage[],
    modelHint?: ModelConfig,
    agentRole?: AgentRole,
  ): Promise<RoutedLLMResponse> {
    // 1. Resolve primary model: override > hint > rule > default
    const override = this.findOverride(agentRole, category);
    const rule = this.rules.get(category);
    const primary = override ?? modelHint ?? rule?.primary ?? this.defaultModel;

    // 2. Build fallback chain
    const fallbacks = [
      ...(rule?.fallbacks ?? []),
      ...(this.defaultFallback ? [this.defaultFallback] : []),
    ].filter(fb => fb.model !== primary.model); // don't retry with same model

    // 3. Execute with retry + fallback
    return this.executeWithFallbackChain(primary, fallbacks, system, messages, {
      agentRole, taskCategory: category,
    });
  }

  // ── Direct routed call (with retry + fallback + tracking) ─

  async routedCall(
    model: ModelConfig,
    system: string,
    messages: ChatMessage[],
    meta?: { agentRole?: AgentRole; taskCategory?: TaskCategory },
  ): Promise<RoutedLLMResponse> {
    const fallbacks = this.defaultFallback && this.defaultFallback.model !== model.model
      ? [this.defaultFallback]
      : [];
    return this.executeWithFallbackChain(model, fallbacks, system, messages, meta);
  }

  // ── Dynamic model switching ───────────────────────────────

  /** Add a runtime model override for a role or category. */
  addOverride(override: ModelOverride): void {
    // Remove existing override for same target
    this.overrides = this.overrides.filter(
      o => !(o.target === override.target && o.targetType === override.targetType),
    );
    this.overrides.push(override);
    this.logger.info(`Model override added: ${override.targetType}:${override.target} → ${override.model.provider}/${override.model.model}`);
  }

  /** Remove override for a specific target. */
  removeOverride(target: AgentRole | TaskCategory, targetType: 'role' | 'category'): boolean {
    const before = this.overrides.length;
    this.overrides = this.overrides.filter(
      o => !(o.target === target && o.targetType === targetType),
    );
    return this.overrides.length < before;
  }

  /** Clear all overrides. */
  clearOverrides(): void {
    this.overrides = [];
  }

  /** List active overrides (excludes expired). */
  getActiveOverrides(): ModelOverride[] {
    const now = new Date();
    this.overrides = this.overrides.filter(o => !o.expiresAt || o.expiresAt > now);
    return [...this.overrides];
  }

  // ── Cost + metrics ────────────────────────────────────────

  getCostTracker(): CostTracker {
    return this.costTracker;
  }

  getCostSummary(since?: Date): CostSummary {
    return this.costTracker.getSummary(since);
  }

  getCircuitBreakerStates(): Record<LLMProvider, string> {
    const states: Record<string, string> = {};
    for (const id of this.registry.listIds()) {
      states[id] = this.circuitBreaker.getState(id).state;
    }
    return states as Record<LLMProvider, string>;
  }

  getProviderRegistry(): ProviderRegistry {
    return this.registry;
  }

  // ── Internals ─────────────────────────────────────────────

  private async executeWithFallbackChain(
    primary: ModelConfig,
    fallbacks: ModelConfig[],
    system: string,
    messages: ChatMessage[],
    meta?: { agentRole?: AgentRole; taskCategory?: TaskCategory },
  ): Promise<RoutedLLMResponse> {
    const requestId = randomUUID();
    const overallStart = Date.now();
    const models = [primary, ...fallbacks];
    let lastError: Error | undefined;

    for (let modelIdx = 0; modelIdx < models.length; modelIdx++) {
      const model = models[modelIdx];
      const isFallback = modelIdx > 0;
      const provider = model.provider;

      // Check circuit breaker
      if (!this.circuitBreaker.canUse(provider)) {
        this.logger.warn(`Circuit open for ${provider}, skipping ${model.model}`);
        continue;
      }

      // Check provider is registered
      if (!this.registry.has(provider)) {
        this.logger.warn(`Provider ${provider} not registered, skipping ${model.model}`);
        continue;
      }

      // Retry loop for this model
      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        const start = Date.now();
        try {
          if (isFallback && attempt === 1) {
            this.logger.info(`Falling back to ${provider}/${model.model}`, { requestId });
          }
          if (attempt > 1) {
            this.logger.info(`Retry ${attempt}/${this.maxRetries} for ${provider}/${model.model}`, { requestId });
          }

          const client = this.getProviderClient(provider);
          const response = await client.chatSync({ model, system, messages });
          const latencyMs = Date.now() - start;

          this.circuitBreaker.recordSuccess(provider);

          const costUsd = CostTracker.estimateCost(model.model, response.tokensIn, response.tokensOut);

          // Record cost
          this.costTracker.record({
            requestId,
            timestamp: new Date(),
            provider,
            model: model.model,
            tokensIn: response.tokensIn,
            tokensOut: response.tokensOut,
            costUsd,
            latencyMs,
            agentRole: meta?.agentRole,
            taskCategory: meta?.taskCategory,
            usedFallback: isFallback,
            success: true,
          });

          this.logger.debug(`LLM call completed`, {
            requestId,
            provider,
            model: model.model,
            tokensIn: response.tokensIn,
            tokensOut: response.tokensOut,
            costUsd: costUsd.toFixed(6),
            latencyMs,
            isFallback,
          });

          return {
            ...response,
            model: model.model,
            provider,
            usedFallback: isFallback,
            latencyMs: Date.now() - overallStart,
            costUsd,
            requestId,
          };
        } catch (err) {
          lastError = err as Error;
          const latencyMs = Date.now() - start;
          const errorCode = classifyError(lastError);

          this.logger.warn(`LLM call failed: ${provider}/${model.model}`, {
            requestId, attempt, error: lastError.message, errorCode,
          });

          // Record the failed attempt cost
          this.costTracker.record({
            requestId,
            timestamp: new Date(),
            provider,
            model: model.model,
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
            latencyMs,
            agentRole: meta?.agentRole,
            taskCategory: meta?.taskCategory,
            usedFallback: isFallback,
            success: false,
            error: lastError.message,
          });

          // Non-retryable errors: skip to next model immediately
          if (!isRetryable(errorCode)) {
            this.logger.warn(`Error ${errorCode} is not retryable, moving to next model`);
            this.circuitBreaker.recordFailure(provider);
            break;
          }

          // Record failure for circuit breaker
          this.circuitBreaker.recordFailure(provider);

          // Exponential backoff with jitter (only if retrying same model)
          if (attempt < this.maxRetries) {
            const delay = this.retryBaseDelayMs * Math.pow(2, attempt - 1);
            const jitter = delay * 0.25 * (Math.random() * 2 - 1);
            await sleep(Math.max(100, Math.round(delay + jitter)));
          }
        }
      }
    }

    // All models exhausted
    const totalMs = Date.now() - overallStart;
    const tried = models.map(m => `${m.provider}/${m.model}`).join(', ');
    throw new Error(
      `All models exhausted after ${totalMs}ms. Tried: [${tried}]. Last error: ${lastError?.message ?? 'unknown'}`,
    );
  }

  private findOverride(role?: AgentRole, category?: TaskCategory): ModelConfig | undefined {
    const now = new Date();
    // Purge expired
    this.overrides = this.overrides.filter(o => !o.expiresAt || o.expiresAt > now);

    // Role overrides take priority over category overrides
    if (role) {
      const roleOverride = this.overrides.find(o => o.targetType === 'role' && o.target === role);
      if (roleOverride) return roleOverride.model;
    }
    if (category) {
      const catOverride = this.overrides.find(o => o.targetType === 'category' && o.target === category);
      if (catOverride) return catOverride.model;
    }
    return undefined;
  }

  private getProviderClient(provider: LLMProvider): LLMProviderClient {
    return this.registry.get(provider);
  }
}

// ── Helpers ─────────────────────────────────────────────────

function classifyError(error: Error): string {
  const msg = error.message.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429'))                     return 'RATE_LIMITED';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnaborted')) return 'TIMEOUT';
  if (msg.includes('500') || msg.includes('internal server') || msg.includes('502') || msg.includes('503')) return 'PROVIDER_ERROR';
  if (msg.includes('context length') || msg.includes('too many tokens'))     return 'TOKEN_OVERFLOW';
  if (msg.includes('auth') || msg.includes('401') || msg.includes('403'))    return 'AUTH_ERROR';
  if (msg.includes('econnrefused') || msg.includes('enotfound'))             return 'NETWORK_ERROR';
  return 'UNKNOWN';
}

function isRetryable(code: string): boolean {
  return ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'NETWORK_ERROR', 'UNKNOWN'].includes(code);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
