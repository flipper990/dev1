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

// Internal skill/playbook registry
export {
  DEVTEAM_SKILL_REGISTRY,
  DEVTEAM_SKILLS,
  getSkill,
  getSkillsForRole,
  renderSkillsForPrompt,
  selectSkillsForPrompt,
  validateSkillRegistry,
} from './skills';
export type {
  DevteamSkill,
  SkillId,
  SkillRegistryEntry,
  SkillSelectionContext,
  SkillValidatorId,
} from './skills';

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

// Dependency validator
export { validateAndFixDependencies } from './dependency-validator';
export type { DependencyValidationReport, DependencyValidationResult } from './dependency-validator';

// UI design system
export { UI_SYSTEM_PROMPT, validateUiSystemCompliance, uiSystemViolationsAsIssues } from './ui-system';
export type { UiSystemViolation, UiSystemReport } from './ui-system';

// Tech-stack contract
export { normalizeTechStack, buildStackContract, validateStackCompliance, stackViolationsAsIssues } from './tech-stack';
export type {
  CanonicalStack, BackendStack, FrontendStack, OrmStack, DbStack,
  ValidatorStack, StylingStack, StackViolation, StackComplianceReport, StackViolationRule,
} from './tech-stack';

// Slice planner — splits oversized slices, enforces dependency-aware order,
// and produces per-slice context summaries.
export {
  planSlices, summarizePlannedSlice, buildSliceManifest,
  MAX_FEATURES_PER_SLICE, SOFT_FEATURES_PER_SLICE, CANONICAL_SLICE_PRIORITY,
} from './slice-planner';
export type { RawSlice, PlannedSlice, SlicePlan } from './slice-planner';

// Implementation-completeness validator — pure scan for stubs, mocks,
// placeholder copy/images, empty handlers, unwired buttons.
export {
  validateImplementationCompleteness,
  completenessViolationsAsIssues,
  extractApiDomains,
} from './implementation-completeness';
export type {
  CompletenessReport,
  CompletenessViolation,
  CompletenessRule,
  CompletenessContext,
} from './implementation-completeness';

// Production-polish audit — pure scan for unused code, dead files,
// a11y basics, and responsive breakpoint coverage. Consumed by the
// final polish pass.
export {
  runProductionPolishAudit,
  formatPolishAuditForPrompt,
} from './production-polish-audit';
export type {
  PolishAuditReport,
  PolishAuditViolation,
  PolishAuditRule,
} from './production-polish-audit';
