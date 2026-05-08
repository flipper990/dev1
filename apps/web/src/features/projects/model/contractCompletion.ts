import type { GeneratedProject } from '../../../../types/dashboard';
import type {
  CompletionMetrics,
  CompletionReport,
  GateResult,
  ProjectContract,
  RequirementCoverageItem,
} from '../../../../types/projectContract';

function safeArray<T>(value: T[] | undefined | null): T[] {
  return Array.isArray(value) ? value : [];
}

export function deriveCompletionMetrics(args: {
  contract: ProjectContract | null;
  coverage: RequirementCoverageItem[];
  flowChecksPassed: number;
  flowChecksTotal: number;
  project: GeneratedProject | null;
}): CompletionMetrics {
  const { contract, coverage, flowChecksPassed, flowChecksTotal, project } = args;

  const requiredIds = new Set(
    safeArray(contract?.features).filter((f) => f.required).map((f) => f.id),
  );

  const requiredCoverage = coverage.filter((item) => requiredIds.has(item.requirementId));
  const requiredVerified = requiredCoverage.filter((item) => item.status === 'verified').length;
  const requiredSatisfiedPct =
    requiredCoverage.length === 0 ? 0 : Math.round((requiredVerified / requiredCoverage.length) * 100);

  const criticalFailuresCount = coverage.filter((item) => item.status === 'failed').length;

  const flowPassRate = flowChecksTotal > 0 ? Math.round((flowChecksPassed / flowChecksTotal) * 100) : 0;

  const runtimeHealth: CompletionMetrics['runtimeHealth'] =
    project?.preview?.previewStatus === 'failed'
      ? 'failed'
      : project?.runtimeValidation?.finalVerdict === 'pass'
        ? 'healthy'
        : 'degraded';

  return {
    requiredSatisfiedPct,
    criticalFailuresCount,
    flowPassRate,
    runtimeHealth,
  };
}

export function deriveCompletionReport(args: {
  contract: ProjectContract | null;
  coverage: RequirementCoverageItem[];
  gates: GateResult[];
  metrics: CompletionMetrics;
}): CompletionReport {
  const { contract, coverage, gates, metrics } = args;

  const requiredIds = new Set(
    safeArray(contract?.features).filter((f) => f.required).map((f) => f.id),
  );

  const unresolvedRequiredIds = coverage
    .filter((item) => requiredIds.has(item.requirementId))
    .filter((item) => item.status !== 'verified')
    .map((item) => item.requirementId);

  const hasCriticalGateFailure = gates.some((gate) => gate.critical && !gate.passed);

  const canComplete =
    metrics.requiredSatisfiedPct === 100 &&
    metrics.criticalFailuresCount === 0 &&
    metrics.flowPassRate === 100 &&
    metrics.runtimeHealth !== 'failed' &&
    !hasCriticalGateFailure &&
    unresolvedRequiredIds.length === 0;

  return {
    metrics,
    gates,
    unresolvedRequiredIds,
    canComplete,
  };
}
