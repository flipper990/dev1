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
  /** Override in subclass to increase the LLM output budget for large responses. */
  protected readonly maxOutputTokens: number = 8192;

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
      maxTokens: this.maxOutputTokens,
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
    const trimmed = text.trim();

    // 1. Direct parse
    try { return JSON.parse(trimmed) as T; } catch { /* fall through */ }

    // 2. Fenced code block: ```json ... ```
    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) {
      try { return JSON.parse(fenced[1].trim()) as T; } catch { /* fall through */ }
    }

    // 3. Partial fenced block (truncated — no closing ```)
    const partialFence = trimmed.match(/```(?:json)?\s*([\s\S]*)$/);
    if (partialFence?.[1]) {
      const candidate = partialFence[1].trim();
      const repaired = this._repairJson(candidate);
      if (repaired !== null) return repaired as T;
    }

    // 4. First complete { ... } or [ ... ] block
    const objStart = trimmed.indexOf('{');
    const objEnd   = trimmed.lastIndexOf('}');
    if (objStart !== -1 && objEnd > objStart) {
      try { return JSON.parse(trimmed.slice(objStart, objEnd + 1)) as T; } catch { /* fall through */ }
    }

    const arrStart = trimmed.indexOf('[');
    const arrEnd   = trimmed.lastIndexOf(']');
    if (arrStart !== -1 && arrEnd > arrStart) {
      try { return JSON.parse(trimmed.slice(arrStart, arrEnd + 1)) as T; } catch { /* fall through */ }
    }

    // 5. Truncated JSON — attempt repair
    const repaired = this._repairJson(trimmed);
    if (repaired !== null) return repaired as T;

    throw new Error(`Cannot extract JSON from LLM response: ${trimmed.slice(0, 300)}`);
  }

  /**
   * Attempt to close a truncated JSON string by tracking bracket/brace depth.
   * Returns parsed value on success, null on failure.
   */
  private _repairJson(text: string): unknown {
    // Find the outermost opening delimiter
    const firstBrace  = text.indexOf('{');
    const firstBracket = text.indexOf('[');
    if (firstBrace === -1 && firstBracket === -1) return null;

    let start: number;
    let closeChar: string;
    if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) {
      start = firstBrace;  closeChar = '}';
    } else {
      start = firstBracket; closeChar = ']';
    }

    let fragment = text.slice(start);

    // Remove trailing incomplete token (unfinished string, key, or value)
    fragment = fragment
      .replace(/,\s*$/, '')                    // trailing comma
      .replace(/[,:]\s*"[^"]*$/, '')          // trailing incomplete string value
      .replace(/:\s*[\w.+-]*$/, '')            // trailing incomplete number/bool
      .replace(/,\s*"[^"]*$/, '')             // trailing incomplete key
      .trim();

    // Close any open arrays/objects
    const stack: string[] = [];
    let inString = false;
    let escape = false;
    for (const ch of fragment) {
      if (escape) { escape = false; continue; }
      if (ch === '\\' && inString) { escape = true; continue; }
      if (ch === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }

    // If still inside a string at end of fragment, close it before closing brackets
    const closing = (inString ? '"' : '') + stack.reverse().join('');
    try { return JSON.parse(fragment + closing); } catch { return null; }
  }
}
