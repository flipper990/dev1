// Pure utility functions shared across agent infrastructure.

import type { ModelConfig, TaskError } from './types';

export function classifyError(error: Error): TaskError {
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

const COST_TABLE: Record<string, { input: number; output: number }> = {
  'claude-opus-4':   { input: 15.0, output: 75.0 },
  'claude-sonnet-4': { input: 3.0,  output: 15.0 },
  'claude-haiku-4':  { input: 0.80, output: 4.0 },
  'gpt-4o':          { input: 2.50, output: 10.0 },
  'gpt-4o-mini':     { input: 0.15, output: 0.60 },
  'gemini-2.0-pro':  { input: 1.25, output: 5.0 },
};

/** Estimate LLM cost in USD from token counts using standard pricing. */
export function estimateCost(model: ModelConfig, tokensIn: number, tokensOut: number): number {
  const price = COST_TABLE[model.model] ?? { input: 5.0, output: 15.0 };
  return (tokensIn * price.input + tokensOut * price.output) / 1_000_000;
}

/** Truncate text to maxLength, appending a length note when truncated. */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + `... (${text.length} chars total)`;
}
