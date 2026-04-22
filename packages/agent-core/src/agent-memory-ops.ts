// Memory operations extracted from BaseAgent as standalone functions.
// Allows unit-testing memory logic without a full agent instance.

import type { AgentDefinition, AgentRole, MemoryEntry, MemoryType, Task } from './types';
import type { Logger, MemoryEntryInput, MemoryStore } from './agent-contracts';

export const RETRIEVABLE_TYPES: MemoryType[] = [
  'pattern', 'failure', 'error_fix', 'decision', 'preference', 'prompt',
];

const ENTRY_CAP    = 400;   // max chars per memory entry before truncation
const TOTAL_BUDGET = 2500;  // max total chars injected into prompts

export async function loadMemories(
  task: Task,
  definition: AgentDefinition,
  memory: MemoryStore,
  logger: Logger,
): Promise<MemoryEntry[]> {
  const config = definition.memoryConfig;
  const all: MemoryEntry[] = [];

  if (config.shortTerm) {
    try {
      const shortTerm = await memory.getShortTerm(task.sessionId, definition.role, config.maxShortTermEntries);
      all.push(...shortTerm);
    } catch (err) {
      logger.warn(`[${definition.role}] Failed to load short-term memory`, { error: (err as Error).message });
    }
  }

  if (config.longTerm) {
    try {
      const longTerm = await memory.query({
        roles: [definition.role],
        types: RETRIEVABLE_TYPES,
        minRelevance: 0.2,
        limit: config.maxLongTermRetrievals,
        queryText: JSON.stringify(task.input).slice(0, 800),
      });
      all.push(...longTerm);
    } catch (err) {
      logger.warn(`[${definition.role}] Failed to load long-term memory`, { error: (err as Error).message });
    }
  }

  if (config.longTerm) {
    try {
      const globalMemories = await memory.getGlobal({
        types: ['pattern', 'error_fix', 'decision'],
        minRelevance: 0.3,
        minEffectiveness: 0.5,
        limit: 3,
        queryText: JSON.stringify(task.input).slice(0, 400),
      });
      all.push(...globalMemories);
    } catch (err) {
      logger.warn(`[${definition.role}] Failed to load global memory`, { error: (err as Error).message });
    }
  }

  return applyMemoryBudget(all);
}

/** Sort by composite score (relevance × effectiveness × recency), cap entry length, cap total chars. */
export function applyMemoryBudget(memories: MemoryEntry[]): MemoryEntry[] {
  const compositeScore = (e: MemoryEntry): number => {
    const eff = isNaN(e.effectiveness) ? 0.5 : Math.max(e.effectiveness, 0.1);
    const daysSince = (Date.now() - new Date(e.lastAccessed).getTime()) / 86_400_000;
    const recency = 1 / (1 + daysSince / 30); // halves every 30 days
    return e.relevanceScore * eff * recency;
  };

  const sorted = [...memories].sort((a, b) => compositeScore(b) - compositeScore(a));
  const result: MemoryEntry[] = [];
  let used = 0;

  for (const entry of sorted) {
    const trimmed = entry.content.length > ENTRY_CAP
      ? entry.content.slice(0, ENTRY_CAP - 1) + '\u2026'
      : entry.content;
    if (used + trimmed.length > TOTAL_BUDGET) break;
    result.push({ ...entry, content: trimmed });
    used += trimmed.length;
  }

  return result;
}

export async function saveMemories(
  task: Task,
  output: Record<string, unknown>,
  definition: AgentDefinition,
  memory: MemoryStore,
  logger: Logger,
  extractLearnings: (task: Task, output: Record<string, unknown>) => Promise<MemoryEntry[]>,
): Promise<void> {
  const config = definition.memoryConfig;

  if (config.shortTerm) {
    try {
      await memory.setShortTerm(task.sessionId, {
        agentRole: definition.role,
        type: 'context',
        content: summariseForShortTerm(task, output, definition.role),
        relevanceScore: 1.0,
        sessionId: task.sessionId,
        tags: [],
        metadata: { taskId: task.id },
      });
    } catch (err) {
      logger.warn(`[${definition.role}] Failed to save short-term memory`, { error: (err as Error).message });
    }
  }

  if (config.longTerm) {
    try {
      const learnings = await extractLearnings(task, output);
      for (const learning of learnings) {
        const embedding = await memory.embed(learning.content);
        await memory.saveLongTerm({ ...learning, embedding });

        // Promote high-effectiveness patterns to global shared memory
        if (
          (learning.type === 'pattern' || learning.type === 'error_fix') &&
          learning.relevanceScore > 1.3
        ) {
          await memory.saveGlobal({
            ...learning,
            agentRole: 'global',
            embedding,
            relevanceScore: learning.relevanceScore * 0.8,
            metadata: { ...learning.metadata, originAgent: definition.role, originTaskId: task.id },
          });
        }
      }
    } catch (err) {
      logger.warn(`[${definition.role}] Failed to save long-term memory`, { error: (err as Error).message });
    }
  }
}

const TYPE_LABELS: Record<string, string> = {
  pattern:    'Proven Patterns',
  error_fix:  'Known Fixes',
  decision:   'Prior Decisions',
  failure:    'Past Failures',
  preference: 'Preferences',
  prompt:     'Prompt Strategies',
  context:    'Session Context',
  global:     'Shared Knowledge',
};

/** Format memories into a grouped prompt block. Entries with effectiveness >70% are starred. */
export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';

  const grouped = new Map<string, MemoryEntry[]>();
  for (const m of memories) {
    const bucket = grouped.get(m.type) ?? [];
    bucket.push(m);
    grouped.set(m.type, bucket);
  }

  const lines: string[] = [`## Relevant Memory (${memories.length})\n`];
  for (const [type, entries] of grouped) {
    lines.push(`**${TYPE_LABELS[type] ?? type}:**`);
    for (const e of entries) {
      const star = !isNaN(e.effectiveness) && e.effectiveness > 0.7 ? ' \u2605' : '';
      lines.push(`- ${e.content}${star}`);
    }
  }

  return lines.join('\n') + '\n\n';
}

/** Produce a compact signal-rich summary for short-term storage — avoids persisting raw code blobs. */
export function summariseForShortTerm(
  task: Task,
  output: Record<string, unknown>,
  role: AgentRole,
): string {
  const parts: string[] = [`${role} completed.`];

  for (const [key, val] of Object.entries(output)) {
    if (Array.isArray(val)) {
      if (val.length === 0) continue;
      const items = val.slice(0, 4).map(v => {
        if (typeof v === 'string') return v.slice(0, 60);
        if (typeof v === 'object' && v !== null) {
          const o = v as Record<string, unknown>;
          return String(o.path ?? o.name ?? o.id ?? JSON.stringify(v).slice(0, 50));
        }
        return String(v);
      });
      parts.push(`${key}(${val.length}): [${items.join(', ')}${val.length > 4 ? ', \u2026' : ''}]`);
    } else if (typeof val === 'string' && val.length > 0) {
      parts.push(`${key}: ${val.slice(0, 120)}`);
    } else if (typeof val === 'object' && val !== null) {
      parts.push(`${key}: {${Object.keys(val as object).slice(0, 5).join(', ')}}`);
    }
  }

  return parts.join(' | ').slice(0, 500);
}
