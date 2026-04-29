// ─────────────────────────────────────────────────────────────
// LLM Module — Barrel export
// ─────────────────────────────────────────────────────────────

// Types
export type {
  LLMProviderClient,
  LLMRequestParams,
  LLMResponse,
  RoutedLLMResponse,
  ChatMessage,
  TaskCategory,
  RoutingRule,
  RouterConfig,
  CostRecord,
  CostSummary,
  ModelOverride,
} from './types.js';

export { ROLE_TO_CATEGORY } from './types.js';

// Providers
export { AnthropicClient } from './anthropic-client.js';
export { OpenAIClient } from './openai-client.js';

// Registry
export { ProviderRegistry } from './provider-registry.js';

// Cost tracking
export { CostTracker } from './cost-tracker.js';

// Router
export { SmartLLMRouter } from './smart-router.js';
export { buildRoutingRulesFromConfig, buildFallbackByModelMap } from './router-config.js';

// Factory
export { LLMRouter, createLLMRouter } from './router.js';

// Model config (env-driven)
export { MODEL_CONFIG, validateModelConfig, logActiveModels, describeModel } from '../config/models.js';
export type { RoleModelConfig, ModelConfigMap, ModelValidationResult } from '../config/models.js';
