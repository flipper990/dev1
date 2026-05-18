// ─────────────────────────────────────────────────────────────
// Azure OpenAI provider client
//
// Routes between two Azure REST surfaces depending on the model:
//
//  • Chat Completions  (gpt-4.1, gpt-4o, gpt-3.5, …)
//      {endpoint}/openai/deployments/{deployment}/chat/completions
//
//  • Responses API     (gpt-5*, codex*, o1*, o3*, reasoning models)
//      {endpoint}/openai/v1/responses?api-version=preview
//      These deployments REJECT chat.completions with
//      "The requested operation is unsupported."
//
// In Azure, the `model` parameter is the *deployment name*. We keep
// the same MODEL_<ROLE> env semantics — value = Azure deployment.
// ─────────────────────────────────────────────────────────────

import { AzureOpenAI } from 'openai';
import type { LLMProvider } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { LLMProviderClient, LLMRequestParams, LLMResponse } from './types.js';

const AZURE_REQUEST_TIMEOUT_MS = 180_000;
const AZURE_SDK_MAX_RETRIES = 2;

/**
 * Models that require the Responses API instead of Chat Completions.
 * Matches: gpt-5*, codex*, o1*, o3*, *-codex, *-reasoning
 */
const RESPONSES_API_PATTERN = /(^|[/_-])(gpt-5|codex|o1|o3)(\b|[._-])|-codex\b|-reasoning\b/i;

function needsResponsesApi(deployment: string): boolean {
  return RESPONSES_API_PATTERN.test(deployment);
}

export interface AzureOpenAIClientOptions {
  apiKey: string;
  endpoint: string;
  apiVersion: string;
  /** Optional deployment used for healthCheck only. */
  healthCheckDeployment?: string;
}

export class AzureOpenAIClient implements LLMProviderClient {
  readonly providerId: LLMProvider = 'azure';
  readonly displayName = 'Azure OpenAI';

  private client: AzureOpenAI;
  private logger: Logger;
  private healthCheckDeployment?: string;
  /** Stored for raw Responses API calls (SDK URL shape doesn't match Azure v1). */
  private readonly apiKey: string;
  private readonly endpoint: string;

  constructor(opts: AzureOpenAIClientOptions, logger: Logger) {
    // Some environments export OPENAI_BASE_URL for non-Azure usage.
    // The OpenAI SDK treats baseURL + endpoint as mutually exclusive and
    // throws during AzureOpenAI construction. We isolate Azure client init
    // from that global by temporarily clearing OPENAI_BASE_URL.
    const originalBaseUrl = process.env.OPENAI_BASE_URL;
    try {
      if (process.env.OPENAI_BASE_URL) {
        delete process.env.OPENAI_BASE_URL;
      }
      this.client = new AzureOpenAI({
        apiKey: opts.apiKey,
        endpoint: opts.endpoint,
        apiVersion: opts.apiVersion,
        timeout: AZURE_REQUEST_TIMEOUT_MS,
        maxRetries: AZURE_SDK_MAX_RETRIES,
      });
    } finally {
      if (originalBaseUrl !== undefined) {
        process.env.OPENAI_BASE_URL = originalBaseUrl;
      }
    }
    this.apiKey = opts.apiKey;
    this.endpoint = opts.endpoint.replace(/\/+$/, '');
    this.logger = logger;
    this.healthCheckDeployment = opts.healthCheckDeployment;
  }

  async chatSync(params: LLMRequestParams): Promise<LLMResponse> {
    const { model, system, messages } = params;

    if (needsResponsesApi(model.model)) {
      return this.responsesSync(params);
    }

    this.logger.debug(`Azure OpenAI chat.completions: ${model.model}`, {
      messagesCount: messages.length,
      maxTokens: model.maxTokens,
    });

    const response = await this.client.chat.completions.create(
      {
        // In Azure, `model` is the deployment name.
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
      },
      { timeout: AZURE_REQUEST_TIMEOUT_MS },
    );

    const content = response.choices[0]?.message?.content ?? '';

    return {
      content,
      tokensIn: response.usage?.prompt_tokens ?? 0,
      tokensOut: response.usage?.completion_tokens ?? 0,
    };
  }

  /**
   * Responses API path — for codex / gpt-5 / o-series reasoning models.
   * Azure rejects these on chat.completions with "operation unsupported".
   *
   * NOTE: We bypass the OpenAI SDK here because its AzureOpenAI client
   * routes responses.create through the deployment-scoped URL
   *   /openai/deployments/{deployment}/responses
   * which Azure returns 404 for. The working URL (verified via REST) is
   *   /openai/v1/responses?api-version=preview
   * with deployment passed as the `model` field.
   */
  private async responsesSync(params: LLMRequestParams): Promise<LLMResponse> {
    const { model, system, messages } = params;

    this.logger.debug(`Azure OpenAI responses: ${model.model}`, {
      messagesCount: messages.length,
      maxTokens: model.maxTokens,
    });

    const input = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: model.model,
      instructions: system,
      input,
      max_output_tokens: model.maxTokens,
    };
    if (model.temperature != null) body.temperature = model.temperature;

    const url = `${this.endpoint}/openai/v1/responses?api-version=preview`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), AZURE_REQUEST_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Azure Responses API ${res.status}: ${text || res.statusText}`);
    }

    const json = await res.json() as {
      output?: Array<{ content?: Array<{ type?: string; text?: string }> }>;
      output_text?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };

    let content = json.output_text ?? '';
    if (!content && Array.isArray(json.output)) {
      content = json.output
        .flatMap(o => (o.content ?? []))
        .filter(c => c.type === 'output_text' && typeof c.text === 'string')
        .map(c => c.text as string)
        .join('');
    }

    return {
      content,
      tokensIn: json.usage?.input_tokens ?? 0,
      tokensOut: json.usage?.output_tokens ?? 0,
    };
  }

  async *chatStream(params: LLMRequestParams): AsyncGenerator<string, void, unknown> {
    const { model, system, messages } = params;

    if (needsResponsesApi(model.model)) {
      yield* this.responsesStream(params);
      return;
    }

    const stream = await this.client.chat.completions.create(
      {
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
      },
      { timeout: AZURE_REQUEST_TIMEOUT_MS },
    );

    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) {
        yield delta;
      }
    }
  }

  /**
   * Responses API streaming via raw SSE. Yields output_text deltas only.
   */
  private async *responsesStream(params: LLMRequestParams): AsyncGenerator<string, void, unknown> {
    const { model, system, messages } = params;

    const input = messages.map(m => ({
      role: m.role as 'user' | 'assistant',
      content: m.content,
    }));

    const body: Record<string, unknown> = {
      model: model.model,
      instructions: system,
      input,
      max_output_tokens: model.maxTokens,
      stream: true,
    };
    if (model.temperature != null) body.temperature = model.temperature;

    const url = `${this.endpoint}/openai/v1/responses?api-version=preview`;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), AZURE_REQUEST_TIMEOUT_MS);

    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'api-key': this.apiKey,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(body),
        signal: ac.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text().catch(() => '');
        throw new Error(`Azure Responses API stream ${res.status}: ${text || res.statusText}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // SSE: events separated by blank line; each event has lines like
        //   event: response.output_text.delta
        //   data: { ...json... }
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) !== -1) {
          const rawEvent = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const dataLine = rawEvent.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          const payload = dataLine.slice(5).trim();
          if (!payload || payload === '[DONE]') continue;
          try {
            const evt = JSON.parse(payload) as { type?: string; delta?: string };
            if (evt.type === 'response.output_text.delta' && typeof evt.delta === 'string') {
              yield evt.delta;
            }
          } catch {
            /* skip malformed event */
          }
        }
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async healthCheck(): Promise<boolean> {
    if (!this.healthCheckDeployment) return true;
    try {
      if (needsResponsesApi(this.healthCheckDeployment)) {
        await this.responsesSync({
          model: { provider: 'azure', model: this.healthCheckDeployment, maxTokens: 16, temperature: 0 },
          system: '',
          messages: [{ role: 'user', content: 'ping' }],
        });
      } else {
        await this.client.chat.completions.create({
          model: this.healthCheckDeployment,
          max_tokens: 1,
          messages: [{ role: 'user', content: 'ping' }],
        });
      }
      return true;
    } catch {
      return false;
    }
  }
}
