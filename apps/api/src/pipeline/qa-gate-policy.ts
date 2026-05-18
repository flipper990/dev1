import type { QAReport } from './quality-assurance.js';

export interface QaGateDecision {
  passed: boolean;
  threshold: number;
  blockerCount: number;
  errorCount: number;
  warningCount: number;
  reason: string;
}

export function evaluateQaGateDecision(
  report: QAReport,
  input: {
    tier: 'tier1' | 'tier2' | 'tier3';
    pipelineCompleted: boolean;
    minScore?: number;
  },
): QaGateDecision {
  const defaultThresholdByTier: Record<'tier1' | 'tier2' | 'tier3', number> = {
    tier1: 95,
    tier2: 95,
    tier3: 96,
  };
  const threshold = Number.isFinite(input.minScore)
    ? Number(input.minScore)
    : defaultThresholdByTier[input.tier];
  const blockerCount = Array.isArray(report.blockers) ? report.blockers.length : 0;
  const findings = Array.isArray(report.findings) ? report.findings : [];
  const errorCount = findings.filter((f) => f.severity === 'error').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;

  if (!input.pipelineCompleted) {
    return {
      passed: false,
      threshold,
      blockerCount,
      errorCount,
      warningCount,
      reason: 'QA gate failed: pipeline did not reach completed state.',
    };
  }
  if (blockerCount > 0) {
    return {
      passed: false,
      threshold,
      blockerCount,
      errorCount,
      warningCount,
      reason: `QA gate failed: score ${report.score}/100, blockers=${blockerCount}, errors=${errorCount}, warnings=${warningCount}.`,
    };
  }
  if (report.score < threshold) {
    return {
      passed: false,
      threshold,
      blockerCount,
      errorCount,
      warningCount,
      reason: `QA gate failed: score ${report.score}/100 (<${threshold}), blockers=${blockerCount}, errors=${errorCount}, warnings=${warningCount}.`,
    };
  }
  return {
    passed: true,
    threshold,
    blockerCount,
    errorCount,
    warningCount,
    reason: `QA gate passed: score ${report.score}/100 (>=${threshold}), blockers=${blockerCount}, errors=${errorCount}, warnings=${warningCount}.`,
  };
}
