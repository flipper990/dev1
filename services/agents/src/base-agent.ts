import type {
  AgentRole,
  LLMRequest,
  LLMResponse,
  MemoryEntry,
  MemoryQuery,
} from '@devteam/core';
import { Logger, generateId, now } from '@devteam/core';

// ─── Memory adapter interface ─────────────────────────────────────────────────

export interface AgentMemoryAdapter {
  store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>;
  retrieve(query: MemoryQuery): Promise<MemoryEntry[]>;
}

// ─── LLM adapter interface ────────────────────────────────────────────────────

export interface AgentLLMAdapter {
  complete(request: LLMRequest): Promise<LLMResponse>;
}

// ─── Agent context passed to each run ────────────────────────────────────────

export interface AgentContext {
  sessionId: string;
  projectId: string;
  memory: AgentMemoryAdapter;
  llm: AgentLLMAdapter;
}

// ─── Agent run result ─────────────────────────────────────────────────────────

export interface AgentResult<TOutput = unknown> {
  output: TOutput;
  reasoning?: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  memoryIds: string[];
}

// ─── Base Agent ───────────────────────────────────────────────────────────────

export abstract class BaseAgent<TInput = unknown, TOutput = unknown> {
  readonly role: AgentRole;
  protected readonly logger: Logger;
  private readonly systemPrompt: string;

  constructor(role: AgentRole, systemPrompt: string) {
    this.role = role;
    this.systemPrompt = systemPrompt;
    this.logger = new Logger(`agent:${role}`);
  }

  // ── Public entry point ───────────────────────────────────────────────────

  async run(input: TInput, ctx: AgentContext): Promise<AgentResult<TOutput>> {
    const startedAt = Date.now();
    this.logger.info('Starting', { sessionId: ctx.sessionId });

    // Augment input with relevant memories
    const memories = await this.recallMemories(input, ctx);

    // Build and execute LLM request
    const prompt = this.buildPrompt(input, memories);
    const response = await ctx.llm.complete({
      messages: [
        { role: 'system', content: this.systemPrompt },
        { role: 'user', content: prompt },
      ],
      agentRole: this.role,
    });

    // Parse and validate output
    const output = this.parseOutput(response.content);

    // Store result in memory
    const memoryIds = await this.storeMemories(input, output, ctx);

    const durationMs = Date.now() - startedAt;
    this.logger.info('Completed', {
      sessionId: ctx.sessionId,
      durationMs,
      tokens: response.inputTokens + response.outputTokens,
      costUsd: response.costUsd,
    });

    return {
      output,
      inputTokens: response.inputTokens,
      outputTokens: response.outputTokens,
      costUsd: response.costUsd,
      durationMs,
      memoryIds,
    };
  }

  // ── Abstract: subclasses implement these ────────────────────────────────

  protected abstract buildPrompt(input: TInput, memories: MemoryEntry[]): string;
  protected abstract parseOutput(rawContent: string): TOutput;

  // ── Optional hooks ───────────────────────────────────────────────────────

  protected async recallMemories(
    _input: TInput,
    ctx: AgentContext,
  ): Promise<MemoryEntry[]> {
    return ctx.memory.retrieve({
      agentRole: this.role,
      sessionId: ctx.sessionId,
      limit: 5,
    });
  }

  protected async storeMemories(
    _input: TInput,
    output: TOutput,
    ctx: AgentContext,
  ): Promise<string[]> {
    const entry = await ctx.memory.store({
      agentRole: this.role,
      sessionId: ctx.sessionId,
      projectId: ctx.projectId,
      content: JSON.stringify(output),
      tags: [this.role, ctx.sessionId],
    });
    return [entry.id];
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  protected extractJson<T>(text: string): T {
    // Try direct parse first
    const trimmed = text.trim();
    try {
      return JSON.parse(trimmed) as T;
    } catch { /* fall through */ }

    // Try to extract from ```json ... ``` block
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) {
      return JSON.parse(fenced[1].trim()) as T;
    }

    // Try first { ... } block
    const braceStart = trimmed.indexOf('{');
    const braceEnd = trimmed.lastIndexOf('}');
    if (braceStart !== -1 && braceEnd > braceStart) {
      return JSON.parse(trimmed.slice(braceStart, braceEnd + 1)) as T;
    }

    throw new Error(`Cannot extract JSON from response: ${trimmed.slice(0, 200)}`);
  }
}
