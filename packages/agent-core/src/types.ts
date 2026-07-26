// Core type definitions for the multi-agent system.
// Primitives -> ./base-types.ts | Memory types -> ./memory-types.ts

import type { AgentRole, LLMProvider, TaskStatus } from './base-types';

// Re-export all primitives so existing imports from types.ts continue to work.
export type { AgentRole, AgentStatus, TaskStatus, LLMProvider } from './base-types';
export type { MemoryType, MemoryTag, MemoryEntry, MemoryQuery } from './memory-types';

// ── Agent Definition ────────────────────────────────────────────

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
  dependencies: AgentRole[];
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

export interface AgentMemoryConfig {
  shortTerm: boolean;
  longTerm: boolean;
  maxShortTermEntries: number;
  maxLongTermRetrievals: number;
  embeddingModel: string;
}

// ── Task & Message ──────────────────────────────────────────────

export interface Task {
  id: string;
  sessionId: string;
  agentRole: AgentRole;
  status: TaskStatus;
  priority: number;
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
  correlationId: string;
}

// ── Retry & Circuit Breaker ────────────────────────────────────

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors: string[];
}

export interface CircuitBreakerState {
  provider: LLMProvider;
  state: 'closed' | 'open' | 'half-open';
  failureCount: number;
  lastFailure?: Date;
  openUntil?: Date;
  successCount: number;
}

// ── Pipeline ────────────────────────────────────────────────────

export interface PipelineDefinition {
  id: string;
  name: string;
  stages: PipelineStage[];
  onFailure: 'abort' | 'skip' | 'retry';
}

export interface PipelineStage {
  id: string;
  name: string;
  agents: AgentRole[];
  dependsOn: string[];
  optional: boolean;
  timeout: number;
}

// ── Session & Execution Context ────────────────────────────────

export interface Session {
  id: string;
  userId: string;
  prompts: string[];
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  pipelineId: string;
  currentStageId: string;
  artifacts: Map<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

export interface ExecutionContext {
  traceId: string;
  spanId: string;
  sessionId: string;
  parentSpanId?: string;
  agentRole: AgentRole;
  attempt: number;
  startedAt: Date;
  promptOverrides?: Partial<PromptConfig>;
  variables: Record<string, unknown>;
}

// ── Prompt Configuration ────────────────────────────────────────

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

// ── Hooks & Middleware ──────────────────────────────────────────

export interface AgentHooks {
  beforeExecute?: (ctx: ExecutionContext, task: Task) => Promise<Task>;
  onMemoriesLoaded?: (ctx: ExecutionContext, task: Task, memories: MemoryEntry[]) => Promise<void>;
  afterExecute?:  (ctx: ExecutionContext, task: Task) => Promise<Task>;
  onError?:       (ctx: ExecutionContext, task: Task, error: Error) => Promise<void>;
  onRetry?:       (ctx: ExecutionContext, task: Task, attempt: number) => Promise<boolean>;
  beforePrompt?:  (ctx: ExecutionContext, prompt: string) => Promise<string>;
  afterParse?:    (ctx: ExecutionContext, output: Record<string, unknown>) => Promise<Record<string, unknown>>;
}

export type AgentMiddlewareFn = (
  ctx: ExecutionContext,
  task: Task,
  next: () => Promise<Task>,
) => Promise<Task>;

export interface AgentMiddleware {
  name: string;
  order: number;
  fn: AgentMiddlewareFn;
}

// ── Metrics ─────────────────────────────────────────────────────

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

// ── Chain Types ─────────────────────────────────────────────────

export interface ChainStep {
  agentRole: AgentRole;
  inputTransform?:  (input: Record<string, unknown>, prev: Map<AgentRole, Record<string, unknown>>) => Record<string, unknown>;
  outputTransform?: (output: Record<string, unknown>) => Record<string, unknown>;
  condition?:       (prev: Map<AgentRole, Record<string, unknown>>) => boolean;
  onError?: 'skip' | 'abort' | 'continue';
}

export interface ChainResult {
  success: boolean;
  outputs: Map<AgentRole, Record<string, unknown>>;
  tasks: Task[];
  failedSteps: AgentRole[];
  durationMs: number;
}
