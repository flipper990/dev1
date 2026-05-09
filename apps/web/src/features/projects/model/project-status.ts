import type { GeneratedProject } from '../../../../types/dashboard';
import type { ProductStatusKey, StatusTone as ProductStatusTone } from '../../../design/tokens/status';

export type UnifiedProjectStatusKey = ProductStatusKey;

export type ProjectStageKey = 'decide' | 'build' | 'verify' | 'launch';
export type StatusTone = Exclude<ProductStatusTone, 'info'>;

export interface UnifiedProjectStatus {
  key: UnifiedProjectStatusKey;
  label: string;
  description: string;
  tone: StatusTone;
  stage: ProjectStageKey;
  healthy: boolean;
  nextActionLabel: string;
}

interface DeriveOptions {
  forceStale?: boolean;
}

const STATUS_META: Record<UnifiedProjectStatusKey, Omit<UnifiedProjectStatus, 'key'>> = {
  idle: {
    label: 'Idle',
    description: 'No active build. Provide a requirement to begin.',
    tone: 'neutral',
    stage: 'decide',
    healthy: true,
    nextActionLabel: 'Start build',
  },
  generating: {
    label: 'Generating',
    description: 'The project is being built from your latest command.',
    tone: 'active',
    stage: 'build',
    healthy: true,
    nextActionLabel: 'Monitor build',
  },
  'build-complete': {
    label: 'Build complete',
    description: 'Code generation finished and artifacts are available.',
    tone: 'success',
    stage: 'build',
    healthy: true,
    nextActionLabel: 'Start preview',
  },
  'preview-starting': {
    label: 'Preview starting',
    description: 'Runtime is booting and health checks are running.',
    tone: 'active',
    stage: 'build',
    healthy: true,
    nextActionLabel: 'Wait for preview',
  },
  'preview-ready': {
    label: 'Preview ready',
    description: 'Preview is healthy and ready for product review.',
    tone: 'success',
    stage: 'verify',
    healthy: true,
    nextActionLabel: 'Run verification',
  },
  'preview-failed': {
    label: 'Preview failed',
    description: 'Runtime preview is not healthy and requires intervention.',
    tone: 'error',
    stage: 'build',
    healthy: false,
    nextActionLabel: 'Investigate logs',
  },
  stale: {
    label: 'Out of sync',
    description: 'Project state is stale or contradictory; refresh evidence.',
    tone: 'warning',
    stage: 'verify',
    healthy: false,
    nextActionLabel: 'Refresh project state',
  },
  'verification-pending': {
    label: 'Verification pending',
    description: 'Preview is up; verification checks still need sign-off.',
    tone: 'warning',
    stage: 'verify',
    healthy: true,
    nextActionLabel: 'Complete verification',
  },
  'launch-ready': {
    label: 'Launch ready',
    description: 'Checks passed and the project is ready to launch.',
    tone: 'success',
    stage: 'launch',
    healthy: true,
    nextActionLabel: 'Launch project',
  },
};

function isVerificationPassed(project: GeneratedProject): boolean {
  const runtime = project.runtimeValidation?.status;
  const execution = project.executionValidation?.status;

  const runtimePassed = runtime === undefined || runtime === 'passed';
  const executionPassed = execution === undefined || execution === 'passed';
  return runtimePassed && executionPassed;
}

function hasVerificationSignal(project: GeneratedProject): boolean {
  return Boolean(project.runtimeValidation || project.executionValidation);
}

export function deriveUnifiedProjectStatus(
  project: GeneratedProject | null | undefined,
  options?: DeriveOptions,
): UnifiedProjectStatus {
  if (!project) {
    return { key: 'idle', ...STATUS_META.idle };
  }

  if (options?.forceStale) {
    return { key: 'stale', ...STATUS_META.stale };
  }

  const previewStatus = project.preview?.previewStatus;
  const previewReady = project.preview?.previewReady;

  if (project.status === 'generating') {
    return { key: 'generating', ...STATUS_META.generating };
  }

  if (previewStatus === 'failed' || project.status === 'failed') {
    return { key: 'preview-failed', ...STATUS_META['preview-failed'] };
  }

  if (previewStatus === 'preparing' || previewStatus === 'installing' || previewStatus === 'building' || previewStatus === 'starting') {
    return { key: 'preview-starting', ...STATUS_META['preview-starting'] };
  }

  if (previewStatus === 'ready' || previewReady) {
    if (!hasVerificationSignal(project)) {
      return { key: 'preview-ready', ...STATUS_META['preview-ready'] };
    }
    if (isVerificationPassed(project)) {
      return { key: 'launch-ready', ...STATUS_META['launch-ready'] };
    }
    return { key: 'verification-pending', ...STATUS_META['verification-pending'] };
  }

  if (project.status === 'completed') {
    return { key: 'build-complete', ...STATUS_META['build-complete'] };
  }

  return { key: 'stale', ...STATUS_META.stale };
}

export const PROJECT_STAGES: Array<{ key: ProjectStageKey; label: string }> = [
  { key: 'decide', label: 'Decide' },
  { key: 'build', label: 'Build' },
  { key: 'verify', label: 'Verify' },
  { key: 'launch', label: 'Launch' },
];
