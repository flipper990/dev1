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
export { SmartLLMRouter, DEFAULT_ROUTING_RULES } from './smart-router.js';

// Factory
export { LLMRouter, createLLMRouter } from './router.js';
