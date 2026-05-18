import type { ProjectRecord } from '../storage/project-store.js';
import { classifyGenerationFailure, type GenerationFailureClassification } from './generation-failure-classifier.js';

export type ZeroFileClassification =
  | 'provider_empty_output'
  | 'builder_empty_output'
  | 'manifest_parse_failure'
  | 'contract_rejected_all_files'
  | 'artifact_assembly_failure'
  | 'generation_timeout'
  | 'provider_error'
  | 'orchestration_abort'
  | 'fallback_failed';

export interface StructuredFailureArgs {
  project: ProjectRecord;
  failedPhase: string;
  failedStep: string;
  failedAgent: string;
  failureReason: string;
  retryCount?: number;
  filesGeneratedBeforeFailure?: number;
  recoveryAttempted?: boolean;
}

function normalizeClassification(classification: GenerationFailureClassification): GenerationFailureClassification {
  if (classification.category !== 'unknown') return classification;
  return {
    category: 'orchestration_failure',
    code: 'UNCLASSIFIED_PIPELINE_FAILURE',
    reason: classification.reason || 'Unclassified failure defaulted to orchestration failure.',
  };
}

export function classifyZeroFileFailure(input: {
  failureReason: string;
  failedPhase?: string;
  failedStep?: string;
  records?: Array<{ errorCode?: string | null; errorMessage?: string | null; status?: string }>;
}): ZeroFileClassification {
  const source = [
    input.failureReason ?? '',
    input.failedPhase ?? '',
    input.failedStep ?? '',
    ...(input.records ?? []).flatMap((r) => [r.errorCode ?? '', r.errorMessage ?? '', r.status ?? '']),
  ].join(' ').toLowerCase();

  if (/\b(builder_empty|produced no files|builder produced no files)\b/.test(source)) return 'builder_empty_output';
  if (/\b(provider returned empty|empty completion|no content|empty output)\b/.test(source)) return 'provider_empty_output';
  if (/\b(manifest|json parse|parse failed|schema parse)\b/.test(source)) return 'manifest_parse_failure';
  if (/\b(contract|deterministic generation contract|rejected all files|dangling internal import|integrity gate)\b/.test(source)) {
    return 'contract_rejected_all_files';
  }
  if (/\b(timeout|timed out|watchdog|stalled)\b/.test(source)) return 'generation_timeout';
  if (/\b(rate limit|429|quota|provider unavailable|api key|authentication)\b/.test(source)) return 'provider_error';
  if (/\bfallback\b/.test(source) && /\bfailed\b/.test(source)) return 'fallback_failed';
  if (/\b(orchestrator|pipeline did not reach|aborted|cancelled)\b/.test(source)) return 'orchestration_abort';
  if (/\b(assemble|assembly|merge cumulative artifacts|artifact)\b/.test(source)) return 'artifact_assembly_failure';
  return 'orchestration_abort';
}

export function recommendNextAction(input: {
  classification: GenerationFailureClassification;
  zeroFileClassification: ZeroFileClassification | null;
}): string {
  if (input.zeroFileClassification === 'builder_empty_output') {
    return 'Inspect builder output/validation logs for the first empty slice and trigger reduced-prompt fallback with explicit file contract.';
  }
  if (input.zeroFileClassification === 'provider_error' || input.classification.category === 'provider_failure') {
    return 'Verify provider health/quota/auth and retry once provider preflight is healthy.';
  }
  if (input.zeroFileClassification === 'contract_rejected_all_files') {
    return 'Review deterministic contract violations and fix rejected imports/paths before retrying generation.';
  }
  if (input.classification.category === 'dependency_failure') {
    return 'Fix dependency graph/package manifest issues and rerun mission.';
  }
  if (input.classification.category === 'dependency_install_failure') {
    return 'Inspect generated package.json + install logs, repair dependency conflicts, then rerun.';
  }
  if (input.classification.category === 'generated_typescript_error') {
    return 'Fix generated TypeScript compile errors before rerunning preview/export validation.';
  }
  if (input.classification.category === 'generated_import_export_mismatch') {
    return 'Fix generated import/export contract mismatches (missing named/default exports) before rerunning preview/export validation.';
  }
  if (input.classification.category === 'generated_app_build_failure') {
    return 'Inspect generated build logs and resolve compile/runtime build blockers before retry.';
  }
  if (input.classification.category === 'preview_runner_internal_error') {
    return 'Fix preview-runner internal crash path and validate failure snapshots/classification.';
  }
  if (input.classification.category === 'tier1_scope_violation') {
    return 'Exclude backend/runtime artifacts from Tier 1 final files and rerun deterministic contract.';
  }
  if (input.classification.category === 'timeout') {
    return 'Inspect watchdog/session heartbeat timeline and unblock the stalled phase before rerun.';
  }
  return 'Inspect phase timeline + failed step diagnostics and rerun only after the first failing step has a concrete fix.';
}

function latestCheckpoint(project: ProjectRecord): string | null {
  const checkpoints = project.diagnostics?.generationCheckpoints as Array<{
    id?: string;
    phase?: string;
    step?: string;
    status?: string;
  }> | undefined;
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) return null;
  const last = checkpoints[checkpoints.length - 1];
  return last?.id ?? (last?.phase && last?.step ? `${last.phase}:${last.step}` : null);
}

function toTrace(project: ProjectRecord, failureReason: string, zeroFileClassification: ZeroFileClassification | null) {
  const records = (((project.diagnostics?.pipelineLedger as { records?: unknown } | undefined)?.records ?? []) as Array<{
    phase?: string;
    stepId?: string;
    agentRole?: string;
    status?: string;
    attempt?: number;
    startedAt?: string | null;
    completedAt?: string | null;
    durationMs?: number | null;
    model?: string | null;
    provider?: string | null;
    errorCode?: string | null;
    errorMessage?: string | null;
    retryCount?: number;
    validationResult?: { verdict?: string; issueCount?: number; repairCount?: number } | null;
    outputArtifactSummary?: string | null;
  }>).slice(-64);
  const checkpoints = (Array.isArray(project.diagnostics?.generationCheckpoints)
    ? project.diagnostics?.generationCheckpoints
    : []).slice(-16);
  const filesAccepted = Array.isArray(project.files) ? project.files.length : 0;
  const filesRejected = records.filter((r) => r.status === 'failed' || r.status === 'blocked').length;
  const fallbackAttempts = records.filter((r) => /fallback/i.test(`${r.stepId ?? ''} ${r.errorCode ?? ''} ${r.errorMessage ?? ''}`)).length;

  return {
    capturedAt: new Date().toISOString(),
    failureReason,
    zeroFileClassification,
    phaseTimeline: records.map((r) => ({
      phase: r.phase ?? 'unknown',
      stepId: r.stepId ?? 'unknown',
      agentRole: r.agentRole ?? 'unknown',
      status: r.status ?? 'unknown',
      attempt: Number.isFinite(r.attempt) ? Number(r.attempt) : 0,
      startedAt: r.startedAt ?? null,
      completedAt: r.completedAt ?? null,
      durationMs: Number.isFinite(r.durationMs) ? Number(r.durationMs) : null,
      model: r.model ?? null,
      provider: r.provider ?? null,
      errorCode: r.errorCode ?? null,
      errorMessage: r.errorMessage ?? null,
      retryCount: Number.isFinite(r.retryCount) ? Number(r.retryCount) : 0,
    })),
    agentOutputsSummary: records.map((r) => ({
      agentRole: r.agentRole ?? 'unknown',
      phase: r.phase ?? 'unknown',
      status: r.status ?? 'unknown',
      outputArtifactSummary: r.outputArtifactSummary ?? null,
    })),
    validationDecisions: records.map((r) => ({
      stepId: r.stepId ?? 'unknown',
      status: r.status ?? 'unknown',
      errorCode: r.errorCode ?? null,
      errorMessage: r.errorMessage ?? null,
      validationVerdict: r.validationResult?.verdict ?? null,
      validationIssueCount: Number.isFinite(r.validationResult?.issueCount) ? Number(r.validationResult?.issueCount) : null,
      validationRepairCount: Number.isFinite(r.validationResult?.repairCount) ? Number(r.validationResult?.repairCount) : null,
    })),
    checkpoints: checkpoints.map((c) => ({
      id: c.id,
      phase: c.phase,
      step: c.step,
      status: c.status,
      at: c.at,
      fileCount: c.fileCount,
      sliceIndex: c.sliceIndex ?? null,
      sliceCount: c.sliceCount ?? null,
    })),
    filesAccepted,
    filesRejected,
    fallbackAttempts,
  };
}

export function buildStructuredFailureDiagnostics(args: StructuredFailureArgs): {
  classification: GenerationFailureClassification;
  zeroFileClassification: ZeroFileClassification | null;
  failure: Required<Pick<NonNullable<ProjectRecord['failure']>,
    | 'failureCategory'
    | 'failurePhase'
    | 'failureReason'
    | 'failedAgent'
    | 'failedStep'
    | 'retryCount'
    | 'lastValidCheckpoint'
    | 'filesGeneratedBeforeFailure'
    | 'recoveryAttempted'
    | 'recommendedNextAction'
    | 'zeroFileClassification'>>;
  trace: ProjectRecord['diagnostics'] extends { generationFailureTrace?: infer T } ? T : Record<string, unknown>;
} {
  const classification = normalizeClassification(classifyGenerationFailure({
    failedPhase: args.failedPhase,
    failedStep: args.failedStep,
    errorMessage: args.failureReason,
  }));
  const filesGeneratedBeforeFailure =
    Number.isFinite(args.filesGeneratedBeforeFailure) ? Number(args.filesGeneratedBeforeFailure) : (args.project.files?.length ?? 0);
  const records = (((args.project.diagnostics?.pipelineLedger as { records?: unknown } | undefined)?.records ?? []) as Array<{
    errorCode?: string | null;
    errorMessage?: string | null;
    status?: string;
  }>);
  const zeroFileClassification =
    filesGeneratedBeforeFailure <= 0
      ? classifyZeroFileFailure({
          failureReason: args.failureReason,
          failedPhase: args.failedPhase,
          failedStep: args.failedStep,
          records,
        })
      : null;
  const nextAction = recommendNextAction({ classification, zeroFileClassification });
  const retryCount = Number.isFinite(args.retryCount) ? Number(args.retryCount) : 0;
  const checkpoint = latestCheckpoint(args.project);
  const recoveredFromCheckpoints = Array.isArray(args.project.diagnostics?.generationCheckpoints)
    && (args.project.diagnostics?.generationCheckpoints as Array<{ status?: string }>).some((c) => c.status === 'recovered');
  const recoveryAttempted = Boolean(args.recoveryAttempted || recoveredFromCheckpoints);
  const traceCore = toTrace(args.project, args.failureReason, zeroFileClassification);

  return {
    classification,
    zeroFileClassification,
    failure: {
      failureCategory: classification.category,
      failurePhase: args.failedPhase,
      failureReason: args.failureReason,
      failedAgent: args.failedAgent,
      failedStep: args.failedStep,
      retryCount,
      lastValidCheckpoint: checkpoint,
      filesGeneratedBeforeFailure,
      recoveryAttempted,
      recommendedNextAction: nextAction,
      zeroFileClassification,
    },
    trace: {
      ...traceCore,
      failureCategory: classification.category,
      failurePhase: args.failedPhase,
      failureReason: args.failureReason,
      failedAgent: args.failedAgent,
      failedStep: args.failedStep,
      retryCount,
      lastValidCheckpoint: checkpoint,
      filesGeneratedBeforeFailure,
      recoveryAttempted,
      recommendedNextAction: nextAction,
    },
  };
}
