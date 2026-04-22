// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Learning Engine â€” Observes outcomes and improves memory over time
//
// Responsibilities:
//   1. Record which memories were used for a task
//   2. After task completes, record success/failure for those memories
//   3. Detect repeated failure patterns and create failure memories
//   4. Promote high-performing patterns to global memory
//   5. Track prompt effectiveness (which prompts led to best outcomes)
//   6. Periodic consolidation of related memories
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type {
  AgentRole,
  MemoryEntry,
  MemoryType,
  MemoryTag,
  Task,
} from '../../../../packages/agent-core/src/types.js';
import type {
  MemoryStore,
  MemoryEntryInput,
  Logger,
} from '../../../../packages/agent-core/src/base-agent.js';
import { consolidate, handleTaskFailure, checkMemoryPromotions } from './learning-consolidator.js';

// â”€â”€ Session Observation Tracking â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€ Learning Engine â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class LearningEngine {
  private memory: MemoryStore;
  private logger: Logger;

  // Active observations (taskId â†’ observation)
  private observations = new Map<string, TaskObservation>();

  // Prompt effectiveness tracking
  private promptRecords = new Map<string, PromptRecord>();

  // Failure pattern accumulator (agentRole:errorCode â†’ count)
  private failureAccumulator = new Map<string, { count: number; lastError: string; lastTaskId: string }>();

  // Thresholds
  private readonly PROMOTION_THRESHOLD = 3;     // successes before promoting to global
  private readonly FAILURE_PATTERN_THRESHOLD = 3; // repeated failures before creating failure memory
  private readonly PROMPT_TRACKING_ENABLED = true;

  constructor(memory: MemoryStore, logger: Logger) {
    this.memory = memory;
    this.logger = logger;
  }

  // â”€â”€ Observation Lifecycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Failure Detection â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async handleFailure(task: Task, observation: TaskObservation): Promise<void> {
    await handleTaskFailure(task, observation.agentRole, this.failureAccumulator, this.FAILURE_PATTERN_THRESHOLD, this.memory, this.logger);
  }

  // â”€â”€ Promotion to Global â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private async checkForPromotions(observation: TaskObservation): Promise<void> {
    await checkMemoryPromotions(observation.agentRole, this.PROMOTION_THRESHOLD, this.memory, this.logger);
  }

  // â”€â”€ Prompt Effectiveness â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

  // â”€â”€ Consolidation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Merge related memories to reduce noise and strengthen patterns. Call periodically (e.g., daily). */
  async consolidate(agentRole: AgentRole): Promise<{ merged: number; pruned: number }> {
    return consolidate(agentRole, this.memory, this.logger);
  }

  // â”€â”€ Stats â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
