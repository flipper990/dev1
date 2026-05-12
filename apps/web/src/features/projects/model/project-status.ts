import type { GeneratedProject } from '../../../../types/dashboard';
import type { ProductStatusKey, StatusTone as ProductStatusTone } from '../../../design/tokens/status';
import { derivePreviewTruth } from '../../preview/model';

export type UnifiedProjectStatusKey = ProductStatusKey;

export type ProjectStageKey = 'decide' | 'build' | 'verify' | 'launch';
export type StatusTone = Exclude<ProductStatusTone, 'info'>;
export type WorkflowStepState = 'pending' | 'running' | 'success' | 'warning' | 'failed';

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

interface WorkflowStepDef {
  id: 'input' | 'build' | 'preview' | 'verify' | 'launch';
  label: string;
  description: string;
  state: WorkflowStepState;
  timestampLabel?: string;
  metadata?: string[];
  canRetry?: boolean;
}

export interface WorkflowTimelineViewModel {
  heading: string;
  summary: string;
  currentStepId: WorkflowStepDef['id'];
  overallTone: StatusTone;
  steps: WorkflowStepDef[];
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
    label: 'Code generated',
    description: 'Code generation finished. Verification still determines readiness.',
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
    description: 'Preview is healthy. Production readiness still requires verification pass.',
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
  if (project.verificationStatus) return project.verificationStatus === 'passed';
  const runtime = project.runtimeValidation?.status;
  const execution = project.executionValidation?.status;

  const runtimePassed = runtime === undefined || runtime === 'passed';
  const executionPassed = execution === undefined || execution === 'passed';
  return runtimePassed && executionPassed;
}

function hasVerificationSignal(project: GeneratedProject): boolean {
  return Boolean(project.verificationStatus || project.runtimeValidation || project.executionValidation);
}

function formatTimestampLabel(value: string | number | Date | undefined): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function collectBuildMetadata(project: GeneratedProject): string[] {
  const meta: string[] = [];
  const buildMetrics = project as GeneratedProject & {
    fileCount?: number;
    totalTokens?: number;
    totalCostUsd?: number;
  };
  if (typeof buildMetrics.fileCount === 'number') meta.push(`${buildMetrics.fileCount} files`);
  if (typeof buildMetrics.totalTokens === 'number') meta.push(`${buildMetrics.totalTokens.toLocaleString()} tokens`);
  if (typeof buildMetrics.totalCostUsd === 'number') meta.push(`$${buildMetrics.totalCostUsd.toFixed(2)} cost`);
  return meta;
}

function deriveStepState(status: UnifiedProjectStatusKey, stepId: WorkflowStepDef['id']): WorkflowStepState {
  if (status === 'preview-failed' && (stepId === 'build' || stepId === 'preview')) return 'failed';
  if (status === 'stale' && (stepId === 'verify' || stepId === 'launch')) return 'warning';

  switch (stepId) {
    case 'input':
      return status === 'idle' ? 'running' : 'success';
    case 'build':
      if (status === 'generating' || status === 'preview-starting') return 'running';
      if (status === 'idle') return 'pending';
      return 'success';
    case 'preview':
      if (status === 'preview-starting') return 'running';
      if (status === 'preview-ready' || status === 'verification-pending' || status === 'launch-ready') return 'success';
      if (status === 'idle' || status === 'generating' || status === 'build-complete') return 'pending';
      return 'failed';
    case 'verify':
      if (status === 'verification-pending') return 'running';
      if (status === 'launch-ready') return 'success';
      if (status === 'stale') return 'warning';
      return 'pending';
    case 'launch':
      if (status === 'launch-ready') return 'running';
      if (status === 'stale') return 'warning';
      return 'pending';
    default:
      return 'pending';
  }
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
  const previewTruth = derivePreviewTruth(project);

  if (project.status === 'generating') {
    return { key: 'generating', ...STATUS_META.generating };
  }

  if (previewTruth.isBroken || previewTruth.isFailure || project.status === 'failed') {
    return { key: 'preview-failed', ...STATUS_META['preview-failed'] };
  }

  if (previewStatus === 'preparing' || previewStatus === 'installing' || previewStatus === 'building' || previewStatus === 'starting') {
    return { key: 'preview-starting', ...STATUS_META['preview-starting'] };
  }

  if (previewTruth.isPlaceholder || (previewTruth.previewTransportStatus === 'reachable' && !previewTruth.isHealthy)) {
    return { key: 'stale', ...STATUS_META.stale };
  }

  if (previewTruth.isHealthy) {
    if (project.verificationStatus === 'passed') {
      return { key: 'launch-ready', ...STATUS_META['launch-ready'] };
    }
    if (project.verificationStatus === 'failed' || project.verificationStatus === 'warning') {
      return { key: 'verification-pending', ...STATUS_META['verification-pending'] };
    }
    if (!hasVerificationSignal(project)) {
      return { key: 'preview-ready', ...STATUS_META['preview-ready'] };
    }
    if (isVerificationPassed(project)) {
      return { key: 'launch-ready', ...STATUS_META['launch-ready'] };
    }
    return { key: 'verification-pending', ...STATUS_META['verification-pending'] };
  }

  if (project.status === 'generated') {
    return { key: 'build-complete', ...STATUS_META['build-complete'] };
  }

  return { key: 'stale', ...STATUS_META.stale };
}

export function buildWorkflowTimelineViewModel(
  project: GeneratedProject | null | undefined,
  unifiedStatus: UnifiedProjectStatus,
): WorkflowTimelineViewModel {
  const projectTimestamps = project as
    | (GeneratedProject & {
        updatedAt?: string | number | Date;
        completedAt?: string | number | Date;
      })
    | null
    | undefined;
  const buildMeta = project ? collectBuildMetadata(project) : [];
  const lastUpdated =
    formatTimestampLabel(projectTimestamps?.updatedAt) ??
    formatTimestampLabel(projectTimestamps?.completedAt) ??
    formatTimestampLabel(project?.createdAt);

  const previewMeta: string[] = [];
  const previewMetrics = project?.preview as
    | {
        previewStatus?: string;
        port?: number;
        url?: string | null;
        previewUrl?: string | null;
      }
    | null
    | undefined;
  if (project?.preview?.previewStatus) previewMeta.push(`Runtime: ${project.preview.previewStatus}`);
  if (previewMetrics?.port) previewMeta.push(`Port ${previewMetrics.port}`);
  if (previewMetrics?.url || previewMetrics?.previewUrl) previewMeta.push('URL available');

  const verificationMeta: string[] = [];
  if (project?.runtimeValidation?.status) verificationMeta.push(`Runtime ${project.runtimeValidation.status}`);
  if (project?.executionValidation?.status) verificationMeta.push(`Execution ${project.executionValidation.status}`);

  const steps: WorkflowStepDef[] = [
    {
      id: 'input',
      label: 'Input received',
      description: 'Requirements captured for this build cycle.',
      state: deriveStepState(unifiedStatus.key, 'input'),
      timestampLabel: lastUpdated,
      metadata: project?.promptHistory?.length ? [`${project.promptHistory.length} prompt updates`] : undefined,
    },
    {
      id: 'build',
      label: 'Generate code',
      description: 'Agent pipeline generates and assembles project artifacts.',
      state: deriveStepState(unifiedStatus.key, 'build'),
      timestampLabel: lastUpdated,
      metadata: buildMeta.length ? buildMeta : undefined,
      canRetry: unifiedStatus.key === 'preview-failed' || unifiedStatus.key === 'stale',
    },
    {
      id: 'preview',
      label: 'Start preview',
      description: 'Boot application runtime and validate web readiness.',
      state: deriveStepState(unifiedStatus.key, 'preview'),
      timestampLabel: lastUpdated,
      metadata: previewMeta.length ? previewMeta : undefined,
      canRetry: unifiedStatus.key === 'preview-failed',
    },
    {
      id: 'verify',
      label: 'Verify quality',
      description: 'Run execution and runtime validation checks.',
      state: deriveStepState(unifiedStatus.key, 'verify'),
      timestampLabel: lastUpdated,
      metadata: verificationMeta.length ? verificationMeta : undefined,
      canRetry: unifiedStatus.key === 'verification-pending' || unifiedStatus.key === 'stale',
    },
    {
      id: 'launch',
      label: 'Launch decision',
      description: 'Approve deployment or continue iterating.',
      state: deriveStepState(unifiedStatus.key, 'launch'),
      timestampLabel: lastUpdated,
      metadata: unifiedStatus.key === 'launch-ready' ? ['Ready to deploy'] : undefined,
    },
  ];

  const current = steps.find((s) => s.state === 'running') ?? steps.find((s) => s.state === 'failed' || s.state === 'warning') ?? steps[0];

  return {
    heading: 'Build workflow timeline',
    summary: unifiedStatus.description,
    currentStepId: current.id,
    overallTone: unifiedStatus.tone,
    steps,
  };
}

export const PROJECT_STAGES: Array<{ key: ProjectStageKey; label: string }> = [
  { key: 'decide', label: 'Decide' },
  { key: 'build', label: 'Build' },
  { key: 'verify', label: 'Verify' },
  { key: 'launch', label: 'Launch' },
];
