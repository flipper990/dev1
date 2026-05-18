// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Provider Registry â€” Manages LLM provider instances
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { LLMProvider } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { LLMProviderClient } from './types.js';

export interface ProviderHealthStatus {
  provider: LLMProvider;
  healthy: boolean;
  reason: string;
  checkedAt: string;
  latencyMs: number;
}

export interface ProviderPreflightResult {
  ok: boolean;
  requiredProviders: LLMProvider[];
  providers: Record<LLMProvider, ProviderHealthStatus>;
  checkedAt: string;
  reason?: string;
}

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
    const detailed = await this.healthCheckAllDetailed();
    const results: Record<string, boolean> = {};
    for (const [provider, status] of Object.entries(detailed)) {
      results[provider] = status.healthy;
    }
    return results as Record<LLMProvider, boolean>;
  }

  async healthCheckAllDetailed(opts?: { timeoutMs?: number }): Promise<Record<LLMProvider, ProviderHealthStatus>> {
    const timeoutMs = Math.max(250, opts?.timeoutMs ?? 5_000);
    const results: Record<string, ProviderHealthStatus> = {};
    for (const [id, client] of this.providers) {
      const startedAt = Date.now();
      const checkedAt = new Date().toISOString();
      if (!client.healthCheck) {
        results[id] = {
          provider: id,
          healthy: true,
          reason: 'health-check-not-implemented',
          checkedAt,
          latencyMs: Date.now() - startedAt,
        };
        continue;
      }
      try {
        const healthy = await Promise.race([
          client.healthCheck(),
          new Promise<false>((resolve) => {
            setTimeout(() => resolve(false), timeoutMs);
          }),
        ]);
        results[id] = {
          provider: id,
          healthy: Boolean(healthy),
          reason: healthy ? 'ok' : 'provider-healthcheck-failed',
          checkedAt,
          latencyMs: Date.now() - startedAt,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        results[id] = {
          provider: id,
          healthy: false,
          reason: message || 'provider-healthcheck-error',
          checkedAt,
          latencyMs: Date.now() - startedAt,
        };
      }
    }
    return results as Record<LLMProvider, ProviderHealthStatus>;
  }

  async preflight(requiredProviders: LLMProvider[], opts?: { timeoutMs?: number }): Promise<ProviderPreflightResult> {
    const checkedAt = new Date().toISOString();
    const providers = await this.healthCheckAllDetailed(opts);
    const unavailable = requiredProviders.filter((provider) => {
      if (!this.has(provider)) return true;
      return !providers[provider]?.healthy;
    });
    if (unavailable.length > 0) {
      const reason = unavailable
        .map((provider) => {
          const status = providers[provider];
          if (!this.has(provider)) return `${provider}:not-registered`;
          return `${provider}:${status?.reason ?? 'unhealthy'}`;
        })
        .join(', ');
      return {
        ok: false,
        requiredProviders,
        providers,
        checkedAt,
        reason,
      };
    }
    return {
      ok: true,
      requiredProviders,
      providers,
      checkedAt,
    };
  }
}
