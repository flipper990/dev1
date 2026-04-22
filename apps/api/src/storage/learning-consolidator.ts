// Consolidation logic extracted from LearningEngine for clarity.

import type { AgentRole, MemoryEntry, MemoryTag, Task } from '../../../packages/agent-core/src/types.js';
import type { MemoryStore, MemoryEntryInput, Logger } from '../../../packages/agent-core/src/base-agent.js';

export type FailureEntry = { count: number; lastError: string; lastTaskId: string };

/** Accumulate task failures and write a failure memory when the threshold is hit. */
export async function handleTaskFailure(
  task: Task,
  agentRole: AgentRole,
  accumulator: Map<string, FailureEntry>,
  failureThreshold: number,
  memory: MemoryStore,
  logger: Logger,
): Promise<void> {
  const errorCode = task.error?.code ?? 'UNKNOWN';
  const accKey = `${agentRole}:${errorCode}`;

  const acc = accumulator.get(accKey) ?? { count: 0, lastError: '', lastTaskId: '' };
  acc.count++;
  acc.lastError = task.error?.message ?? 'Unknown error';
  acc.lastTaskId = task.id;
  accumulator.set(accKey, acc);

  if (acc.count >= failureThreshold) {
    const failureEntry: MemoryEntryInput = {
      agentRole,
      type: 'failure',
      content: `Repeated failure (${acc.count}x): ${errorCode} — ${acc.lastError}`,
      relevanceScore: 1.2,
      tags: ['error-handling', errorCode.toLowerCase() as MemoryTag],
      metadata: { errorCode, occurrences: acc.count, lastTaskId: acc.lastTaskId },
    };

    await memory.saveLongTerm(failureEntry);
    await memory.saveGlobal({
      ...failureEntry,
      agentRole: 'global',
      relevanceScore: 1.0,
      metadata: { ...failureEntry.metadata, originAgent: agentRole },
    });

    logger.info(`Created failure pattern memory for ${accKey} (${acc.count} occurrences)`);
    accumulator.delete(accKey);
  }
}

/** Promote high-effectiveness memories to global so other agents can benefit. */
export async function checkMemoryPromotions(
  agentRole: AgentRole,
  promotionThreshold: number,
  memory: MemoryStore,
  logger: Logger,
): Promise<void> {
  const candidates = await memory.query({
    roles: [agentRole],
    types: ['pattern', 'error_fix', 'decision'],
    minEffectiveness: 0.8,
    minRelevance: 0.5,
    limit: 5,
  });

  for (const candidate of candidates) {
    const total = candidate.successCount + candidate.failureCount;
    if (total >= promotionThreshold && candidate.effectiveness >= 0.8) {
      const existing = await memory.getGlobal({ types: [candidate.type], limit: 50 });
      const alreadyGlobal = existing.some(e =>
        e.content === candidate.content ||
        (e.metadata?.originAgent === agentRole && e.metadata?.originEntryId === candidate.id),
      );

      if (!alreadyGlobal) {
        await memory.saveGlobal({
          agentRole: 'global',
          type: candidate.type,
          content: candidate.content,
          relevanceScore: candidate.relevanceScore * 0.9,
          tags: [...candidate.tags, 'best-practice'],
          metadata: {
            ...candidate.metadata,
            originAgent: agentRole,
            originEntryId: candidate.id,
            effectiveness: candidate.effectiveness,
            promotedAt: new Date().toISOString(),
          },
        });
        logger.info(`Promoted memory to global`, { agentRole, type: candidate.type, effectiveness: candidate.effectiveness });
      }
    }
  }
}

export function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export function pickStronger(a: MemoryEntry, b: MemoryEntry): MemoryEntry {
  if (!isNaN(a.effectiveness) && !isNaN(b.effectiveness) && a.effectiveness !== b.effectiveness) {
    return a.effectiveness > b.effectiveness ? a : b;
  }
  return a.relevanceScore >= b.relevanceScore ? a : b;
}

/**
 * Merge related memories to reduce noise and strengthen patterns.
 * Similar entries within the same tag group are merged; low-effectiveness entries pruned.
 */
export async function consolidate(
  agentRole: AgentRole,
  memory: MemoryStore,
  logger: Logger,
): Promise<{ merged: number; pruned: number }> {
  const entries = await memory.query({
    roles: [agentRole],
    types: ['pattern', 'decision'],
    minRelevance: 0.2,
    limit: 100,
  });

  let merged = 0;
  let pruned  = 0;

  const tagGroups = new Map<string, MemoryEntry[]>();
  for (const entry of entries) {
    for (const tag of entry.tags) {
      const group = tagGroups.get(tag) ?? [];
      group.push(entry);
      tagGroups.set(tag, group);
    }
  }

  const mergedIds = new Set<string>();
  for (const group of tagGroups.values()) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      if (mergedIds.has(group[i].id)) continue;
      for (let j = i + 1; j < group.length; j++) {
        if (mergedIds.has(group[j].id)) continue;

        const sim = jaccardSimilarity(group[i].content, group[j].content);
        if (sim > 0.6 && group[i].type === group[j].type) {
          const keep = pickStronger(group[i], group[j]);
          const drop = keep === group[i] ? group[j] : group[i];

          keep.accessCount  += drop.accessCount;
          keep.successCount += drop.successCount;
          keep.failureCount += drop.failureCount;
          const total = keep.successCount + keep.failureCount;
          keep.effectiveness  = total > 0 ? keep.successCount / total : NaN;
          keep.relevanceScore = Math.min(keep.relevanceScore + 0.1, 2.0);
          keep.tags = [...new Set([...keep.tags, ...drop.tags])];

          mergedIds.add(drop.id);
          merged++;
        }
      }
    }
  }

  for (const entry of entries) {
    if (
      !isNaN(entry.effectiveness) &&
      entry.effectiveness < 0.2 &&
      entry.successCount + entry.failureCount >= 5 &&
      entry.relevanceScore < 0.3
    ) {
      mergedIds.add(entry.id);
      pruned++;
    }
  }

  logger.info(`Consolidation for ${agentRole}`, { merged, pruned });
  return { merged, pruned };
}
