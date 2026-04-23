import { Logger, LLMError, config } from '@devteam/core';
import type { AgentRole, LLMModel, LLMProvider, LLMRequest, LLMResponse } from '@devteam/core';
import { CircuitBreaker } from './circuit-breaker.js';
import { CostTracker, globalCostTracker } from './cost-tracker.js';

// ─── Model registry ───────────────────────────────────────────────────────────

export const MODEL_REGISTRY: Record<string, LLMModel> = {
  'gpt-4.1': {
    id: 'gpt-4.1',
    provider: 'openai',
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    inputCostPer1kTokens: 0.002,
    outputCostPer1kTokens: 0.008,
    supportsStreaming: true,
    supportsVision: true,
  },
  'gpt-4.1-mini': {
    id: 'gpt-4.1-mini',
    provider: 'openai',
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    inputCostPer1kTokens: 0.0004,
    outputCostPer1kTokens: 0.0016,
    supportsStreaming: true,
    supportsVision: true,
  },
  'gpt-4.1-nano': {
    id: 'gpt-4.1-nano',
    provider: 'openai',
    contextWindow: 1_047_576,
    maxOutputTokens: 32_768,
    inputCostPer1kTokens: 0.0001,
    outputCostPer1kTokens: 0.0004,
    supportsStreaming: true,
    supportsVision: true,
  },
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputCostPer1kTokens: 0.0025,
    outputCostPer1kTokens: 0.01,
    supportsStreaming: true,
    supportsVision: true,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    contextWindow: 128_000,
    maxOutputTokens: 16_384,
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
    supportsStreaming: true,
    supportsVision: true,
  },
  'claude-3-5-sonnet-20241022': {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 8_192,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    supportsStreaming: true,
    supportsVision: true,
  },
  'claude-3-haiku-20240307': {
    id: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    contextWindow: 200_000,
    maxOutputTokens: 4_096,
    inputCostPer1kTokens: 0.00025,
    outputCostPer1kTokens: 0.00125,
    supportsStreaming: true,
    supportsVision: false,
  },
};

// ─── LLM Router ───────────────────────────────────────────────────────────────

export class LLMRouter {
  private readonly logger = new Logger('llm-router');
  private readonly breaker = new CircuitBreaker();
  private readonly costTracker: CostTracker;
  private modelOverrides = new Map<AgentRole, string>();

  constructor(costTracker: CostTracker = globalCostTracker) {
    this.costTracker = costTracker;
  }

  setModelOverride(role: AgentRole, modelId: string): void {
    this.modelOverrides.set(role, modelId);
  }

  clearModelOverride(role: AgentRole): void {
    this.modelOverrides.delete(role);
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const modelId = this.resolveModel(request);
    const model = MODEL_REGISTRY[modelId];

    if (!model) {
      throw new LLMError(`Unknown model: ${modelId}`, 'unknown', modelId, false);
    }

    if (!this.breaker.isAvailable(model.provider)) {
      // Attempt fallback
      const fallbackModel = this.getFallback(model.provider, request.agentRole);
      if (!fallbackModel) {
        throw new LLMError(
          `Provider ${model.provider} circuit is open and no fallback available`,
          model.provider,
          modelId,
          false,
        );
      }
      this.logger.warn('Using fallback model due to circuit breaker', {
        original: modelId,
        fallback: fallbackModel.id,
      });
      return this.executeRequest(request, fallbackModel);
    }

    try {
      const response = await this.executeWithRetry(request, model);
      this.breaker.recordSuccess(model.provider);
      return response;
    } catch (err) {
      this.breaker.recordFailure(model.provider);
      throw err;
    }
  }

  /** Wraps executeRequest with exponential-backoff retry on transient failures. */
  private async executeWithRetry(request: LLMRequest, model: LLMModel, maxAttempts = 3): Promise<LLMResponse> {
    let lastErr: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.executeRequest(request, model);
      } catch (err) {
        lastErr = err;
        const retriable = this.isRetriable(err);
        if (!retriable || attempt === maxAttempts) throw err;
        const backoffMs = Math.min(8000, 2 ** attempt * 250) + Math.floor(Math.random() * 250);
        this.logger.warn('LLM transient failure, retrying', {
          model: model.id,
          attempt,
          backoffMs,
          error: err instanceof Error ? err.message : String(err),
        });
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
    throw lastErr;
  }

  /** Heuristic: retry on network errors, rate limits, 5xx — not on auth/4xx. */
  private isRetriable(err: unknown): boolean {
    if (!err) return false;
    const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
    if (/\b(401|403|invalid api key|unauthorized|forbidden|not found|invalid request)\b/.test(msg)) return false;
    if (/\b(429|rate.?limit|too many requests|overloaded|timeout|timed out|econnreset|etimedout|socket hang up|fetch failed|network|502|503|504|internal server error|5\d\d)\b/.test(msg)) return true;
    // Default: don't retry on unknown errors to avoid masking real bugs.
    return false;
  }

  getCircuitStatus(): Record<string, unknown> {
    return this.breaker.getStatus();
  }

  getCostSummary(): ReturnType<CostTracker['getSummary']> {
    return this.costTracker.getSummary();
  }

  // ── Private ─────────────────────────────────────────────────────────────

  private resolveModel(request: LLMRequest): string {
    if (request.agentRole && this.modelOverrides.has(request.agentRole)) {
      return this.modelOverrides.get(request.agentRole)!;
    }
    if (request.model) return request.model;
    if (request.agentRole) {
      return config.llm.modelsByRole[request.agentRole];
    }
    return 'gpt-4o-mini';
  }

  private getFallback(failedProvider: LLMProvider, role?: AgentRole): LLMModel | undefined {
    const fallbackMap: Record<LLMProvider, string> = {
      openai: 'claude-3-haiku-20240307',
      anthropic: 'gpt-4o-mini',
      google: 'gpt-4o-mini',
      together: 'gpt-4o-mini',
    };
    const fallbackId = fallbackMap[failedProvider];
    return MODEL_REGISTRY[fallbackId];
  }

  private async executeRequest(request: LLMRequest, model: LLMModel): Promise<LLMResponse> {
    const startedAt = Date.now();

    this.logger.debug('Executing LLM request', {
      model: model.id,
      provider: model.provider,
      role: request.agentRole,
    });

    let rawResponse: { content: string; inputTokens: number; outputTokens: number };

    if (model.provider === 'openai') {
      rawResponse = await this.callOpenAI(request, model);
    } else if (model.provider === 'anthropic') {
      rawResponse = await this.callAnthropic(request, model);
    } else {
      throw new LLMError(`Provider ${model.provider} not implemented`, model.provider, model.id, false);
    }

    const durationMs = Date.now() - startedAt;
    const costUsd =
      (rawResponse.inputTokens / 1000) * model.inputCostPer1kTokens +
      (rawResponse.outputTokens / 1000) * model.outputCostPer1kTokens;

    this.costTracker.record(model.provider, rawResponse.inputTokens, rawResponse.outputTokens, costUsd);

    return {
      content: rawResponse.content,
      model: model.id,
      provider: model.provider,
      inputTokens: rawResponse.inputTokens,
      outputTokens: rawResponse.outputTokens,
      costUsd,
      durationMs,
    };
  }

  private async callOpenAI(
    request: LLMRequest,
    model: LLMModel,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    // Dynamic import to avoid hard dependency if not configured
    const { default: OpenAI } = await import('openai');
    const client = new OpenAI({ apiKey: config.llm.openaiApiKey });

    const response = await client.chat.completions.create({
      model: model.id,
      messages: request.messages,
      temperature: request.temperature ?? 0.2,
      max_tokens: request.maxTokens ?? model.maxOutputTokens,
      response_format: { type: 'json_object' },
    });

    const choice = response.choices[0];
    if (!choice?.message.content) {
      throw new LLMError('OpenAI returned empty response', 'openai', model.id, true);
    }

    return {
      content: choice.message.content,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
    };
  }

  private async callAnthropic(
    request: LLMRequest,
    model: LLMModel,
  ): Promise<{ content: string; inputTokens: number; outputTokens: number }> {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: config.llm.anthropicApiKey });

    const system = request.messages.find((m) => m.role === 'system')?.content;
    const messages = request.messages.filter((m) => m.role !== 'system');

    const createParams = {
      model: model.id,
      max_tokens: request.maxTokens ?? model.maxOutputTokens,
      messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ...(system !== undefined ? { system } : {}),
    } as const;

    const response = await client.messages.create(createParams);

    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new LLMError('Anthropic returned empty response', 'anthropic', model.id, true);
    }

    return {
      content: block.text,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
    };
  }
}

export const globalLLMRouter = new LLMRouter();
