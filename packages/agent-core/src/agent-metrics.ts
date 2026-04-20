// ─────────────────────────────────────────────────────────────
// Agent Metrics — Aggregated performance tracking per agent
// Collects latency percentiles, token usage, costs, errors.
// ─────────────────────────────────────────────────────────────

import type { AgentMetricsSnapshot, AgentRole } from './types';
import type { BaseAgent, Logger } from './base-agent';
import type { MetricsCollector } from './agent-middleware';

// ── Metrics Store ───────────────────────────────────────────

interface RawMetrics {
  totalExecutions: number;
  successCount: number;
  failureCount: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  latencies: number[];
  errorsByCode: Record<string, number>;
  lastExecutedAt?: Date;
}

// ── Agent Metrics Collector ─────────────────────────────────

export class AgentMetrics implements MetricsCollector {
  private store: Map<string, RawMetrics> = new Map();
  private logger: Logger;
  private maxLatencyHistory: number;

  constructor(logger: Logger, maxLatencyHistory = 1000) {
    this.logger = logger;
    this.maxLatencyHistory = maxLatencyHistory;
  }

  /** Record an agent execution (called by middleware or directly) */
  recordExecution(
    role: string,
    durationMs: number,
    success: boolean,
    tokensIn: number,
    tokensOut: number,
  ): void {
    const metrics = this.getOrCreate(role);
    metrics.totalExecutions++;
    metrics.latencies.push(durationMs);
    metrics.totalTokensIn += tokensIn;
    metrics.totalTokensOut += tokensOut;
    metrics.lastExecutedAt = new Date();

    if (success) {
      metrics.successCount++;
    } else {
      metrics.failureCount++;
    }

    // Trim latency history
    if (metrics.latencies.length > this.maxLatencyHistory) {
      metrics.latencies = metrics.latencies.slice(-this.maxLatencyHistory);
    }
  }

  /** Record a specific error code */
  recordError(role: string, code: string): void {
    const metrics = this.getOrCreate(role);
    metrics.errorsByCode[code] = (metrics.errorsByCode[code] ?? 0) + 1;
  }

  /** Record cost */
  recordCost(role: string, costUsd: number): void {
    const metrics = this.getOrCreate(role);
    metrics.totalCostUsd += costUsd;
  }

  /** Get a snapshot for a specific agent */
  getSnapshot(role: AgentRole): AgentMetricsSnapshot {
    const raw = this.store.get(role) ?? this.empty();
    return this.computeSnapshot(role, raw);
  }

  /** Get snapshots for all agents */
  getAllSnapshots(): AgentMetricsSnapshot[] {
    const results: AgentMetricsSnapshot[] = [];
    for (const [role, raw] of this.store) {
      results.push(this.computeSnapshot(role as AgentRole, raw));
    }
    return results;
  }

  /** Pull metrics from an agent's internal counters */
  pullFromAgent(agent: BaseAgent): void {
    const snap = agent.getMetricsSnapshot();
    const metrics = this.getOrCreate(snap.agentRole);

    metrics.totalExecutions = snap.totalExecutions;
    metrics.successCount = snap.successCount;
    metrics.failureCount = snap.failureCount;
    metrics.totalTokensIn = snap.totalTokensIn;
    metrics.totalTokensOut = snap.totalTokensOut;
    metrics.totalCostUsd = snap.totalCostUsd;
    metrics.latencies = snap.latencies;
    metrics.lastExecutedAt = snap.lastExecutedAt;
    metrics.errorsByCode = snap.errorsByCode;
  }

  /** Pull from all agents in a map */
  pullFromAll(agents: Map<AgentRole, BaseAgent>): void {
    for (const agent of agents.values()) {
      this.pullFromAgent(agent);
    }
  }

  /** Get aggregate summary across all agents */
  getSummary(): {
    totalExecutions: number;
    totalSuccess: number;
    totalFailures: number;
    totalTokensIn: number;
    totalTokensOut: number;
    totalCostUsd: number;
    avgLatencyMs: number;
    topErrors: { code: string; count: number }[];
  } {
    let totalExec = 0, totalSuccess = 0, totalFail = 0;
    let totalIn = 0, totalOut = 0, totalCost = 0;
    const allLatencies: number[] = [];
    const allErrors: Record<string, number> = {};

    for (const raw of this.store.values()) {
      totalExec += raw.totalExecutions;
      totalSuccess += raw.successCount;
      totalFail += raw.failureCount;
      totalIn += raw.totalTokensIn;
      totalOut += raw.totalTokensOut;
      totalCost += raw.totalCostUsd;
      allLatencies.push(...raw.latencies);
      for (const [code, count] of Object.entries(raw.errorsByCode)) {
        allErrors[code] = (allErrors[code] ?? 0) + count;
      }
    }

    const topErrors = Object.entries(allErrors)
      .map(([code, count]) => ({ code, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    return {
      totalExecutions: totalExec,
      totalSuccess,
      totalFailures: totalFail,
      totalTokensIn: totalIn,
      totalTokensOut: totalOut,
      totalCostUsd: totalCost,
      avgLatencyMs: allLatencies.length > 0
        ? allLatencies.reduce((a, b) => a + b, 0) / allLatencies.length
        : 0,
      topErrors,
    };
  }

  /** Reset metrics for an agent */
  reset(role: AgentRole): void {
    this.store.delete(role);
  }

  /** Reset all metrics */
  resetAll(): void {
    this.store.clear();
  }

  // ── Private Helpers ────────────────────────────────────

  private getOrCreate(role: string): RawMetrics {
    if (!this.store.has(role)) {
      this.store.set(role, this.empty());
    }
    return this.store.get(role)!;
  }

  private empty(): RawMetrics {
    return {
      totalExecutions: 0,
      successCount: 0,
      failureCount: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      totalCostUsd: 0,
      latencies: [],
      errorsByCode: {},
    };
  }

  private computeSnapshot(role: AgentRole, raw: RawMetrics): AgentMetricsSnapshot {
    const sorted = [...raw.latencies].sort((a, b) => a - b);
    const len = sorted.length;

    return {
      agentRole: role,
      totalExecutions: raw.totalExecutions,
      successCount: raw.successCount,
      failureCount: raw.failureCount,
      retryCount: 0, // computed from agents directly
      totalTokensIn: raw.totalTokensIn,
      totalTokensOut: raw.totalTokensOut,
      totalCostUsd: raw.totalCostUsd,
      avgLatencyMs: len > 0 ? sorted.reduce((a, b) => a + b, 0) / len : 0,
      p95LatencyMs: len > 0 ? sorted[Math.floor(len * 0.95)] ?? sorted[len - 1] : 0,
      p99LatencyMs: len > 0 ? sorted[Math.floor(len * 0.99)] ?? sorted[len - 1] : 0,
      lastExecutedAt: raw.lastExecutedAt,
      errorsByCode: { ...raw.errorsByCode },
    };
  }
}
