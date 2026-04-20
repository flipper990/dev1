import { Logger, LLMError, config } from '@devteam/core';
import type { AgentRole, LLMModel, LLMProvider, LLMRequest, LLMResponse } from '@devteam/core';
import { CircuitBreaker } from './circuit-breaker.js';
import { CostTracker, globalCostTracker } from './cost-tracker.js';

// ─── Model registry ───────────────────────────────────────────────────────────

export const MODEL_REGISTRY: Record<string, LLMModel> = {
  'gpt-4o': {
    id: 'gpt-4o',
    provider: 'openai',
    contextWindow: 128_000,
    inputCostPer1kTokens: 0.0025,
    outputCostPer1kTokens: 0.01,
    supportsStreaming: true,
    supportsVision: true,
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    provider: 'openai',
    contextWindow: 128_000,
    inputCostPer1kTokens: 0.00015,
    outputCostPer1kTokens: 0.0006,
    supportsStreaming: true,
    supportsVision: true,
  },
  'claude-3-5-sonnet-20241022': {
    id: 'claude-3-5-sonnet-20241022',
    provider: 'anthropic',
    contextWindow: 200_000,
    inputCostPer1kTokens: 0.003,
    outputCostPer1kTokens: 0.015,
    supportsStreaming: true,
    supportsVision: true,
  },
  'claude-3-haiku-20240307': {
    id: 'claude-3-haiku-20240307',
    provider: 'anthropic',
    contextWindow: 200_000,
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
      const response = await this.executeRequest(request, model);
      this.breaker.recordSuccess(model.provider);
      return response;
    } catch (err) {
      this.breaker.recordFailure(model.provider);
      throw err;
    }
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
      max_tokens: request.maxTokens ?? 8192,
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

    const response = await client.messages.create({
      model: model.id,
      max_tokens: request.maxTokens ?? 8192,
      system,
      messages: messages.map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
    });

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
