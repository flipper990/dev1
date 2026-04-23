// ─────────────────────────────────────────────────────────────
// Package barrel export
// ─────────────────────────────────────────────────────────────

// Types
export type {
  AgentRole,
  AgentStatus,
  TaskStatus,
  LLMProvider,
  AgentDefinition,
  ModelConfig,
  IOSchema,
  FieldDef,
  AgentMemoryConfig,
  MemoryEntry,
  Task,
  TaskMetadata,
  TaskError,
  AgentMessage,
  RetryPolicy,
  CircuitBreakerState,
  PipelineDefinition,
  PipelineStage,
  Session,
  ExecutionContext,
  PromptConfig,
  PromptExample,
  AgentHooks,
  AgentMiddleware,
  AgentMiddlewareFn,
  AgentMetricsSnapshot,
  ChainStep,
  ChainResult,
} from './types';

// Base agent
export { BaseAgent } from './base-agent';
export type { LLMClient, MemoryStore, MessageBus, Logger, AgentConfig } from './base-agent';

// Agent registry
export { AGENT_DEFINITIONS, getAgentDefinition, getExecutionOrder } from './agent-registry';

// Prompts
export { PROMPTS } from './prompts';

// Prompt Manager
export { PromptManager } from './prompt-manager';

// Middleware
export {
  createMiddleware,
  loggingMiddleware,
  timeoutMiddleware,
  inputValidationMiddleware,
  rateLimitMiddleware,
  retryMiddleware,
  metricsMiddleware,
  composeMiddleware,
  createProductionMiddleware,
} from './agent-middleware';

// Agent Runner & Chaining
export {
  AgentRunner,
  ChainBuilder,
  createTask,
  createExecutionContext,
  fullGenerationChain,
  quickReviewChain,
  fixAndOptimizeChain,
} from './agent-runner';

// Agent Metrics
export { AgentMetrics } from './agent-metrics';
export type { MetricsCollector } from './agent-middleware';

// Orchestrator
export { PipelineOrchestrator, PIPELINE_STEPS } from './orchestrator';
export type { PipelineEvent, PipelineEventHandler, PipelineState, PipelineStep, StepState, StepStatus } from './orchestrator';

// Self-heal validator
export { validateAndRepair } from './step-validator';
export type { ValidationResult, ValidationIssue, ValidationSeverity, RepairChange } from './step-validator';

// Message bus
export { RedisMessageBus, InMemoryMessageBus } from './message-bus';

// Resilience
export { CircuitBreaker, ResilientModelRouter, executeWithRetry } from './resilience';
export type { CircuitBreakerConfig, RetryableOperation, RetryResult, LLMCallParams, LLMCallResult } from './resilience';

// Memory
export { MemoryManager, InMemoryMemoryStore } from './memory';
export type { RedisMemoryBackend, PgVectorBackend, EmbeddingClient } from './memory';
