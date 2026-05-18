import { classifyGenerationFailure } from '../pipeline/generation-failure-classifier.js';
import { classifyZeroFileFailure, recommendNextAction, type ZeroFileClassification } from '../pipeline/failure-diagnostics.js';

export interface MissionFailureDiagnostics {
  failureCategory: string;
  failurePhase: string;
  failureReason: string;
  failedAgent: string;
  failedStep: string;
  retryCount: number;
  lastValidCheckpoint: string | null;
  filesGeneratedBeforeFailure: number;
  recoveryAttempted: boolean;
  recommendedNextAction: string;
  zeroFileClassification: ZeroFileClassification | null;
}

function asString(v: unknown): string | null {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : null;
}

function asKnownString(v: unknown): string | null {
  const value = asString(v);
  if (!value) return null;
  return /^unknown(?:\b|[:/\s-])/i.test(value) ? null : value;
}

function inferPreviewFailureReason(project: any): string | null {
  return (
    asKnownString(project?.preview?.previewError)
    ?? asKnownString(project?.preview?.failureReason)
    ?? asKnownString(project?.preview?.stderrTail)
    ?? asKnownString(project?.preview?.previewProcessLifecycle?.stderrTail)
    ?? null
  );
}

function inferFailureReason(project: any, sessionProgress: any): string {
  const trace = project?.diagnostics?.generationFailureTrace ?? null;
  const projectStatus = asString(project?.status) ?? 'failed';
  const sessionStatus = asString(sessionProgress?.status);
  const sessionFailureReason = asKnownString(sessionProgress?.failureReason);
  if (
    projectStatus === 'generating'
    && sessionStatus === 'failed'
    && sessionFailureReason
  ) {
    return `terminal session failed while project remained generating: ${sessionFailureReason}`;
  }
  if (
    projectStatus === 'generating'
    && sessionStatus === 'completed'
  ) {
    return 'terminal session completed while project remained generating: awaiting persisted project terminal state';
  }
  const previewFailureReason = inferPreviewFailureReason(project);
  return (
    asKnownString(project?.failure?.failureReason)
    ?? previewFailureReason
    ?? asKnownString(trace?.failureReason)
    ?? asKnownString(project?.error)
    ?? asKnownString(project?.failure?.errorMessage)
    ?? asKnownString(sessionProgress?.failureReason)
    ?? asKnownString(project?.qaAssurance?.blockers?.[0]?.message)
    ?? asKnownString(project?.executionValidation?.buildErrors?.[0])
    ?? asKnownString(project?.executionValidation?.reason)
    ?? `project status=${asString(project?.status) ?? 'failed'} with missing explicit error`
  );
}

function inferFailedAgent(project: any, failedPhase: string): string {
  const trace = project?.diagnostics?.generationFailureTrace ?? null;
  return (
    asKnownString(project?.failure?.failedAgent)
    ?? asKnownString(trace?.failedAgent)
    ?? (failedPhase.includes('qa') ? 'qa' : failedPhase.includes('builder') ? 'builder' : failedPhase.includes('spec') ? 'spec' : 'pipeline')
  );
}

function inferLastCheckpoint(project: any): string | null {
  const trace = project?.diagnostics?.generationFailureTrace ?? null;
  const direct = asKnownString(project?.failure?.lastValidCheckpoint) ?? asKnownString(trace?.lastValidCheckpoint);
  if (direct) return direct;
  const checkpoints = Array.isArray(project?.diagnostics?.generationCheckpoints)
    ? project.diagnostics.generationCheckpoints
    : [];
  if (checkpoints.length === 0) return null;
  const last = checkpoints[checkpoints.length - 1];
  return asString(last?.id) ?? (asString(last?.phase) && asString(last?.step) ? `${last.phase}:${last.step}` : null);
}

function inferRecoveryAttempted(project: any): boolean {
  const trace = project?.diagnostics?.generationFailureTrace ?? null;
  if (typeof project?.failure?.recoveryAttempted === 'boolean') return project.failure.recoveryAttempted;
  if (typeof trace?.recoveryAttempted === 'boolean') return trace.recoveryAttempted;
  const fromCheckpoints = Array.isArray(project?.diagnostics?.generationCheckpoints)
    && project.diagnostics.generationCheckpoints.some((c: any) => c?.status === 'recovered');
  return Boolean(fromCheckpoints || (Number(project?.qaAssurance?.autoFixCount ?? 0) > 0));
}

export function extractMissionFailureDiagnostics(args: {
  project: any;
  sessionProgress?: any;
  filesCount: number;
}): MissionFailureDiagnostics {
  const project = args.project ?? {};
  const sessionProgress = args.sessionProgress ?? null;
  const trace = project?.diagnostics?.generationFailureTrace ?? null;
  const failureReason = inferFailureReason(project, sessionProgress);
  const failurePhase = asKnownString(project?.failure?.failurePhase)
    ?? asKnownString(project?.failure?.failedPhase)
    ?? asKnownString(trace?.failurePhase)
    ?? asString(project?.progress?.phase)
    ?? asString(sessionProgress?.executionPhase)
    ?? 'pipeline';
  const failedStep = asKnownString(project?.failure?.failedStep)
    ?? asKnownString(trace?.failedStep)
    ?? asString(project?.progress?.lastMeaningfulStep)
    ?? asString(sessionProgress?.currentStep?.stepId)
    ?? failurePhase;
  const retryCount = Number(sessionProgress?.retryAttempt ?? project?.failure?.retryCount ?? trace?.retryCount ?? 0);
  const inferredFileCount =
    Array.isArray(project?.files) ? project.files.length : (Number.isFinite(args.filesCount) && args.filesCount >= 0 ? args.filesCount : 0);
  const filesGeneratedBeforeFailure = Number(
    project?.failure?.filesGeneratedBeforeFailure
    ?? trace?.filesGeneratedBeforeFailure
    ?? inferredFileCount,
  );

  const fallbackClassification = classifyGenerationFailure({
    failedPhase: failurePhase,
    failedStep,
    errorMessage: failureReason,
  });
  const failureCategory = asKnownString(project?.failure?.failureCategory)
    ?? asKnownString(project?.failure?.classification?.category)
    ?? asKnownString(trace?.failureCategory)
    ?? fallbackClassification.category;

  const failedAgent = inferFailedAgent(project, failurePhase);
  const lastValidCheckpoint = inferLastCheckpoint(project);
  const recoveryAttempted = inferRecoveryAttempted(project);
  const records = Array.isArray(project?.diagnostics?.pipelineLedger?.records)
    ? project.diagnostics.pipelineLedger.records
    : [];
  const confirmedZeroFiles =
    filesGeneratedBeforeFailure <= 0
    && (
      args.filesCount === 0
      || (Array.isArray(project?.files) && project.files.length === 0)
      || Number(project?.failure?.filesGeneratedBeforeFailure) <= 0
      || Number(trace?.filesGeneratedBeforeFailure) <= 0
    );
  const zeroFileClassification = confirmedZeroFiles
    ? classifyZeroFileFailure({ failureReason, failedPhase: failurePhase, failedStep, records })
    : null;
  const recommendedNextAction = asKnownString(project?.failure?.recommendedNextAction)
    ?? asKnownString(trace?.recommendedNextAction)
    ?? recommendNextAction({
    classification: {
      category: failureCategory as any,
      code: asString(project?.failure?.classification?.code) ?? fallbackClassification.code,
      reason: asString(project?.failure?.classification?.reason) ?? fallbackClassification.reason,
    },
    zeroFileClassification,
  });

  return {
    failureCategory,
    failurePhase,
    failureReason,
    failedAgent,
    failedStep,
    retryCount: Number.isFinite(retryCount) ? retryCount : 0,
    lastValidCheckpoint,
    filesGeneratedBeforeFailure,
    recoveryAttempted,
    recommendedNextAction,
    zeroFileClassification,
  };
}
