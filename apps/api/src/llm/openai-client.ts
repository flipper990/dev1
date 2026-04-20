// ─────────────────────────────────────────────────────────────
// OpenAI provider client
// ─────────────────────────────────────────────────────────────

import OpenAI from 'openai';
import type { LLMProvider } from '../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../packages/agent-core/src/base-agent.js';
import type { LLMProviderClient, LLMRequestParams, LLMResponse } from './types.js';

export class OpenAIClient implements LLMProviderClient {
  readonly providerId: LLMProvider = 'openai';
  readonly displayName = 'OpenAI';

  private client: OpenAI;
  private logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.client = new OpenAI({ apiKey });
    this.logger = logger;
  }

  async chatSync(params: LLMRequestParams): Promise<LLMResponse> {
    const { model, system, messages } = params;

    this.logger.debug(`OpenAI call: ${model.model}`, {
      messagesCount: messages.length,
      maxTokens: model.maxTokens,
    });

    const response = await this.client.chat.completions.create({
      model: model.model,
      max_tokens: model.maxTokens,
      temperature: model.temperature,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    const content = response.choices[0]?.message?.content ?? '';

    return {
      content,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    };
  }

  async *chatStream(params: LLMRequestParams): AsyncGenerator<string, void, unknown> {
    const { model, system, messages } = params;

    const stream = await this.client.chat.completions.create({
      model: model.model,
      max_tokens: model.maxTokens,
      temperature: model.temperature,
      stream: true,
      messages: [
        { role: 'system', content: system },
        ...messages.map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
      ],
    });

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.chat.completions.create({
        model: 'gpt-4o-mini',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
