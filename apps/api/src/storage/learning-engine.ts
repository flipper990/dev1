// ─────────────────────────────────────────────────────────────
// Learning Engine — Observes outcomes and improves memory over time
//
// Responsibilities:
//   1. Record which memories were used for a task
//   2. After task completes, record success/failure for those memories
//   3. Detect repeated failure patterns and create failure memories
//   4. Promote high-performing patterns to global memory
//   5. Track prompt effectiveness (which prompts led to best outcomes)
//   6. Periodic consolidation of related memories
// ─────────────────────────────────────────────────────────────

import type {
  AgentRole,
  MemoryEntry,
  MemoryType,
  MemoryTag,
  Task,
} from '../../../packages/agent-core/src/types.js';
import type {
  MemoryStore,
  MemoryEntryInput,
  Logger,
} from '../../../packages/agent-core/src/base-agent.js';

// ── Session Observation Tracking ────────────────────────────

interface TaskObservation {
  taskId: string;
  agentRole: AgentRole;
  sessionId: string;
  /** IDs of memory entries that were loaded for this task. */
  usedMemoryIds: string[];
  /** The prompt that was sent to the LLM. */
  promptHash?: string;
  /** Timestamp when task started. */
  startedAt: Date;
}

interface PromptRecord {
  agentRole: AgentRole;
  promptHash: string;
  /** Summary of the prompt strategy (not the full prompt). */
  strategy: string;
  successCount: number;
  failureCount: number;
  totalLatencyMs: number;
  lastUsedAt: Date;
}

// ── Learning Engine ─────────────────────────────────────────

export class LearningEngine {
  private memory: MemoryStore;
  private logger: Logger;

  // Active observations (taskId → observation)
  private observations = new Map<string, TaskObservation>();

  // Prompt effectiveness tracking
  private promptRecords = new Map<string, PromptRecord>();

  // Failure pattern accumulator (agentRole:errorCode → count)
  private failureAccumulator = new Map<string, { count: number; lastError: string; lastTaskId: string }>();

  // Thresholds
  private readonly PROMOTION_THRESHOLD = 3;     // successes before promoting to global
  private readonly FAILURE_PATTERN_THRESHOLD = 3; // repeated failures before creating failure memory
  private readonly PROMPT_TRACKING_ENABLED = true;

  constructor(memory: MemoryStore, logger: Logger) {
    this.memory = memory;
    this.logger = logger;
  }

  // ── Observation Lifecycle ─────────────────────────────

  /**
   * Call when an agent starts executing a task.
   * Records which memories were provided to the agent.
   */
  observeTaskStart(task: Task, usedMemories: MemoryEntry[], promptHash?: string): void {
    this.observations.set(task.id, {
      taskId: task.id,
      agentRole: task.agentRole,
      sessionId: task.sessionId,
      usedMemoryIds: usedMemories.map(m => m.id),
      promptHash,
      startedAt: new Date(),
    });
  }

  /**
   * Call when a task completes (success or failure).
   * Updates effectiveness scores for all memories that were used.
   */
  async observeTaskEnd(task: Task): Promise<void> {
    const observation = this.observations.get(task.id);
    if (!observation) return;
    this.observations.delete(task.id);

    const success = task.status === 'completed';
    const latencyMs = task.metadata?.latencyMs as number ?? 0;

    // 1. Record outcomes for all used memories
    for (const memId of observation.usedMemoryIds) {
      await this.memory.recordOutcome(memId, success);
    }

    // 2. Track prompt effectiveness
    if (this.PROMPT_TRACKING_ENABLED && observation.promptHash) {
      this.recordPromptOutcome(observation.agentRole, observation.promptHash, success, latencyMs);
    }

    // 3. Handle failures
    if (!success) {
      await this.handleFailure(task, observation);
    }

    // 4. Check if any used memories should be promoted to global
    if (success) {
      await this.checkForPromotions(observation);
    }

    this.logger.debug(`Learning recorded for task ${task.id}`, {
      agentRole: observation.agentRole,
      success,
      memoriesUsed: observation.usedMemoryIds.length,
    });
  }

  // ── Failure Detection ─────────────────────────────────

  private async handleFailure(task: Task, observation: TaskObservation): Promise<void> {
    const errorCode = task.error?.code ?? 'UNKNOWN';
    const accKey = `${observation.agentRole}:${errorCode}`;

    const acc = this.failureAccumulator.get(accKey) ?? { count: 0, lastError: '', lastTaskId: '' };
    acc.count++;
    acc.lastError = task.error?.message ?? 'Unknown error';
    acc.lastTaskId = task.id;
    this.failureAccumulator.set(accKey, acc);

    // If we see the same failure pattern N times, create a failure memory
    if (acc.count >= this.FAILURE_PATTERN_THRESHOLD) {
      const failureEntry: MemoryEntryInput = {
        agentRole: observation.agentRole,
        type: 'failure',
        content: `Repeated failure (${acc.count}x): ${errorCode} — ${acc.lastError}`,
        relevanceScore: 1.2,
        tags: ['error-handling', errorCode.toLowerCase() as MemoryTag],
        metadata: {
          errorCode,
          occurrences: acc.count,
          lastTaskId: acc.lastTaskId,
        },
      };

      await this.memory.saveLongTerm(failureEntry);

      // Also save to global so other agents can learn from it
      await this.memory.saveGlobal({
        ...failureEntry,
        agentRole: 'global',
        relevanceScore: 1.0,
        metadata: {
          ...failureEntry.metadata,
          originAgent: observation.agentRole,
        },
      });

      this.logger.info(`Created failure pattern memory for ${accKey} (${acc.count} occurrences)`);

      // Reset accumulator after creating the memory
      this.failureAccumulator.delete(accKey);
    }
  }

  // ── Promotion to Global ───────────────────────────────

  private async checkForPromotions(observation: TaskObservation): Promise<void> {
    // Query the agent's memories that have high effectiveness
    const candidates = await this.memory.query({
      roles: [observation.agentRole],
      types: ['pattern', 'error_fix', 'decision'],
      minEffectiveness: 0.8,
      minRelevance: 0.5,
      limit: 5,
    });

    for (const candidate of candidates) {
      const total = candidate.successCount + candidate.failureCount;
      if (total >= this.PROMOTION_THRESHOLD && candidate.effectiveness >= 0.8) {
        // Check if already in global
        const existing = await this.memory.getGlobal({
          types: [candidate.type],
          limit: 50,
        });

        const alreadyGlobal = existing.some(e =>
          e.content === candidate.content ||
          (e.metadata?.originAgent === observation.agentRole && e.metadata?.originEntryId === candidate.id),
        );

        if (!alreadyGlobal) {
          await this.memory.saveGlobal({
            agentRole: 'global',
            type: candidate.type,
            content: candidate.content,
            relevanceScore: candidate.relevanceScore * 0.9,
            tags: [...candidate.tags, 'best-practice'],
            metadata: {
              ...candidate.metadata,
              originAgent: observation.agentRole,
              originEntryId: candidate.id,
              effectiveness: candidate.effectiveness,
              promotedAt: new Date().toISOString(),
            },
          });

          this.logger.info(`Promoted memory to global`, {
            agentRole: observation.agentRole,
            type: candidate.type,
            effectiveness: candidate.effectiveness,
          });
        }
      }
    }
  }

  // ── Prompt Effectiveness ──────────────────────────────

  private recordPromptOutcome(
    agentRole: AgentRole,
    promptHash: string,
    success: boolean,
    latencyMs: number,
  ): void {
    const key = `${agentRole}:${promptHash}`;
    const record = this.promptRecords.get(key) ?? {
      agentRole,
      promptHash,
      strategy: '',
      successCount: 0,
      failureCount: 0,
      totalLatencyMs: 0,
      lastUsedAt: new Date(),
    };

    if (success) record.successCount++;
    else record.failureCount++;
    record.totalLatencyMs += latencyMs;
    record.lastUsedAt = new Date();

    this.promptRecords.set(key, record);
  }

  /**
   * Record a prompt strategy description for a given hash.
   * Called by agents when they build their prompt.
   */
  setPromptStrategy(agentRole: AgentRole, promptHash: string, strategy: string): void {
    const key = `${agentRole}:${promptHash}`;
    const record = this.promptRecords.get(key);
    if (record) record.strategy = strategy;
  }

  /** Get the best-performing prompt strategies for an agent. */
  getBestPrompts(agentRole: AgentRole, limit = 5): PromptRecord[] {
    const records: PromptRecord[] = [];
    for (const [key, record] of this.promptRecords) {
      if (key.startsWith(`${agentRole}:`)) {
        records.push(record);
      }
    }

    return records
      .filter(r => r.successCount + r.failureCount >= 2) // need enough data
      .sort((a, b) => {
        const effA = a.successCount / (a.successCount + a.failureCount);
        const effB = b.successCount / (b.successCount + b.failureCount);
        return effB - effA;
      })
      .slice(0, limit);
  }

  /**
   * Save the best prompt patterns as memories for future sessions.
   * Call periodically (e.g., after each generation pipeline).
   */
  async persistPromptLearnings(): Promise<number> {
    let saved = 0;

    for (const record of this.promptRecords.values()) {
      const total = record.successCount + record.failureCount;
      if (total < 3 || !record.strategy) continue;

      const effectiveness = record.successCount / total;
      if (effectiveness >= 0.7) {
        const avgLatency = record.totalLatencyMs / total;
        await this.memory.saveLongTerm({
          agentRole: record.agentRole,
          type: 'prompt',
          content: `Effective prompt strategy (${(effectiveness * 100).toFixed(0)}% success, avg ${avgLatency.toFixed(0)}ms): ${record.strategy}`,
          relevanceScore: 0.8 + effectiveness * 0.4,
          tags: ['prompt-engineering'],
          metadata: {
            promptHash: record.promptHash,
            effectiveness,
            avgLatencyMs: avgLatency,
            sampleSize: total,
          },
        });
        saved++;
      }
    }

    if (saved > 0) {
      this.logger.info(`Persisted ${saved} prompt learnings`);
    }
    return saved;
  }

  // ── Consolidation ─────────────────────────────────────

  /**
   * Merge related memories to reduce noise and strengthen patterns.
   * Call periodically (e.g., daily).
   */
  async consolidate(agentRole: AgentRole): Promise<{ merged: number; pruned: number }> {
    const entries = await this.memory.query({
      roles: [agentRole],
      types: ['pattern', 'decision'],
      minRelevance: 0.2,
      limit: 100,
    });

    let merged = 0;
    let pruned = 0;

    // Group by tags for related-entry detection
    const tagGroups = new Map<string, MemoryEntry[]>();
    for (const entry of entries) {
      for (const tag of entry.tags) {
        const group = tagGroups.get(tag) ?? [];
        group.push(entry);
        tagGroups.set(tag, group);
      }
    }

    // Find entries in the same tag group that are similar
    const mergedIds = new Set<string>();
    for (const group of tagGroups.values()) {
      if (group.length < 2) continue;

      for (let i = 0; i < group.length; i++) {
        if (mergedIds.has(group[i].id)) continue;
        for (let j = i + 1; j < group.length; j++) {
          if (mergedIds.has(group[j].id)) continue;

          // If two entries are very similar and same type, merge
          const sim = jaccardSimilarity(group[i].content, group[j].content);
          if (sim > 0.6 && group[i].type === group[j].type) {
            // Keep the one with higher effectiveness/relevance
            const keep = this.pickStronger(group[i], group[j]);
            const drop = keep === group[i] ? group[j] : group[i];

            // Merge data from dropped into kept
            keep.accessCount += drop.accessCount;
            keep.successCount += drop.successCount;
            keep.failureCount += drop.failureCount;
            const total = keep.successCount + keep.failureCount;
            keep.effectiveness = total > 0 ? keep.successCount / total : NaN;
            keep.relevanceScore = Math.min(keep.relevanceScore + 0.1, 2.0);

            // Merge tags
            const tagSet = new Set([...keep.tags, ...drop.tags]);
            keep.tags = [...tagSet];

            mergedIds.add(drop.id);
            merged++;
          }
        }
      }
    }

    // Prune very low-effectiveness entries
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

    this.logger.info(`Consolidation for ${agentRole}`, { merged, pruned });
    return { merged, pruned };
  }

  private pickStronger(a: MemoryEntry, b: MemoryEntry): MemoryEntry {
    if (!isNaN(a.effectiveness) && !isNaN(b.effectiveness)) {
      if (a.effectiveness !== b.effectiveness) return a.effectiveness > b.effectiveness ? a : b;
    }
    return a.relevanceScore >= b.relevanceScore ? a : b;
  }

  // ── Stats ─────────────────────────────────────────────

  getObservationCount(): number {
    return this.observations.size;
  }

  getPromptRecordCount(): number {
    return this.promptRecords.size;
  }

  getFailureAccumulatorSnapshot(): Record<string, number> {
    const snapshot: Record<string, number> = {};
    for (const [key, val] of this.failureAccumulator) {
      snapshot[key] = val.count;
    }
    return snapshot;
  }
}

// ── Utility ─────────────────────────────────────────────

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(w => w.length > 2));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
