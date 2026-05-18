// Smart LLM Router — task-aware routing with fallback, retry, circuit breaker,
// cost tracking, and dynamic model switching.
// Config / presets / helpers -> ./router-config.ts

import { randomUUID } from 'node:crypto';
import type { AgentRole, LLMProvider, ModelConfig } from '../../../../packages/agent-core/src/types.js';
import type { LLMClient, Logger } from '../../../../packages/agent-core/src/base-agent.js';
import { CircuitBreaker } from '../../../../packages/agent-core/src/resilience.js';
import type { CircuitBreakerConfig } from '../../../../packages/agent-core/src/resilience.js';
import { ProviderRegistry } from './provider-registry.js';
import { CostTracker } from './cost-tracker.js';
import { GenerationBudgetGuard, type GenerationBudgetEventHandler } from './generation-budget.js';
import type { ChatMessage, CostSummary, LLMProviderClient, LLMRequestMetadata, ModelOverride, RoutedLLMResponse, RouterConfig, RoutingRule, TaskCategory } from './types.js';
import { ROLE_TO_CATEGORY as roleToCategory } from './types.js';
import { buildRoutingRulesFromConfig, buildFallbackByModelMap, classifyRouterError, isRetryable, sleep } from './router-config.js';

export class SmartLLMRouter implements LLMClient {
  private registry: ProviderRegistry;
  private costTracker: CostTracker;
  private circuitBreaker: CircuitBreaker;
  private logger: Logger;
  private rules: Map<TaskCategory, RoutingRule>;
  private overrides: ModelOverride[] = [];
  /** Explicit per-model fallback map. NEVER inferred — only set via .env. */
  private fallbackByModel: Map<string, ModelConfig>;
  /** Optional default model — only used when both routeByCategory and a model hint are absent. */
  private defaultModel?: ModelConfig;
  private maxRetries: number;
  private retryBaseDelayMs: number;
  private budgetGuard?: GenerationBudgetGuard;

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
    this.rules = new Map();
    for (const rule of config?.rules ?? buildRoutingRulesFromConfig()) {
      this.rules.set(rule.category, rule);
    }
    this.fallbackByModel = config?.fallbackByModel ?? buildFallbackByModelMap();
    this.defaultModel    = config?.defaultModel;
    this.maxRetries          = config?.maxRetries          ?? 3;
    this.retryBaseDelayMs    = config?.retryBaseDelayMs    ?? 1000;
    if (config?.generationBudget) {
      this.budgetGuard = new GenerationBudgetGuard(
        config.generationBudget,
        (projectId) => this.costTracker.getProjectCostUsd(projectId),
      );
    }
  }

  async chatSync(params: { model: ModelConfig; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; metadata?: LLMRequestMetadata }): Promise<{ content: string; tokensIn: number; tokensOut: number; costUsd?: number; provider?: LLMProvider; model?: string; requestId?: string }> {
    const result = await this.routedCall(params.model, params.system, params.messages, params.metadata);
    return {
      content: result.content,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd,
      provider: result.provider,
      model: result.model,
      requestId: result.requestId,
    };
  }

  async *chat(params: { model: ModelConfig; system: string; messages: { role: 'user' | 'assistant'; content: string }[]; stream?: boolean; metadata?: LLMRequestMetadata }): AsyncGenerator<string, void, unknown> {
    if (!this.circuitBreaker.canUse(params.model.provider)) {
      const fallback = this.fallbackByModel.get(params.model.model);
      if (fallback && fallback.model !== params.model.model && this.circuitBreaker.canUse(fallback.provider) && this.registry.has(fallback.provider)) {
        this.logger.warn(`Streaming circuit open for ${params.model.provider}/${params.model.model}, using configured fallback ${fallback.provider}/${fallback.model}`);
        yield* this.getProviderClient(fallback.provider).chatStream({ ...params, model: fallback });
        return;
      }
      throw new Error(`Circuit open for provider ${params.model.provider} and no explicit streaming fallback configured for ${params.model.model}`);
    }
    if (!this.registry.has(params.model.provider)) throw new Error(`Provider ${params.model.provider} not registered`);
    try {
      yield* this.getProviderClient(params.model.provider).chatStream(params);
      this.circuitBreaker.recordSuccess(params.model.provider);
    } catch (err) {
      this.circuitBreaker.recordFailure(params.model.provider);
      throw err;
    }
  }

  async routeByRole(role: AgentRole, system: string, messages: ChatMessage[], modelHint?: ModelConfig): Promise<RoutedLLMResponse> {
    const category = roleToCategory[role];
    return this.routeByCategory(category, system, messages, modelHint, role);
  }

  async routeByCategory(category: TaskCategory, system: string, messages: ChatMessage[], modelHint?: ModelConfig, agentRole?: AgentRole): Promise<RoutedLLMResponse> {
    const override  = this.findOverride(agentRole, category);
    const rule      = this.rules.get(category);
    const primary   = override ?? modelHint ?? rule?.primary ?? this.defaultModel;
    if (!primary) throw new Error(`No model configured for category "${category}" and no default model set`);
    const fallbacks = (rule?.fallbacks ?? []).filter(fb => fb.model !== primary.model);
    return this.executeWithFallbackChain(primary, fallbacks, system, messages, { agentRole, taskCategory: category });
  }

  async routedCall(model: ModelConfig, system: string, messages: ChatMessage[], meta?: LLMRequestMetadata): Promise<RoutedLLMResponse> {
    // Explicit fallback only — must be configured in .env via MODEL_<ROLE>_FALLBACK.
    const explicit = this.fallbackByModel.get(model.model);
    const fallbacks = explicit && explicit.model !== model.model ? [explicit] : [];
    const enrichedMeta = meta?.agentRole && !meta.taskCategory
      ? { ...meta, taskCategory: roleToCategory[meta.agentRole] }
      : meta;
    return this.executeWithFallbackChain(model, fallbacks, system, messages, enrichedMeta);
  }

  addOverride(override: ModelOverride): void {
    this.overrides = this.overrides.filter(o => !(o.target === override.target && o.targetType === override.targetType));
    this.overrides.push(override);
    this.logger.info(`Model override added: ${override.targetType}:${override.target} → ${override.model.provider}/${override.model.model}`);
  }

  removeOverride(target: AgentRole | TaskCategory, targetType: 'role' | 'category'): boolean {
    const before = this.overrides.length;
    this.overrides = this.overrides.filter(o => !(o.target === target && o.targetType === targetType));
    return this.overrides.length < before;
  }

  clearOverrides(): void { this.overrides = []; }

  getActiveOverrides(): ModelOverride[] {
    const now = new Date();
    this.overrides = this.overrides.filter(o => !o.expiresAt || o.expiresAt > now);
    return [...this.overrides];
  }

  getCostTracker(): CostTracker    { return this.costTracker; }
  getCostSummary(since?: Date): CostSummary { return this.costTracker.getSummary(since); }
  getGenerationBudgetGuard(): GenerationBudgetGuard | undefined { return this.budgetGuard; }
  onGenerationBudgetEvent(handler: GenerationBudgetEventHandler): void {
    this.budgetGuard?.onEvent(handler);
  }
  getCircuitBreakerStates(): Record<LLMProvider, string> {
    const states: Record<string, string> = {};
    for (const id of this.registry.listIds()) states[id] = this.circuitBreaker.getState(id).state;
    return states as Record<LLMProvider, string>;
  }
  getProviderRegistry(): ProviderRegistry { return this.registry; }

  private async executeWithFallbackChain(
    primary: ModelConfig,
    fallbacks: ModelConfig[],
    system: string,
    messages: ChatMessage[],
    meta?: LLMRequestMetadata,
  ): Promise<RoutedLLMResponse> {
    const requestId = randomUUID();
    const overallStart = Date.now();
    const models = [primary, ...fallbacks];
    let lastError: Error | undefined;

    for (let mi = 0; mi < models.length; mi++) {
      const model = models[mi];
      const isFallback = mi > 0;
      const provider = model.provider;

      if (!this.circuitBreaker.canUse(provider)) { this.logger.warn(`Circuit open for ${provider}, skipping ${model.model}`); continue; }
      if (!this.registry.has(provider))           { this.logger.warn(`Provider ${provider} not registered, skipping ${model.model}`); continue; }

      for (let attempt = 1; attempt <= this.maxRetries; attempt++) {
        const start = Date.now();
        try {
          if (isFallback && attempt === 1) this.logger.info(`Falling back to ${provider}/${model.model}`, { requestId });
          if (attempt > 1)                 this.logger.info(`Retry ${attempt}/${this.maxRetries} for ${provider}/${model.model}`, { requestId });

          this.budgetGuard?.checkBeforeCall({
            ...meta,
            requestId,
            provider,
            model: model.model,
          });

          const response  = await this.getProviderClient(provider).chatSync({ model, system, messages });
          const latencyMs = Date.now() - start;
          const costUsd   = CostTracker.estimateCost(model.model, response.tokensIn, response.tokensOut);
          this.circuitBreaker.recordSuccess(provider);
          this.costTracker.record({ requestId, timestamp: new Date(), projectId: meta?.projectId, sessionId: meta?.sessionId, provider, model: model.model, tokensIn: response.tokensIn, tokensOut: response.tokensOut, costUsd, latencyMs, agentRole: meta?.agentRole, taskCategory: meta?.taskCategory, usedFallback: isFallback, success: true });
          this.budgetGuard?.checkAfterRecord({
            ...meta,
            requestId,
            provider,
            model: model.model,
          });
          this.logger.debug(`LLM call completed`, { requestId, provider, model: model.model, tokensIn: response.tokensIn, tokensOut: response.tokensOut, costUsd: costUsd.toFixed(6), latencyMs, isFallback });
          return { ...response, model: model.model, provider, usedFallback: isFallback, latencyMs: Date.now() - overallStart, costUsd, requestId };
        } catch (err) {
          lastError = err as Error;
          if ((lastError as Error & { code?: string }).code === 'COST_LIMIT_EXCEEDED') {
            this.logger.warn('LLM call blocked by generation budget guard', {
              requestId,
              provider,
              model: model.model,
              projectId: meta?.projectId,
              agentRole: meta?.agentRole,
            });
            throw lastError;
          }
          const latencyMs = Date.now() - start;
          const errorCode = classifyRouterError(lastError);
          this.logger.warn(`LLM call failed: ${provider}/${model.model}`, { requestId, attempt, error: lastError.message, errorCode });
          this.costTracker.record({ requestId, timestamp: new Date(), projectId: meta?.projectId, sessionId: meta?.sessionId, provider, model: model.model, tokensIn: 0, tokensOut: 0, costUsd: 0, latencyMs, agentRole: meta?.agentRole, taskCategory: meta?.taskCategory, usedFallback: isFallback, success: false, error: lastError.message });
          // Rate-limit (429) is throttling, not a provider outage.
          // Tripping the breaker on 429 punishes the whole provider for a
          // legitimate per-minute quota event and prevents the fallback
          // chain from even trying the smaller model on the same provider.
          if (errorCode !== 'RATE_LIMITED') {
            this.circuitBreaker.recordFailure(provider);
          }
          if (!isRetryable(errorCode)) { this.logger.warn(`Error ${errorCode} is not retryable, moving to next model`); break; }
          // On RATE_LIMITED, the per-minute bucket is full — retrying the
          // same big model will just fail again. Jump straight to the
          // fallback (typically a smaller model with higher TPM headroom).
          if (errorCode === 'RATE_LIMITED' && mi < models.length - 1) {
            this.logger.warn(`Rate limit on ${provider}/${model.model} — skipping retries, moving to fallback`, { requestId });
            break;
          }
          if (attempt < this.maxRetries) {
            // Rate limits (TPM/RPM) reset on a 60s window. Short
            // exponential backoff isn't enough — wait long enough for
            // the bucket to refill before retrying.
            const baseDelay = errorCode === 'RATE_LIMITED'
              ? 20000 // 20s, 40s on next attempt
              : this.retryBaseDelayMs;
            const delay = baseDelay * Math.pow(2, attempt - 1);
            await sleep(Math.max(100, Math.round(delay + delay * 0.25 * (Math.random() * 2 - 1))));
          }
        }
      }
    }

    const totalMs = Date.now() - overallStart;
    const tried = models.map(m => `${m.provider}/${m.model}`).join(', ');
    const fallbackDetail = (() => {
      if (!lastError) return 'unavailable';
      const tagged = lastError as unknown as { message?: string; code?: unknown; provider?: unknown; model?: unknown };
      const parts = [
        tagged.message ?? lastError.message,
        typeof tagged.code === 'string' ? `code=${tagged.code}` : null,
        typeof tagged.provider === 'string' ? `provider=${tagged.provider}` : null,
        typeof tagged.model === 'string' ? `model=${tagged.model}` : null,
      ].filter((p): p is string => Boolean(p && p.trim().length > 0));
      return parts.join('; ');
    })();
    throw new Error(`All models exhausted after ${totalMs}ms. Tried: [${tried}]. Last error: ${fallbackDetail}`);
  }

  private findOverride(role?: AgentRole, category?: TaskCategory): ModelConfig | undefined {
    const now = new Date();
    this.overrides = this.overrides.filter(o => !o.expiresAt || o.expiresAt > now);
    if (role) {
      const o = this.overrides.find(o => o.targetType === 'role' && o.target === role);
      if (o) return o.model;
    }
    if (category) {
      const o = this.overrides.find(o => o.targetType === 'category' && o.target === category);
      if (o) return o.model;
    }
    return undefined;
  }

  private getProviderClient(provider: LLMProvider): LLMProviderClient {
    return this.registry.get(provider);
  }
}
