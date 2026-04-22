// ─────────────────────────────────────────────────────────────
// Base Agent — Abstract class all agents extend
// Production-ready with lifecycle hooks, I/O logging,
// middleware support, configurable prompts, and metrics.
// ─────────────────────────────────────────────────────────────

import type {
  AgentDefinition,
  AgentHooks,
  AgentMessage,
  AgentMiddleware,
  AgentMiddlewareFn,
  AgentRole,
  AgentStatus,
  ExecutionContext,
  MemoryEntry,
  MemoryQuery,
  MemoryType,
  ModelConfig,
  PromptConfig,
  Task,
  TaskError,
  TaskMetadata,
} from './types';

// ── External Service Interfaces ─────────────────────────────

export interface LLMClient {
  chat(params: {
    model: ModelConfig;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    stream?: boolean;
  }): AsyncGenerator<string, void, unknown>;

  chatSync(params: {
    model: ModelConfig;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{ content: string; tokensIn: number; tokensOut: number }>;
}

export type MemoryEntryInput = Omit<MemoryEntry, 'id' | 'createdAt' | 'lastAccessed' | 'accessCount' | 'successCount' | 'failureCount' | 'effectiveness'>;

export interface MemoryStore {
  // ── Short-term (session-scoped) ──
  getShortTerm(sessionId: string, agentRole: AgentRole, limit: number): Promise<MemoryEntry[]>;
  setShortTerm(sessionId: string, entry: MemoryEntryInput): Promise<void>;

  // ── Long-term (persistent) ──
  queryLongTerm(agentRole: AgentRole, embedding: number[], limit: number): Promise<MemoryEntry[]>;
  saveLongTerm(entry: MemoryEntryInput): Promise<void>;

  // ── Advanced query (filter by type, tags, effectiveness) ──
  query(query: MemoryQuery): Promise<MemoryEntry[]>;

  // ── Global shared memory ──
  getGlobal(query: MemoryQuery): Promise<MemoryEntry[]>;
  saveGlobal(entry: MemoryEntryInput): Promise<void>;

  // ── Feedback loop ──
  recordOutcome(entryId: string, success: boolean): Promise<void>;

  // ── Embedding ──
  embed(text: string): Promise<number[]>;
}

export interface MessageBus {
  publish(message: AgentMessage): Promise<void>;
  subscribe(agentRole: AgentRole, handler: (msg: AgentMessage) => Promise<void>): void;
  unsubscribe(agentRole: AgentRole): void;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

// ── Agent Configuration (passed at construction) ────────────

export interface AgentConfig {
  hooks?: AgentHooks;
  middleware?: AgentMiddleware[];
  promptOverrides?: Partial<PromptConfig>;
  logIO?: boolean;               // log full inputs/outputs (default: true)
  logIOMaxLength?: number;       // truncate I/O in logs (default: 2000)
}

// ─────────────────────────────────────────────────────────────

export abstract class BaseAgent {
  /** Long-term memory types worth semantic retrieval (excludes raw 'context' dumps). */
  private static readonly RETRIEVABLE_TYPES: MemoryType[] = [
    'pattern', 'failure', 'error_fix', 'decision', 'preference', 'prompt',
  ];

  protected definition: AgentDefinition;
  protected llm: LLMClient;
  protected memory: MemoryStore;
  protected bus: MessageBus;
  protected logger: Logger;
  protected status: AgentStatus = 'idle';

  // Extensibility
  protected hooks: AgentHooks;
  private middlewareStack: AgentMiddleware[];
  private promptConfig: Partial<PromptConfig>;
  private logIO: boolean;
  private logIOMaxLength: number;

  // Runtime metrics (consumed by AgentMetrics collector)
  private _executionCount = 0;
  private _successCount = 0;
  private _failureCount = 0;
  private _retryCount = 0;
  private _totalTokensIn = 0;
  private _totalTokensOut = 0;
  private _totalCostUsd = 0;
  private _latencies: number[] = [];
  private _errorsByCode: Record<string, number> = {};
  private _lastExecutedAt?: Date;

  /** The memories loaded during the most recent execute() call. Exposed for hooks. */
  public _lastLoadedMemories: MemoryEntry[] = [];

  constructor(
    definition: AgentDefinition,
    llm: LLMClient,
    memory: MemoryStore,
    bus: MessageBus,
    logger: Logger,
    config?: AgentConfig,
  ) {
    this.definition = definition;
    this.llm = llm;
    this.memory = memory;
    this.bus = bus;
    this.logger = logger;

    this.hooks = config?.hooks ?? {};
    this.middlewareStack = [...(config?.middleware ?? [])].sort((a, b) => a.order - b.order);
    this.promptConfig = config?.promptOverrides ?? {};
    this.logIO = config?.logIO ?? true;
    this.logIOMaxLength = config?.logIOMaxLength ?? 2000;
  }

  // ── Public API ──────────────────────────────────────────

  /**
   * Execute a task through the full pipeline:
   * middleware → hooks → memories → prompt → LLM → parse → validate → save
   */
  async execute(task: Task, context?: ExecutionContext): Promise<Task> {
    const ctx = context ?? this.createDefaultContext(task);

    // Build the middleware chain wrapping the core execution
    const coreExecution = () => this.coreExecute(task, ctx);
    const chain = this.buildMiddlewareChain(ctx, task, coreExecution);

    return chain();
  }

  /** Execute without middleware (used internally, also testable standalone) */
  async coreExecute(task: Task, ctx: ExecutionContext): Promise<Task> {
    this.status = 'busy';
    this._executionCount++;
    this._lastExecutedAt = new Date();
    const start = Date.now();

    try {
      // Hook: beforeExecute
      if (this.hooks.beforeExecute) {
        task = await this.hooks.beforeExecute(ctx, task);
      }

      // Log input
      if (this.logIO) {
        this.logger.info(`[${this.definition.role}] INPUT`, {
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          taskId: task.id,
          inputKeys: Object.keys(task.input),
          inputSummary: this.truncate(JSON.stringify(task.input)),
        });
      }

      // 1. Load relevant memories
      const memories = await this.loadMemories(task);
      this._lastLoadedMemories = memories;
      this.logger.debug(`[${this.definition.role}] Loaded ${memories.length} memories`, {
        traceId: ctx.traceId,
        shortTerm: memories.filter(m => m.sessionId).length,
        longTerm: memories.filter(m => !m.sessionId).length,
      });

      // 2. Build the prompt with task input + memories
      let prompt = await this.buildPrompt(task, memories);

      // 3. Apply prompt template variables
      prompt = this.applyTemplateVars(prompt, ctx);

      // Hook: beforePrompt
      if (this.hooks.beforePrompt) {
        prompt = await this.hooks.beforePrompt(ctx, prompt);
      }

      // 4. Resolve system prompt (allow overrides)
      const systemPrompt = this.resolveSystemPrompt(ctx);

      // 5. Call the LLM
      const model = this.definition.model;
      this.logger.debug(`[${this.definition.role}] Calling LLM`, {
        traceId: ctx.traceId,
        model: model.model,
        provider: model.provider,
        promptLength: prompt.length,
      });

      const result = await this.llm.chatSync({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
      });

      this.logger.debug(`[${this.definition.role}] LLM responded`, {
        traceId: ctx.traceId,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        responseLength: result.content.length,
      });

      // 6. Parse the LLM output into structured data
      let output = await this.parseOutput(result.content, task);

      // Hook: afterParse
      if (this.hooks.afterParse) {
        output = await this.hooks.afterParse(ctx, output);
      }

      // 7. Validate the output
      await this.validateOutput(output, task);

      // 8. Save learnings to memory
      await this.saveMemories(task, output);

      // 9. Complete the task
      const latencyMs = Date.now() - start;
      task.output = output;
      task.status = 'completed';
      task.completedAt = new Date();
      task.metadata = {
        model: model.model,
        provider: model.provider,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        latencyMs,
        costUsd: this.estimateCost(model, result.tokensIn, result.tokensOut),
        memoryEntriesUsed: memories.length,
      };

      // Track metrics
      this._successCount++;
      this._totalTokensIn += result.tokensIn;
      this._totalTokensOut += result.tokensOut;
      this._totalCostUsd += task.metadata.costUsd;
      this._latencies.push(latencyMs);

      // Log output
      if (this.logIO) {
        this.logger.info(`[${this.definition.role}] OUTPUT`, {
          traceId: ctx.traceId,
          spanId: ctx.spanId,
          taskId: task.id,
          status: 'completed',
          latencyMs,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: task.metadata.costUsd.toFixed(4),
          outputKeys: output ? Object.keys(output) : [],
          outputSummary: this.truncate(JSON.stringify(output)),
        });
      }

      // Hook: afterExecute
      if (this.hooks.afterExecute) {
        task = await this.hooks.afterExecute(ctx, task);
      }

      this.status = 'idle';
      return task;
    } catch (err) {
      this.status = 'error';
      const error = err as Error;
      task.status = 'failed';
      task.error = this.classifyError(error);
      task.metadata = {
        ...task.metadata,
        latencyMs: Date.now() - start,
      } as TaskMetadata;

      // Track metrics
      this._failureCount++;
      this._errorsByCode[task.error.code] = (this._errorsByCode[task.error.code] ?? 0) + 1;

      this.logger.error(`[${this.definition.role}] FAILED`, {
        traceId: ctx.traceId,
        spanId: ctx.spanId,
        taskId: task.id,
        error: error.message,
        code: task.error.code,
        retryable: task.error.retryable,
        latencyMs: Date.now() - start,
      });

      // Hook: onError
      if (this.hooks.onError) {
        await this.hooks.onError(ctx, task, error);
      }

      return task;
    }
  }

  // ── Status & Introspection ─────────────────────────────

  getStatus(): AgentStatus { return this.status; }
  getRole(): AgentRole { return this.definition.role; }
  getDefinition(): AgentDefinition { return this.definition; }

  /** Get raw metrics for the metrics collector */
  getMetricsSnapshot() {
    return {
      agentRole: this.definition.role,
      totalExecutions: this._executionCount,
      successCount: this._successCount,
      failureCount: this._failureCount,
      retryCount: this._retryCount,
      totalTokensIn: this._totalTokensIn,
      totalTokensOut: this._totalTokensOut,
      totalCostUsd: this._totalCostUsd,
      latencies: [...this._latencies],
      lastExecutedAt: this._lastExecutedAt,
      errorsByCode: { ...this._errorsByCode },
    };
  }

  /** Increment retry counter (called by runner/orchestrator) */
  recordRetry(): void { this._retryCount++; }

  // ── Middleware Management ───────────────────────────────

  /** Add middleware at runtime */
  use(middleware: AgentMiddleware): this {
    this.middlewareStack.push(middleware);
    this.middlewareStack.sort((a, b) => a.order - b.order);
    return this;
  }

  /** Set lifecycle hooks at runtime */
  setHooks(hooks: Partial<AgentHooks>): this {
    this.hooks = { ...this.hooks, ...hooks };
    return this;
  }

  /** Override prompt configuration at runtime */
  setPromptOverrides(overrides: Partial<PromptConfig>): this {
    this.promptConfig = { ...this.promptConfig, ...overrides };
    return this;
  }

  // ── Abstract Methods (each agent implements these) ─────

  /** Build the user-facing prompt from task input and memories */
  protected abstract buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string>;

  /** Parse raw LLM text output into structured data */
  protected abstract parseOutput(raw: string, task: Task): Promise<Record<string, unknown>>;

  /** Validate the parsed output meets requirements */
  protected abstract validateOutput(output: Record<string, unknown>, task: Task): Promise<void>;

  /** Extract learnings to save to memory after successful execution */
  protected abstract extractLearnings(task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]>;

  // ── Private: Middleware Chain Builder ───────────────────

  private buildMiddlewareChain(
    ctx: ExecutionContext,
    task: Task,
    core: () => Promise<Task>,
  ): () => Promise<Task> {
    // Build chain from outside in: first middleware wraps second, etc.
    let chain = core;

    // Reverse iterate so the first middleware (lowest order) is outermost
    for (let i = this.middlewareStack.length - 1; i >= 0; i--) {
      const mw = this.middlewareStack[i];
      const next = chain;
      chain = () => mw.fn(ctx, task, next);
    }

    return chain;
  }

  // ── Private: Context Factory ───────────────────────────

  private createDefaultContext(task: Task): ExecutionContext {
    return {
      traceId: task.sessionId,
      spanId: `${task.agentRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: task.sessionId,
      agentRole: this.definition.role,
      attempt: task.attempt,
      startedAt: new Date(),
      variables: {},
    };
  }

  // ── Private: Prompt Resolution ─────────────────────────

  /** Resolve system prompt with overrides: context overrides > agent overrides > definition default */
  private resolveSystemPrompt(ctx: ExecutionContext): string {
    if (ctx.promptOverrides?.systemPrompt) return ctx.promptOverrides.systemPrompt;
    if (this.promptConfig.systemPrompt) return this.promptConfig.systemPrompt;
    return this.definition.systemPrompt;
  }

  /** Replace {{VAR_NAME}} template variables in prompt text */
  private applyTemplateVars(prompt: string, ctx: ExecutionContext): string {
    const vars: Record<string, string> = {
      ...this.promptConfig.templateVars,
      ...ctx.promptOverrides?.templateVars,
      AGENT_ROLE: this.definition.role,
      AGENT_NAME: this.definition.name,
      SESSION_ID: ctx.sessionId,
      TRACE_ID: ctx.traceId,
      ATTEMPT: String(ctx.attempt),
    };

    return prompt.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return key in vars ? vars[key] : match;
    });
  }

  // ── Private: Memory Operations ─────────────────────────

  private async loadMemories(task: Task): Promise<MemoryEntry[]> {
    const config = this.definition.memoryConfig;
    const all: MemoryEntry[] = [];

    // 1. Short-term session memory — same-session context, already agent-scoped
    if (config.shortTerm) {
      try {
        const shortTerm = await this.memory.getShortTerm(
          task.sessionId,
          this.definition.role,
          config.maxShortTermEntries,
        );
        all.push(...shortTerm);
      } catch (err) {
        this.logger.warn(`[${this.definition.role}] Failed to load short-term memory`, {
          error: (err as Error).message,
        });
      }
    }

    // 2. Long-term agent-specific knowledge.
    //    Uses memory.query() for type filtering + semantic search.
    //    Excludes raw 'context' dumps — only durable knowledge types.
    if (config.longTerm) {
      try {
        const taskDescription = JSON.stringify(task.input).slice(0, 800);
        const longTerm = await this.memory.query({
          roles: [this.definition.role],
          types: BaseAgent.RETRIEVABLE_TYPES,
          minRelevance: 0.2,
          limit: config.maxLongTermRetrievals,
          queryText: taskDescription,
        });
        all.push(...longTerm);
      } catch (err) {
        this.logger.warn(`[${this.definition.role}] Failed to load long-term memory`, {
          error: (err as Error).message,
        });
      }
    }

    // 3. Global shared knowledge — cross-agent best practices and proven fixes
    if (config.longTerm) {
      try {
        const globalMemories = await this.memory.getGlobal({
          types: ['pattern', 'error_fix', 'decision'],
          minRelevance: 0.3,
          minEffectiveness: 0.5,
          limit: 3,
          queryText: JSON.stringify(task.input).slice(0, 400),
        });
        all.push(...globalMemories);
      } catch (err) {
        this.logger.warn(`[${this.definition.role}] Failed to load global memory`, {
          error: (err as Error).message,
        });
      }
    }

    return this.applyMemoryBudget(all);
  }

  /**
   * Sort by composite score (relevance × effectiveness × recency), trim
   * entry content, and cap total chars injected into prompts.
   */
  private applyMemoryBudget(memories: MemoryEntry[]): MemoryEntry[] {
    const ENTRY_CAP    = 400;   // max chars per entry before truncation
    const TOTAL_BUDGET = 2500;  // max total chars across all entries

    const compositeScore = (e: MemoryEntry): number => {
      const eff = isNaN(e.effectiveness) ? 0.5 : Math.max(e.effectiveness, 0.1);
      const daysSince = (Date.now() - new Date(e.lastAccessed).getTime()) / 86_400_000;
      const recency = 1 / (1 + daysSince / 30); // halves every 30 days
      return e.relevanceScore * eff * recency;
    };

    const sorted = [...memories].sort((a, b) => compositeScore(b) - compositeScore(a));
    const result: MemoryEntry[] = [];
    let used = 0;

    for (const entry of sorted) {
      const trimmed = entry.content.length > ENTRY_CAP
        ? entry.content.slice(0, ENTRY_CAP - 1) + '\u2026'
        : entry.content;
      if (used + trimmed.length > TOTAL_BUDGET) break;
      result.push({ ...entry, content: trimmed });
      used += trimmed.length;
    }

    return result;
  }

  private async saveMemories(task: Task, output: Record<string, unknown>): Promise<void> {
    const config = this.definition.memoryConfig;

    // Always save short-term context
    if (config.shortTerm) {
      try {
        await this.memory.setShortTerm(task.sessionId, {
          agentRole: this.definition.role,
          type: 'context',
          content: this.summariseForShortTerm(task, output),
          relevanceScore: 1.0,
          sessionId: task.sessionId,
          tags: [],
          metadata: { taskId: task.id },
        });
      } catch (err) {
        this.logger.warn(`[${this.definition.role}] Failed to save short-term memory`, {
          error: (err as Error).message,
        });
      }
    }

    // Extract and save long-term learnings
    if (config.longTerm) {
      try {
        const learnings = await this.extractLearnings(task, output);
        for (const learning of learnings) {
          const embedding = await this.memory.embed(learning.content);
          await this.memory.saveLongTerm({ ...learning, embedding });

          // Promote high-effectiveness patterns to global memory
          if (
            (learning.type === 'pattern' || learning.type === 'error_fix') &&
            learning.relevanceScore > 1.3
          ) {
            await this.memory.saveGlobal({
              ...learning,
              agentRole: 'global',
              embedding,
              relevanceScore: learning.relevanceScore * 0.8, // slightly lower in global scope
              metadata: {
                ...learning.metadata,
                originAgent: this.definition.role,
                originTaskId: task.id,
              },
            });
          }
        }
      } catch (err) {
        this.logger.warn(`[${this.definition.role}] Failed to save long-term memory`, {
          error: (err as Error).message,
        });
      }
    }
  }

  // ── Memory Utilities ────────────────────────────────────

  /**
   * Format retrieved memories into a concise, grouped prompt block.
   * Entries proven effective (>70%) are marked with ★.
   * Returns an empty string when there are no memories.
   */
  protected formatMemoriesForPrompt(memories: MemoryEntry[]): string {
    if (memories.length === 0) return '';

    const TYPE_LABELS: Record<string, string> = {
      pattern:    'Proven Patterns',
      error_fix:  'Known Fixes',
      decision:   'Prior Decisions',
      failure:    'Past Failures',
      preference: 'Preferences',
      prompt:     'Prompt Strategies',
      context:    'Session Context',
      global:     'Shared Knowledge',
    };

    const grouped = new Map<string, MemoryEntry[]>();
    for (const m of memories) {
      const bucket = grouped.get(m.type) ?? [];
      bucket.push(m);
      grouped.set(m.type, bucket);
    }

    const lines: string[] = [`## Relevant Memory (${memories.length})\n`];
    for (const [type, entries] of grouped) {
      lines.push(`**${TYPE_LABELS[type] ?? type}:**`);
      for (const e of entries) {
        const star = !isNaN(e.effectiveness) && e.effectiveness > 0.7 ? ' \u2605' : '';
        lines.push(`- ${e.content}${star}`);
      }
    }

    return lines.join('\n') + '\n\n';
  }

  /**
   * Produce a compact, signal-rich summary of task output for short-term
   * storage. Avoids persisting raw code blobs or full object dumps.
   */
  private summariseForShortTerm(task: Task, output: Record<string, unknown>): string {
    const parts: string[] = [`${this.definition.role} completed.`];

    for (const [key, val] of Object.entries(output)) {
      if (Array.isArray(val)) {
        if (val.length === 0) continue;
        const items = val.slice(0, 4).map(v => {
          if (typeof v === 'string') return v.slice(0, 60);
          if (typeof v === 'object' && v !== null) {
            const o = v as Record<string, unknown>;
            return String(o.path ?? o.name ?? o.id ?? JSON.stringify(v).slice(0, 50));
          }
          return String(v);
        });
        parts.push(`${key}(${val.length}): [${items.join(', ')}${val.length > 4 ? ', \u2026' : ''}]`);
      } else if (typeof val === 'string' && val.length > 0) {
        parts.push(`${key}: ${val.slice(0, 120)}`);
      } else if (typeof val === 'object' && val !== null) {
        parts.push(`${key}: {${Object.keys(val as object).slice(0, 5).join(', ')}}`);
      }
    }

    return parts.join(' | ').slice(0, 500);
  }

  // ── Private: Error Classification ──────────────────────

  private classifyError(error: Error): TaskError {
    const message = error.message.toLowerCase();

    if (message.includes('rate limit') || message.includes('429')) {
      return { code: 'RATE_LIMITED', message: error.message, retryable: true };
    }
    if (message.includes('timeout') || message.includes('timed out')) {
      return { code: 'TIMEOUT', message: error.message, retryable: true };
    }
    if (message.includes('500') || message.includes('internal server')) {
      return { code: 'PROVIDER_ERROR', message: error.message, retryable: true };
    }
    if (message.includes('context length') || message.includes('too many tokens')) {
      return { code: 'TOKEN_OVERFLOW', message: error.message, retryable: false };
    }
    if (message.includes('parse') || message.includes('json')) {
      return { code: 'PARSE_ERROR', message: error.message, retryable: true };
    }
    if (message.includes('validation')) {
      return { code: 'VALIDATION_ERROR', message: error.message, retryable: true };
    }

    return { code: 'UNKNOWN', message: error.message, retryable: false };
  }

  // ── Private: Cost Estimation ───────────────────────────

  private estimateCost(model: ModelConfig, tokensIn: number, tokensOut: number): number {
    const pricing: Record<string, { input: number; output: number }> = {
      'claude-opus-4':   { input: 15.0, output: 75.0 },
      'claude-sonnet-4': { input: 3.0,  output: 15.0 },
      'claude-haiku-4':  { input: 0.80, output: 4.0 },
      'gpt-4o':            { input: 2.50, output: 10.0 },
      'gpt-4o-mini':       { input: 0.15, output: 0.60 },
      'gemini-2.0-pro':    { input: 1.25, output: 5.0 },
    };

    const price = pricing[model.model] ?? { input: 5.0, output: 15.0 };
    return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
  }

  // ── Private: Helpers ───────────────────────────────────

  private truncate(text: string): string {
    if (text.length <= this.logIOMaxLength) return text;
    return text.slice(0, this.logIOMaxLength) + `... (${text.length} chars total)`;
  }
}
