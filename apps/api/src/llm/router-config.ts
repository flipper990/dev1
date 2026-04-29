// Routing rules + retry helpers for SmartLLMRouter.
//
// All model selections come from MODEL_CONFIG (env-driven).
// There are NO hardcoded model constants in this file by design.

import type { ModelConfig, AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { RoutingRule, TaskCategory } from './types.js';
import { ROLE_TO_CATEGORY } from './types.js';
import { MODEL_CONFIG } from '../config/models.js';

// ── Rule Builder ────────────────────────────────────────────

/**
 * Build per-category routing rules from MODEL_CONFIG.
 *
 * Each role's primary model becomes the rule's primary; the role's
 * configured fallback (if explicitly set in .env) becomes the only
 * fallback. No implicit/cross-role fallbacks.
 *
 * If multiple roles share a category, the last one wins. To get
 * truly per-role routing, callers should use `routeByRole` rather
 * than `routeByCategory`.
 */
export function buildRoutingRulesFromConfig(): RoutingRule[] {
  const byCategory = new Map<TaskCategory, RoutingRule>();
  for (const role of Object.keys(MODEL_CONFIG) as AgentRole[]) {
    const cfg = MODEL_CONFIG[role];
    const category = ROLE_TO_CATEGORY[role];
    const fallbacks: ModelConfig[] = cfg.fallback ? [cfg.fallback] : [];
    byCategory.set(category, { category, primary: cfg.primary, fallbacks });
  }
  return Array.from(byCategory.values());
}

/**
 * Build a model→fallback map for `routedCall(model)` paths.
 * The router uses this to resolve the explicit fallback when
 * a caller passes a `ModelConfig` directly (e.g. BaseAgent).
 */
export function buildFallbackByModelMap(): Map<string, ModelConfig> {
  const m = new Map<string, ModelConfig>();
  for (const role of Object.keys(MODEL_CONFIG) as AgentRole[]) {
    const cfg = MODEL_CONFIG[role];
    if (cfg.fallback) m.set(cfg.primary.model, cfg.fallback);
  }
  return m;
}

// ── Error Classification & Retry Helpers ───────────────────

export function classifyRouterError(error: Error): string {
  const msg = error.message.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429'))                                        return 'RATE_LIMITED';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnaborted'))     return 'TIMEOUT';
  if (msg.includes('500') || msg.includes('internal server') || msg.includes('502') || msg.includes('503')) return 'PROVIDER_ERROR';
  if (msg.includes('context length') || msg.includes('too many tokens'))                        return 'TOKEN_OVERFLOW';
  if (msg.includes('auth') || msg.includes('401') || msg.includes('403'))                       return 'AUTH_ERROR';
  if (msg.includes('econnrefused') || msg.includes('enotfound'))                                return 'NETWORK_ERROR';
  return 'UNKNOWN';
}

export function isRetryable(code: string): boolean {
  return ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'NETWORK_ERROR', 'UNKNOWN'].includes(code);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
