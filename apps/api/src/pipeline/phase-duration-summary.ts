import type { PipelineRunLedger } from './pipeline-ledger.js';

export interface PhaseDurationSummary {
  phaseDurations: Record<string, number>;
  slowestPhasesTop5: Array<{ phase: string; durationMs: number }>;
}

function normalizePhaseBucket(phase: string, stepId: string): string {
  const p = `${phase} ${stepId}`.toLowerCase();
  if (p.includes('spec')) return 'spec';
  if (p.includes('builder')) return 'builder';
  if (p.includes('polish')) return 'polish';
  if (p.includes('qa')) return 'qa';
  if (p.includes('import-repair')) return 'import_repair';
  if (p.includes('dependency') || p.includes('dep')) return 'dependency_reconciliation';
  if (p.includes('deterministic-contract') || p.includes('contract')) return 'contract_validation';
  if (p.includes('integrity')) return 'final_integrity';
  if (p.includes('execution-validation')) return 'execution_validation';
  if (p.includes('runtime-validation') || p.includes('preview')) return 'preview_startup';
  if (p.includes('export')) return 'export';
  return phase || 'unknown';
}

export function summarizePhaseDurationsFromLedger(ledger: PipelineRunLedger | undefined): PhaseDurationSummary {
  const phaseDurations: Record<string, number> = {};
  if (!ledger) return { phaseDurations, slowestPhasesTop5: [] };

  for (const r of ledger.records) {
    if (typeof r.durationMs !== 'number' || r.durationMs <= 0) continue;
    const bucket = normalizePhaseBucket(r.phase, r.stepId);
    phaseDurations[bucket] = (phaseDurations[bucket] ?? 0) + r.durationMs;
  }

  const slowestPhasesTop5 = Object.entries(phaseDurations)
    .map(([phase, durationMs]) => ({ phase, durationMs }))
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 5);

  return { phaseDurations, slowestPhasesTop5 };
}

