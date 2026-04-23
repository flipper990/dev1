/**
 * Per-project cost control.
 *
 * Responsibilities:
 *   - Decide whether a new pipeline run should be allowed (pre-flight).
 *   - Emit structured warnings while a run is in progress once cumulative
 *     usage crosses the warning threshold.
 *   - Provide a usage snapshot (generations, cost, tokens, % of limits) that
 *     can be logged / surfaced in events / returned from APIs.
 *   - Prevent duplicate concurrent pipelines on the same project.
 *
 * Limits resolve in this order:
 *   1. project.limits.maxGenerations / maxCostUsd  (per-project override)
 *   2. config.limits.maxGenerationsPerProject / maxCostPerProjectUsd
 *
 * Nothing here calls the LLM — it is a pure guard. The Orchestrator invokes
 * `assertWithinLimits` before every run and `checkWarning` after each step.
 */

import { config, CostLimitError } from '@devteam/core';
import type { Project } from '@devteam/core';

export interface UsageSnapshot {
  generations:     number;
  generationLimit: number;
  generationPct:   number;  // 0..1
  costUsd:         number;
  costLimitUsd:    number;
  costPct:         number;  // 0..1
  tokensUsed:      number;
  /** Highest pct among tracked metrics — drives the warning threshold. */
  maxPct:          number;
  nearLimit:       boolean; // any metric >= warn threshold
  exceeded:        boolean; // any metric >= 1
}

function resolveLimits(project: Project): { maxGenerations: number; maxCostUsd: number } {
  const override = project.limits ?? {};
  return {
    maxGenerations: override.maxGenerations ?? config.limits.maxGenerationsPerProject,
    maxCostUsd:     override.maxCostUsd     ?? config.limits.maxCostPerProjectUsd,
  };
}

export function evaluateUsage(project: Project, pendingCostDeltaUsd = 0): UsageSnapshot {
  const { maxGenerations, maxCostUsd } = resolveLimits(project);
  const generations  = project.generationCount ?? 0;
  const costUsd      = (project.costUsd ?? 0) + Math.max(0, pendingCostDeltaUsd);
  const tokensUsed   = project.tokensUsed ?? 0;

  const generationPct = maxGenerations > 0 ? generations / maxGenerations : 0;
  const costPct       = maxCostUsd     > 0 ? costUsd     / maxCostUsd     : 0;
  const maxPct        = Math.max(generationPct, costPct);

  return {
    generations,
    generationLimit: maxGenerations,
    generationPct,
    costUsd,
    costLimitUsd: maxCostUsd,
    costPct,
    tokensUsed,
    maxPct,
    nearLimit: maxPct >= config.limits.warnThresholdPct,
    exceeded:  generationPct >= 1 || costPct >= 1,
  };
}

/**
 * Pre-flight: throw if starting a new run would violate either limit.
 * Called BEFORE the pipeline actually consumes tokens.
 */
export function assertWithinLimits(project: Project): UsageSnapshot {
  const usage = evaluateUsage(project);

  if (usage.generations >= usage.generationLimit) {
    throw new CostLimitError(
      `Project has reached its generation limit (${usage.generations}/${usage.generationLimit}). ` +
        `Increase the per-project limit or create a new project.`,
      'generation_count',
      usage.generations,
      usage.generationLimit,
    );
  }

  if (usage.costUsd >= usage.costLimitUsd) {
    throw new CostLimitError(
      `Project has reached its cost cap ($${usage.costUsd.toFixed(4)} / $${usage.costLimitUsd.toFixed(2)}). ` +
        `Further generations are blocked.`,
      'cost_usd',
      usage.costUsd,
      usage.costLimitUsd,
    );
  }

  return usage;
}

/**
 * Mid-run: check whether the current in-progress cost has crossed the limit.
 * Returns a reason string if execution should stop; `null` otherwise.
 */
export function checkMidRunLimit(project: Project, inFlightCostDeltaUsd: number): string | null {
  const usage = evaluateUsage(project, inFlightCostDeltaUsd);
  if (usage.costUsd >= usage.costLimitUsd) {
    return `Cost cap exceeded mid-run ($${usage.costUsd.toFixed(4)} / $${usage.costLimitUsd.toFixed(2)}) — aborting remaining steps.`;
  }
  return null;
}

// ─── Duplicate-work prevention ────────────────────────────────────────────────

// Active session ids keyed by projectId. Prevents two pipelines running at
// once for the same project (which would race each other on artifact writes).
const ACTIVE_PROJECT_LOCKS = new Map<string, string>();

export function acquireProjectLock(projectId: string, sessionId: string): void {
  const existing = ACTIVE_PROJECT_LOCKS.get(projectId);
  if (existing && existing !== sessionId) {
    throw new CostLimitError(
      `Another pipeline is already running for this project (session ${existing}). ` +
        `Wait for it to finish before starting another run.`,
      'generation_count',
      1,
      1,
    );
  }
  ACTIVE_PROJECT_LOCKS.set(projectId, sessionId);
}

export function releaseProjectLock(projectId: string, sessionId: string): void {
  const existing = ACTIVE_PROJECT_LOCKS.get(projectId);
  if (existing === sessionId) ACTIVE_PROJECT_LOCKS.delete(projectId);
}

export function isProjectLocked(projectId: string): boolean {
  return ACTIVE_PROJECT_LOCKS.has(projectId);
}
