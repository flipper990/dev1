// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Anthropic Claude provider client
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import Anthropic from '@anthropic-ai/sdk';
import type { LLMProvider } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { LLMProviderClient, LLMRequestParams, LLMResponse } from './types.js';

/** Hard upper bound on a single Anthropic HTTP call (matches OpenAI client). */
const ANTHROPIC_REQUEST_TIMEOUT_MS = 180_000;
const ANTHROPIC_SDK_MAX_RETRIES = 2;

export class AnthropicClient implements LLMProviderClient {
  readonly providerId: LLMProvider = 'anthropic';
  readonly displayName = 'Anthropic Claude';

  private client: Anthropic;
  private logger: Logger;

  constructor(apiKey: string, logger: Logger) {
    this.client = new Anthropic({
      apiKey,
      timeout: ANTHROPIC_REQUEST_TIMEOUT_MS,
      maxRetries: ANTHROPIC_SDK_MAX_RETRIES,
    });
    this.logger = logger;
  }

  async chatSync(params: LLMRequestParams): Promise<LLMResponse> {
    const { model, system, messages } = params;

    this.logger.debug(`Anthropic call: ${model.model}`, {
      messagesCount: messages.length,
      maxTokens: model.maxTokens,
    });

    const response = await this.client.messages.create(
      {
        model: model.model,
        max_tokens: model.maxTokens,
        temperature: model.temperature,
        system,
        messages: messages.map(m => ({
          role: m.role,
          content: m.content,
        })),
      },
      { timeout: ANTHROPIC_REQUEST_TIMEOUT_MS },
    );

    const textBlock = response.content.find(b => b.type === 'text');
    const content = textBlock?.type === 'text' ? textBlock.text : '';

    return {
      content,
      tokensIn: response.usage.input_tokens,
      tokensOut: response.usage.output_tokens,
    };
  }

  async *chatStream(params: LLMRequestParams): AsyncGenerator<string, void, unknown> {
    const { model, system, messages } = params;

    const stream = this.client.messages.stream({
      model: model.model,
      max_tokens: model.maxTokens,
      temperature: model.temperature,
      system,
      messages: messages.map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
    });

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        yield event.delta.text;
      }
    }
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.client.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      });
      return true;
    } catch {
      return false;
    }
  }
}
