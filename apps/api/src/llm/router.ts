// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// LLM Router Factory â€” Creates a fully-wired SmartLLMRouter
// with all registered providers, routing rules, and tracking.
//
// The old LLMRouter is replaced by SmartLLMRouter which also
// implements LLMClient, so the rest of the codebase is unaffected.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { RouterConfig } from './types.js';
import { AnthropicClient } from './anthropic-client.js';
import { OpenAIClient } from './openai-client.js';
import { ProviderRegistry } from './provider-registry.js';
import { SmartLLMRouter } from './smart-router.js';
import { config } from '../config.js';

/** Backward-compatible alias â€” old code imports LLMRouter. */
export { SmartLLMRouter as LLMRouter };

/**
 * Create a fully configured SmartLLMRouter.
 * Registers all providers whose API keys are present in config.
 */
export function createLLMRouter(logger: Logger, routerConfig?: Partial<RouterConfig>): SmartLLMRouter {
  const registry = new ProviderRegistry(logger);

  // Register Anthropic if key is set
  if (config.llm.anthropicApiKey) {
    registry.register(new AnthropicClient(config.llm.anthropicApiKey, logger));
  } else {
    logger.warn('ANTHROPIC_API_KEY not set â€” Anthropic provider unavailable');
  }

  // Register OpenAI if key is set
  if (config.llm.openaiApiKey) {
    registry.register(new OpenAIClient(config.llm.openaiApiKey, logger));
  } else {
    logger.warn('OPENAI_API_KEY not set â€” OpenAI provider unavailable');
  }

  // Register Google if key is set
  if (config.llm.googleApiKey) {
    // Placeholder: GoogleClient not yet implemented.
    // When it is, uncomment:
    // registry.register(new GoogleClient(config.llm.googleApiKey, logger));
    logger.info('Google API key detected but GoogleClient not yet implemented');
  }

  return new SmartLLMRouter(registry, logger, routerConfig);
}
