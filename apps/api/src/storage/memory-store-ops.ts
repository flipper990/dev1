import type { MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { StoreKey } from './memory-store-io.js';

export interface MemoryStats {
  shortTermSessions: number;
  longTermEntries: Record<string, number>;
  totalEntries: number;
  byType: Record<string, number>;
  avgEffectiveness: number;
  globalEntries: number;
}

export function computeMemoryStats(
  longTermCache: Map<StoreKey, MemoryEntry[]>,
  shortTermStore: Map<string, MemoryEntry[]>,
): MemoryStats {
  const longTermEntries: Record<string, number> = {};
  const byType: Record<string, number> = {};
  let totalEntries = 0;
  let totalEffectivenessSum = 0;
  let totalEffectivenessCount = 0;

  for (const [role, entries] of longTermCache) {
    longTermEntries[role] = entries.length;
    totalEntries += entries.length;
    for (const e of entries) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
      if (!isNaN(e.effectiveness)) {
        totalEffectivenessSum += e.effectiveness;
        totalEffectivenessCount++;
      }
    }
  }

  return {
    shortTermSessions: shortTermStore.size,
    longTermEntries,
    totalEntries,
    byType,
    avgEffectiveness: totalEffectivenessCount > 0
      ? totalEffectivenessSum / totalEffectivenessCount
      : NaN,
    globalEntries: (longTermCache.get('global') ?? []).length,
  };
}

export function getTopPatterns(longTermCache: Map<StoreKey, MemoryEntry[]>, limit = 10): MemoryEntry[] {
  const all: MemoryEntry[] = [];
  for (const entries of longTermCache.values()) {
    all.push(...entries.filter(e =>
      e.type === 'pattern' && !isNaN(e.effectiveness) && e.effectiveness > 0,
    ));
  }
  return all
    .sort((a, b) => b.effectiveness - a.effectiveness || b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export function getTopFailures(longTermCache: Map<StoreKey, MemoryEntry[]>, limit = 10): MemoryEntry[] {
  const all: MemoryEntry[] = [];
  for (const entries of longTermCache.values()) {
    all.push(...entries.filter(e => e.type === 'failure' || e.type === 'error_fix'));
  }
  return all
    .sort((a, b) => b.accessCount - a.accessCount || b.relevanceScore - a.relevanceScore)
    .slice(0, limit);
}

export async function runStoreDecay(
  longTermCache: Map<StoreKey, MemoryEntry[]>,
  persistFn: (role: StoreKey) => Promise<void>,
  evictShortTermFn: () => number,
  logger: Logger,
): Promise<{ decayed: number; archived: number }> {
  let decayed = 0;
  let archived = 0;

  for (const [role, entries] of longTermCache) {
    for (const entry of entries) {
      entry.relevanceScore *= 0.95;
      decayed++;
    }

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const before = entries.length;
    const filtered = entries.filter(e =>
      e.relevanceScore > 0.05 || e.lastAccessed > thirtyDaysAgo || e.effectiveness > 0.8,
    );
    archived += before - filtered.length;

    longTermCache.set(role, filtered);
    await persistFn(role);
  }

  logger.info('Memory decay complete', { decayed, archived });

  const shortTermEvicted = evictShortTermFn();
  if (shortTermEvicted > 0) {
    logger.info(`Evicted ${shortTermEvicted} expired short-term memory slots`);
  }

  return { decayed, archived };
}
