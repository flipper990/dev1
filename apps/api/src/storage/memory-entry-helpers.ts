import type { MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import type { MemoryEntryInput } from '../../../../packages/agent-core/src/base-agent.js';

/** Hydrate a partial entry input into a full MemoryEntry. */
export function hydrateEntry(entry: MemoryEntryInput): MemoryEntry {
  return {
    ...entry,
    tags: entry.tags ?? [],
    id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt: new Date(),
    lastAccessed: new Date(),
    accessCount: 0,
    successCount: 0,
    failureCount: 0,
    effectiveness: NaN,
  };
}

/** Update last-accessed timestamp and increment access count. */
export function touchEntry(entry: MemoryEntry): MemoryEntry {
  entry.lastAccessed = new Date();
  entry.accessCount++;
  return entry;
}

/** Composite ranking: relevance + effectiveness + recency + frequency. */
export function rankEntry(entry: MemoryEntry): number {
  let score = entry.relevanceScore;

  if (!isNaN(entry.effectiveness) && entry.effectiveness > 0) {
    score += entry.effectiveness * 0.5;
  }

  const ageMs = Date.now() - new Date(entry.lastAccessed).getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  score += Math.max(0, 0.3 * (1 - ageDays / 30));

  if (entry.accessCount > 0) {
    score += 0.1 * Math.log2(1 + entry.accessCount);
  }

  return score;
}
