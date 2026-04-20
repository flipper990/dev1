// ─────────────────────────────────────────────────────────────
// Core type definitions for the multi-agent system
// ─────────────────────────────────────────────────────────────

export type AgentRole =
  | 'planner'
  | 'architect'
  | 'developer'
  | 'reviewer'
  | 'tester'
  | 'debugger'
  | 'devops'
  | 'optimizer';

export type AgentStatus = 'idle' | 'busy' | 'error' | 'terminated';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled';

export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'local';

// ── Agent Definition ────────────────────────────────────────

export interface AgentDefinition {
  role: AgentRole;
  name: string;
  description: string;
  model: ModelConfig;
  fallbackModel?: ModelConfig;
  input: IOSchema;
  output: IOSchema;
  systemPrompt: string;
  memoryConfig: AgentMemoryConfig;
  maxConcurrency: number;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  dependencies: AgentRole[];  // agents whose output this agent needs
}

export interface ModelConfig {
  provider: LLMProvider;
  model: string;
  maxTokens: number;
  temperature: number;
  topP?: number;
  stopSequences?: string[];
}

export interface IOSchema {
  description: string;
  schema: Record<string, FieldDef>;
}

export interface FieldDef {
  type: 'string' | 'object' | 'array' | 'boolean' | 'number';
  description: string;
  required: boolean;
}

// ── Memory ──────────────────────────────────────────────────

export interface AgentMemoryConfig {
  shortTerm: boolean;           // redis-backed session memory
  longTerm: boolean;            // pgvector-backed persistent memory
  maxShortTermEntries: number;
  maxLongTermRetrievals: number;
  embeddingModel: string;
}

/** Broad category of what a memory entry represents. */
export type MemoryType =
  | 'context'        // raw task input/output snapshot (short-term)
  | 'pattern'        // successful technique / approach
  | 'failure'        // what went wrong and why
  | 'error_fix'      // problem → solution pair
  | 'decision'       // architectural / design decision
  | 'preference'     // user or system preference
  | 'prompt'         // effective prompt template / strategy
  | 'global';        // cross-agent shared knowledge

/** Tags for fine-grained retrieval filtering. */
export type MemoryTag =
  | 'tech-stack'
  | 'architecture'
  | 'code-style'
  | 'performance'
  | 'security'
  | 'testing'
  | 'deployment'
  | 'api-design'
  | 'database'
  | 'ui-ux'
  | 'error-handling'
  | 'best-practice'
  | 'anti-pattern'
  | 'prompt-engineering'
  | string;  // extensible

export interface MemoryEntry {
  id: string;
  agentRole: AgentRole | 'global';
  type: MemoryType;
  content: string;
  embedding?: number[];
  relevanceScore: number;
  sessionId?: string;
  tags: MemoryTag[];
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
  /** How many times this knowledge led to a successful outcome. */
  successCount: number;
  /** How many times this knowledge was present but outcome failed. */
  failureCount: number;
  /** Derived effectiveness = successCount / (successCount + failureCount). NaN if never evaluated. */
  effectiveness: number;
  metadata: Record<string, unknown>;
}

/** Filter criteria for memory retrieval. */
export interface MemoryQuery {
  /** Restrict to specific agent role(s). Omit for all. */
  roles?: (AgentRole | 'global')[];
  /** Restrict to specific memory types. */
  types?: MemoryType[];
  /** Require all of these tags. */
  tags?: MemoryTag[];
  /** Minimum relevance score. */
  minRelevance?: number;
  /** Minimum effectiveness (0–1). */
  minEffectiveness?: number;
  /** Maximum number of results. */
  limit?: number;
  /** Text to embed for semantic search (when vector DB available). */
  queryText?: string;
  /** Include global memories alongside agent-specific ones. */
  includeGlobal?: boolean;
}

// ── Task & Message ──────────────────────────────────────────

export interface Task {
  id: string;
  sessionId: string;
  agentRole: AgentRole;
  status: TaskStatus;
  priority: number;             // 1 (highest) → 10 (lowest)
  input: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: TaskError;
  attempt: number;
  maxAttempts: number;
  parentTaskId?: string;
  childTaskIds: string[];
  createdAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  metadata: TaskMetadata;
}

export interface TaskMetadata {
  model: string;
  provider: LLMProvider;
  tokensIn: number;
  tokensOut: number;
  latencyMs: number;
  costUsd: number;
  memoryEntriesUsed: number;
}

export interface TaskError {
  code: string;
  message: string;
  retryable: boolean;
  stack?: string;
}

export interface AgentMessage {
  id: string;
  sessionId: string;
  from: AgentRole | 'orchestrator' | 'user';
  to: AgentRole | 'orchestrator' | 'broadcast';
  type: 'task_assign' | 'task_result' | 'task_error' | 'status' | 'signal';
  payload: Record<string, unknown>;
  timestamp: Date;
  correlationId: string;        // ties messages to a pipeline run
}

// ── Retry & Circuit Breaker ────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];    // error codes that trigger retry
}

export interface CircuitBreakerState {
  provider: LLMProvider;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure?: Date;
  openUntil?: Date;
  successCount: number;
}

// ── Pipeline ───────────────────────────────────────────────

export interface PipelineDefinition {
  id: string;
  name: string;
  stages: PipelineStage[];
  onFailure: 'abort' | 'skip' | 'retry';
}

export interface PipelineStage {
  id: string;
  name: string;
  agents: AgentRole[];          // agents to execute (parallel within stage)
  dependsOn: string[];          // stage IDs that must complete first
  optional: boolean;            // if true, pipeline continues on failure
  timeout: number;
}

// ── Session ────────────────────────────────────────────────

export interface Session {
  id: string;
  userId: string;
  prompts: string[];            // 1–3 user prompts
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  pipelineId: string;
  currentStageId: string;
  artifacts: Map<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

// ── Execution Context ──────────────────────────────────────

export interface ExecutionContext {
  traceId: string;              // unique ID for the entire run
  spanId: string;               // unique ID for this specific agent execution
  sessionId: string;
  parentSpanId?: string;        // when chained, points to upstream agent
  agentRole: AgentRole;
  attempt: number;
  startedAt: Date;
  promptOverrides?: Partial<PromptConfig>;
  variables: Record<string, unknown>;  // custom vars passed through the chain
}

// ── Prompt Configuration ───────────────────────────────────

export interface PromptConfig {
  systemPrompt: string;
  templateVars: Record<string, string>;
  maxInputLength: number;
  responseFormat: 'json' | 'text' | 'markdown';
  examples?: PromptExample[];
  version: string;
}

export interface PromptExample {
  input: string;
  output: string;
  description?: string;
}

// ── Agent Hooks ────────────────────────────────────────────

export interface AgentHooks {
  beforeExecute?: (ctx: ExecutionContext, task: Task) => Promise<Task>;
  afterExecute?: (ctx: ExecutionContext, task: Task) => Promise<Task>;
  onError?: (ctx: ExecutionContext, task: Task, error: Error) => Promise<void>;
  onRetry?: (ctx: ExecutionContext, task: Task, attempt: number) => Promise<boolean>;  // return false to abort
  beforePrompt?: (ctx: ExecutionContext, prompt: string) => Promise<string>;
  afterParse?: (ctx: ExecutionContext, output: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

// ── Middleware ──────────────────────────────────────────────

export type AgentMiddlewareFn = (
  ctx: ExecutionContext,
  task: Task,
  next: () => Promise<Task>,
) => Promise<Task>;

export interface AgentMiddleware {
  name: string;
  order: number;                // lower = runs first (outer), higher = runs last (inner)
  fn: AgentMiddlewareFn;
}

// ── Agent Metrics ──────────────────────────────────────────

export interface AgentMetricsSnapshot {
  agentRole: AgentRole;
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  retryCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  lastExecutedAt?: Date;
  errorsByCode: Record<string, number>;
}

// ── Chain Types ────────────────────────────────────────────

export interface ChainStep {
  agentRole: AgentRole;
  inputTransform?: (input: Record<string, unknown>, previousOutputs: Map<AgentRole, Record<string, unknown>>) => Record<string, unknown>;
  outputTransform?: (output: Record<string, unknown>) => Record<string, unknown>;
  condition?: (previousOutputs: Map<AgentRole, Record<string, unknown>>) => boolean;
  onError?: 'skip' | 'abort' | 'continue';
}

export interface ChainResult {
  success: boolean;
  outputs: Map<AgentRole, Record<string, unknown>>;
  tasks: Task[];
  failedSteps: AgentRole[];
  durationMs: number;
}
