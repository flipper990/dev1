// Base Agent — Abstract class all agents extend.
// Interfaces  -> ./agent-contracts.ts
// Memory ops  -> ./agent-memory-ops.ts
// Utilities   -> ./agent-utils.ts

import type {
  AgentDefinition,
  AgentHooks,
  AgentMiddleware,
  AgentRole,
  AgentStatus,
  ExecutionContext,
  MemoryEntry,
  PromptConfig,
  Task,
  TaskMetadata,
} from './types';
import type { AgentConfig, LLMClient, Logger, MemoryStore, MessageBus } from './agent-contracts';
import { loadMemories, saveMemories, formatMemoriesForPrompt as formatMemoriesOp } from './agent-memory-ops';
import { classifyError, estimateCost, truncate } from './agent-utils';

// Re-export interfaces so existing consumers importing from base-agent still work.
export type { LLMClient, MemoryEntryInput, MemoryStore, MessageBus, Logger, AgentConfig } from './agent-contracts';

export abstract class BaseAgent {
  protected definition: AgentDefinition;
  protected llm: LLMClient;
  protected memory: MemoryStore;
  protected bus: MessageBus;
  protected logger: Logger;
  protected status: AgentStatus = 'idle';
  protected hooks: AgentHooks;

  private middlewareStack: AgentMiddleware[];
  private promptConfig: Partial<PromptConfig>;
  private logIO: boolean;
  private logIOMaxLength: number;

  private _executionCount  = 0;
  private _successCount    = 0;
  private _failureCount    = 0;
  private _retryCount      = 0;
  private _totalTokensIn   = 0;
  private _totalTokensOut  = 0;
  private _totalCostUsd    = 0;
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

  /** Execute through middleware → hooks → memory → LLM → parse → validate → save. */
  async execute(task: Task, context?: ExecutionContext): Promise<Task> {
    const ctx = context ?? this.createDefaultContext(task);
    return this.buildMiddlewareChain(ctx, task, () => this.coreExecute(task, ctx))();
  }

  /** Core execution without middleware (also useful for standalone testing). */
  async coreExecute(task: Task, ctx: ExecutionContext): Promise<Task> {
    this.status = 'busy';
    this._executionCount++;
    this._lastExecutedAt = new Date();
    const start = Date.now();

    try {
      if (this.hooks.beforeExecute) task = await this.hooks.beforeExecute(ctx, task);

      if (this.logIO) {
        this.logger.info(`[${this.definition.role}] INPUT`, {
          traceId: ctx.traceId, spanId: ctx.spanId, taskId: task.id,
          inputKeys: Object.keys(task.input),
          inputSummary: truncate(JSON.stringify(task.input), this.logIOMaxLength),
        });
      }

      const memories = await loadMemories(task, this.definition, this.memory, this.logger);
      this._lastLoadedMemories = memories;
      this.logger.debug(`[${this.definition.role}] Loaded ${memories.length} memories`, {
        traceId: ctx.traceId,
        shortTerm: memories.filter(m => m.sessionId).length,
        longTerm: memories.filter(m => !m.sessionId).length,
      });

      let prompt = await this.buildPrompt(task, memories);
      prompt = this.applyTemplateVars(prompt, ctx);
      if (this.hooks.beforePrompt) prompt = await this.hooks.beforePrompt(ctx, prompt);

      const systemPrompt = this.resolveSystemPrompt(ctx);
      // Allow callers (e.g. BuilderAgent's phased mode + token budget) to
      // tighten maxTokens for THIS call only, without mutating the agent's
      // base model definition. Override is read from ctx.variables.
      const baseModel = this.definition.model;
      const override = (ctx.variables?.modelOverride ?? null) as
        | { maxTokens?: number; temperature?: number }
        | null;
      const model = override
        ? {
            ...baseModel,
            ...(typeof override.maxTokens === 'number' ? { maxTokens: override.maxTokens } : {}),
            ...(typeof override.temperature === 'number' ? { temperature: override.temperature } : {}),
          }
        : baseModel;
      this.logger.debug(`[${this.definition.role}] Calling LLM`, {
        traceId: ctx.traceId, model: model.model, provider: model.provider,
        promptLength: prompt.length, maxTokens: model.maxTokens,
        overridden: override !== null,
      });

      const result = await this.llm.chatSync({
        model,
        system: systemPrompt,
        messages: [{ role: 'user', content: prompt }],
        metadata: {
          projectId: typeof ctx.variables?.projectId === 'string' ? ctx.variables.projectId : undefined,
          sessionId: ctx.sessionId,
          traceId: ctx.traceId,
          agentRole: this.definition.role,
          phase: typeof ctx.variables?.generationPhase === 'string' ? ctx.variables.generationPhase : undefined,
          step: typeof ctx.variables?.generationStep === 'string' ? ctx.variables.generationStep : undefined,
        },
      });

      this.logger.debug(`[${this.definition.role}] LLM responded`, {
        traceId: ctx.traceId, tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        responseLength: result.content.length,
      });

      let output = await this.parseOutput(result.content, task);
      if (this.hooks.afterParse) output = await this.hooks.afterParse(ctx, output);
      await this.validateOutput(output, task);
      await saveMemories(task, output, this.definition, this.memory, this.logger, this.extractLearnings.bind(this));

      const latencyMs = Date.now() - start;
      const costUsd   = typeof result.costUsd === 'number'
        ? result.costUsd
        : estimateCost(model, result.tokensIn, result.tokensOut);
      task.output    = output;
      task.status    = 'completed';
      task.completedAt = new Date();
      task.metadata  = {
        model: result.model ?? model.model, provider: result.provider ?? model.provider,
        tokensIn: result.tokensIn, tokensOut: result.tokensOut,
        latencyMs, costUsd, memoryEntriesUsed: memories.length,
      };

      this._successCount++;
      this._totalTokensIn  += result.tokensIn;
      this._totalTokensOut += result.tokensOut;
      this._totalCostUsd   += costUsd;
      this._latencies.push(latencyMs);

      if (this.logIO) {
        this.logger.info(`[${this.definition.role}] OUTPUT`, {
          traceId: ctx.traceId, spanId: ctx.spanId, taskId: task.id,
          status: 'completed', latencyMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut,
          costUsd: costUsd.toFixed(4),
          outputKeys: output ? Object.keys(output) : [],
          outputSummary: truncate(JSON.stringify(output), this.logIOMaxLength),
        });
      }

      if (this.hooks.afterExecute) task = await this.hooks.afterExecute(ctx, task);
      this.status = 'idle';
      return task;

    } catch (err) {
      this.status = 'error';
      const error  = err as Error;
      task.status  = 'failed';
      task.error   = classifyError(error);
      task.metadata = { ...task.metadata, latencyMs: Date.now() - start } as TaskMetadata;

      this._failureCount++;
      this._errorsByCode[task.error.code] = (this._errorsByCode[task.error.code] ?? 0) + 1;
      this.logger.error(`[${this.definition.role}] FAILED`, {
        traceId: ctx.traceId, spanId: ctx.spanId, taskId: task.id,
        error: error.message, code: task.error.code, retryable: task.error.retryable,
        latencyMs: Date.now() - start,
      });

      if (this.hooks.onError) await this.hooks.onError(ctx, task, error);
      return task;
    }
  }

  // ── Status & Introspection ──────────────────────────────────────

  getStatus(): AgentStatus  { return this.status; }
  getRole(): AgentRole      { return this.definition.role; }
  getDefinition(): AgentDefinition { return this.definition; }

  getMetricsSnapshot() {
    return {
      agentRole:       this.definition.role,
      totalExecutions: this._executionCount,
      successCount:    this._successCount,
      failureCount:    this._failureCount,
      retryCount:      this._retryCount,
      totalTokensIn:   this._totalTokensIn,
      totalTokensOut:  this._totalTokensOut,
      totalCostUsd:    this._totalCostUsd,
      latencies:       [...this._latencies],
      lastExecutedAt:  this._lastExecutedAt,
      errorsByCode:    { ...this._errorsByCode },
    };
  }

  recordRetry(): void { this._retryCount++; }

  // ── Middleware & Hooks ─────────────────────────────────────────

  use(middleware: AgentMiddleware): this {
    this.middlewareStack.push(middleware);
    this.middlewareStack.sort((a, b) => a.order - b.order);
    return this;
  }

  setHooks(hooks: Partial<AgentHooks>): this {
    this.hooks = { ...this.hooks, ...hooks };
    return this;
  }

  setPromptOverrides(overrides: Partial<PromptConfig>): this {
    this.promptConfig = { ...this.promptConfig, ...overrides };
    return this;
  }

  // ── Abstract Methods ────────────────────────────────────────────

  protected abstract buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string>;
  protected abstract parseOutput(raw: string, task: Task): Promise<Record<string, unknown>>;
  protected abstract validateOutput(output: Record<string, unknown>, task: Task): Promise<void>;
  protected abstract extractLearnings(task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]>;

  // ── Protected Helpers ───────────────────────────────────────────

  protected formatMemoriesForPrompt(memories: MemoryEntry[]): string {
    return formatMemoriesOp(memories);
  }

  // ── Private Helpers ─────────────────────────────────────────────

  private buildMiddlewareChain(
    ctx: ExecutionContext,
    task: Task,
    core: () => Promise<Task>,
  ): () => Promise<Task> {
    let chain = core;
    for (let i = this.middlewareStack.length - 1; i >= 0; i--) {
      const mw = this.middlewareStack[i];
      const next = chain;
      chain = () => mw.fn(ctx, task, next);
    }
    return chain;
  }

  private createDefaultContext(task: Task): ExecutionContext {
    return {
      traceId:   task.sessionId,
      spanId:    `${task.agentRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      sessionId: task.sessionId,
      agentRole: this.definition.role,
      attempt:   task.attempt,
      startedAt: new Date(),
      variables: {},
    };
  }

  private resolveSystemPrompt(ctx: ExecutionContext): string {
    if (ctx.promptOverrides?.systemPrompt) return ctx.promptOverrides.systemPrompt;
    if (this.promptConfig.systemPrompt)   return this.promptConfig.systemPrompt;
    return this.definition.systemPrompt;
  }

  private applyTemplateVars(prompt: string, ctx: ExecutionContext): string {
    const vars: Record<string, string> = {
      ...this.promptConfig.templateVars,
      ...ctx.promptOverrides?.templateVars,
      AGENT_ROLE:  this.definition.role,
      AGENT_NAME:  this.definition.name,
      SESSION_ID:  ctx.sessionId,
      TRACE_ID:    ctx.traceId,
      ATTEMPT:     String(ctx.attempt),
    };
    return prompt.replace(/\{\{(\w+)\}\}/g, (match, key) => key in vars ? vars[key] : match);
  }
}
