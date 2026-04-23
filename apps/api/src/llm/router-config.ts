// Model constants, default routing rules, and shared helpers for SmartLLMRouter.

import type { ModelConfig } from '../../../../packages/agent-core/src/types.js';
import type { RoutingRule } from './types.js';

// â”€â”€ Model Presets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const CLAUDE_OPUS: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-opus-4-20250514',
  maxTokens: 8192,
  temperature: 0.3,
};

export const CLAUDE_SONNET: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-20250514',
  maxTokens: 8192,
  temperature: 0.4,
};

export const GPT_4O: ModelConfig = {
  provider: 'openai',
  model: 'gpt-4o',
  maxTokens: 16384,
  temperature: 0.3,
};

export const GPT_4O_MINI: ModelConfig = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  maxTokens: 16384,
  temperature: 0.3,
};

// â”€â”€ Default Routing Rules â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export const DEFAULT_ROUTING_RULES: RoutingRule[] = [
  // Planning & reasoning â†’ Claude (best at nuanced analysis)
  { category: 'planning',        primary: CLAUDE_OPUS,    fallbacks: [GPT_4O, CLAUDE_SONNET] },
  { category: 'reasoning',       primary: CLAUDE_OPUS,    fallbacks: [GPT_4O, CLAUDE_SONNET] },
  { category: 'code-review',     primary: CLAUDE_OPUS,    fallbacks: [GPT_4O] },

  // Code generation â†’ OpenAI (strong at structured code output)
  { category: 'code-generation', primary: GPT_4O,         fallbacks: [CLAUDE_SONNET, GPT_4O_MINI] },

  // Testing â†’ Sonnet (good balance)
  { category: 'testing',         primary: CLAUDE_SONNET,  fallbacks: [GPT_4O_MINI] },

  // Infrastructure â†’ lightweight model (cost-efficient)
  { category: 'infrastructure',  primary: GPT_4O_MINI,    fallbacks: [CLAUDE_SONNET] },

  // General fallback
  { category: 'general',         primary: CLAUDE_SONNET,  fallbacks: [GPT_4O] },
];

// â”€â”€ Error Classification & Retry Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export function classifyRouterError(error: Error): string {
  const msg = error.message.toLowerCase();
  if (msg.includes('rate limit') || msg.includes('429'))                               return 'RATE_LIMITED';
  if (msg.includes('timeout') || msg.includes('timed out') || msg.includes('econnaborted')) return 'TIMEOUT';
  if (msg.includes('500') || msg.includes('internal server') || msg.includes('502') || msg.includes('503')) return 'PROVIDER_ERROR';
  if (msg.includes('context length') || msg.includes('too many tokens'))               return 'TOKEN_OVERFLOW';
  if (msg.includes('auth') || msg.includes('401') || msg.includes('403'))             return 'AUTH_ERROR';
  if (msg.includes('econnrefused') || msg.includes('enotfound'))                       return 'NETWORK_ERROR';
  return 'UNKNOWN';
}

export function isRetryable(code: string): boolean {
  return ['RATE_LIMITED', 'TIMEOUT', 'PROVIDER_ERROR', 'NETWORK_ERROR', 'UNKNOWN'].includes(code);
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
