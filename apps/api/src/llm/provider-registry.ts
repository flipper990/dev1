// ─────────────────────────────────────────────────────────────
// Provider Registry — Manages LLM provider instances
// ─────────────────────────────────────────────────────────────

import type { LLMProvider } from '../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../packages/agent-core/src/base-agent.js';
import type { LLMProviderClient } from './types.js';

/**
 * Central registry of available LLM providers.
 * Register a provider once; look it up by ID when routing.
 * New providers (Google, local, etc.) plug in with one call.
 */
export class ProviderRegistry {
  private providers = new Map<LLMProvider, LLMProviderClient>();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Register a provider client. Overwrites if same ID already registered. */
  register(client: LLMProviderClient): void {
    this.logger.info(`Registered LLM provider: ${client.displayName} (${client.providerId})`);
    this.providers.set(client.providerId, client);
  }

  /** Get a provider by ID. Throws if not registered. */
  get(id: LLMProvider): LLMProviderClient {
    const client = this.providers.get(id);
    if (!client) {
      throw new Error(`LLM provider "${id}" is not registered. Available: [${this.listIds().join(', ')}]`);
    }
    return client;
  }

  /** Check if a provider is registered. */
  has(id: LLMProvider): boolean {
    return this.providers.has(id);
  }

  /** List all registered provider IDs. */
  listIds(): LLMProvider[] {
    return Array.from(this.providers.keys());
  }

  /** List all registered providers. */
  listAll(): LLMProviderClient[] {
    return Array.from(this.providers.values());
  }

  /** Run health checks on all providers. */
  async healthCheckAll(): Promise<Record<LLMProvider, boolean>> {
    const results: Record<string, boolean> = {};
    for (const [id, client] of this.providers) {
      if (client.healthCheck) {
        try {
          results[id] = await client.healthCheck();
        } catch {
          results[id] = false;
        }
      } else {
        results[id] = true; // assume healthy if no check
      }
    }
    return results as Record<LLMProvider, boolean>;
  }
}
