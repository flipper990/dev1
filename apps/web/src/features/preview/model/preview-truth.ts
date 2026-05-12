import type {
  GeneratedProject,
  PreviewHealthStatus as SharedPreviewHealthStatus,
  PreviewLifecycleStatus,
} from '../../../../types/dashboard';

export type ProjectStatus = 'generating' | 'generated' | 'failed';
export type PreviewTransportStatus = PreviewLifecycleStatus;
export type PreviewHealthStatus = SharedPreviewHealthStatus;
export type PreviewTruthTone = 'neutral' | 'active' | 'success' | 'warning' | 'error';

export interface PreviewTruthModel {
  projectStatus: ProjectStatus;
  previewTransportStatus: PreviewTransportStatus;
  previewHealthStatus: PreviewHealthStatus;
  label: string;
  description: string;
  tone: PreviewTruthTone;
  canRenderIframe: boolean;
  canOpenUrl: boolean;
  isLoading: boolean;
  isFailure: boolean;
  isBroken: boolean;
  isPlaceholder: boolean;
  isHealthy: boolean;
  exactReason: string | null;
  runtimeType: string | null;
  previewUrl: string | null;
  reproduceCommand: string;
  contradictions: string[];
}

function firstLine(value: string | null | undefined) {
  if (!value) return null;
  const cleaned = value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '').trim();
  if (!cleaned) return null;
  return cleaned.split(/\r?\n/)[0]?.trim() || cleaned;
}

function hasTruthyProbe(project: GeneratedProject | null | undefined) {
  const preview = project?.preview;
  if (preview?.probeAttempts?.some((attempt) => attempt.ok || typeof attempt.status === 'number')) return true;
  if (project?.executionValidation?.httpProbes?.some((probe) => probe.ok || typeof probe.status === 'number')) return true;
  return false;
}

function hasPlaceholderSignal(project: GeneratedProject | null | undefined) {
  const issueText = [
    ...(project?.runtimeValidation?.issues ?? []).map((issue) => `${issue.category} ${issue.message} ${issue.hint ?? ''}`),
    ...(project?.executionValidation?.buildErrors ?? []),
    ...(project?.executionValidation?.runtimeErrors ?? []),
    project?.executionValidation?.reason ?? '',
    project?.preview?.previewError ?? '',
  ].join('\n');

  return /placeholder|lorem ipsum|coming soon|under construction|not implemented|stub/i.test(issueText);
}

function hasBrokenSignal(project: GeneratedProject | null | undefined) {
  const preview = project?.preview;
  if (preview?.overlayDetection) return true;
  const errorText = [
    preview?.previewError ?? '',
    preview?.previewRuntimeLog?.stderrTail ?? '',
    ...(project?.executionValidation?.runtimeErrors ?? []),
    ...(project?.executionValidation?.buildErrors ?? []),
    project?.executionValidation?.reason ?? '',
    ...(project?.runtimeValidation?.issues ?? []).map((issue) => `${issue.category} ${issue.message}`),
  ].join('\n');

  return /Module not found|Can'?t resolve|Cannot resolve|Build Error|Unhandled Runtime Error|Application error|Hydration failed|ChunkLoadError|ReferenceError|TypeError|SyntaxError|failed to compile/i.test(errorText);
}

function normalizePreviewStatus(status: PreviewTransportStatus): PreviewTransportStatus {
  switch (status) {
    case 'idle':
    case 'preparing':
    case 'installing':
    case 'building':
    case 'starting':
    case 'reachable':
    case 'ready':
    case 'failed':
      return status;
    default:
      return assertNever(status);
  }
}

function getTransportStatus(
  project: GeneratedProject | null | undefined,
  health: PreviewHealthStatus,
): PreviewTransportStatus {
  const preview = project?.preview;
  if (!project || !preview) return 'idle';
  const raw = normalizePreviewStatus(preview.previewStatus);

  if (raw === 'ready' && health !== 'healthy') return 'reachable';
  if (raw === 'starting' && hasTruthyProbe(project)) return 'reachable';
  return raw;
}

function getHealthStatus(project: GeneratedProject | null | undefined): PreviewHealthStatus {
  if (!project?.preview) return 'unknown';
  if (project.preview.previewHealth) return project.preview.previewHealth;
  if (hasBrokenSignal(project)) return 'broken';
  if (hasPlaceholderSignal(project)) return 'placeholder';
  if (project.preview.previewStatus === 'ready' && project.preview.previewReady) return 'healthy';
  return 'unknown';
}

function getReason(project: GeneratedProject | null | undefined, health: PreviewHealthStatus) {
  const preview = project?.preview;
  if (!preview) return null;
  if (health === 'broken') {
    return preview.overlayDetection?.detectedErrorMessage
      ?? firstLine(preview.previewError)
      ?? firstLine(preview.previewRuntimeLog?.stderrTail)
      ?? firstLine(project?.executionValidation?.runtimeErrors?.[0])
      ?? 'Framework or runtime error detected in preview content.';
  }
  if (health === 'placeholder') {
    return firstLine(project?.runtimeValidation?.issues?.find((issue) => /placeholder/i.test(`${issue.category} ${issue.message}`))?.message)
      ?? firstLine(project?.executionValidation?.reason)
      ?? 'Preview is reachable, but generated content appears to be placeholder output.';
  }
  if (preview.previewStatus === 'failed') {
    return firstLine(preview.previewError)
      ?? firstLine(preview.previewRuntimeLog?.stderrTail)
      ?? preview.previewLastStep
      ?? 'Preview runtime failed before becoming reachable.';
  }
  return null;
}

function buildContradictions(project: GeneratedProject | null | undefined, transport: PreviewTransportStatus, health: PreviewHealthStatus) {
  if (!project) return [];
  const contradictions: string[] = [];
  if (project.status === 'generating' && (transport === 'reachable' || health === 'healthy')) {
    contradictions.push('Build is still generating while preview evidence is reachable. Treat the preview as prior-run evidence until generation completes.');
  }
  if ((project.projectStatus ?? project.status) === 'generated' && (transport === 'failed' || health === 'broken' || health === 'placeholder')) {
    contradictions.push('Code is generated, but preview evidence is not healthy. Generation does not imply runtime correctness.');
  }
  if (project.status === 'failed' && health === 'healthy') {
    contradictions.push('Build is failed while preview appears healthy. Preview may be stale from an earlier run.');
  }
  if (project.preview?.previewStatus === 'ready' && health !== 'healthy') {
    contradictions.push(`Transport reports ready, but health is ${health}. Do not treat this as Preview Ready.`);
  }
  return contradictions;
}

export function derivePreviewTruth(project: GeneratedProject | null | undefined): PreviewTruthModel {
  if (!project) {
    return {
      projectStatus: 'generated',
      previewTransportStatus: 'idle',
      previewHealthStatus: 'unknown',
      label: 'Preview Idle',
      description: 'Select a project to inspect preview output and diagnostics.',
      tone: 'neutral',
      canRenderIframe: false,
      canOpenUrl: false,
      isLoading: false,
      isFailure: false,
      isBroken: false,
      isPlaceholder: false,
      isHealthy: false,
      exactReason: null,
      runtimeType: null,
      previewUrl: null,
      reproduceCommand: 'cd data/projects/<projectId>/output; npm install; npm run dev',
      contradictions: [],
    };
  }

  const projectStatus: ProjectStatus = (project.projectStatus ?? project.status) as ProjectStatus;
  const preview = project?.preview;
  const previewHealthStatus = getHealthStatus(project);
  const previewTransportStatus = getTransportStatus(project, previewHealthStatus);
  const exactReason = getReason(project, previewHealthStatus);
  const runtimeType = preview?.previewRuntime ?? null;
  const previewUrl = preview?.previewUrl ?? null;

  let label = 'Preview Idle';
  let description = 'No preview runtime has been started for this project.';
  let tone: PreviewTruthTone = 'neutral';

  if (projectStatus === 'generating') {
    label = 'Build Generating';
    description = 'A new build is in progress. Prior preview output is not shown as current evidence.';
    tone = 'active';
  } else if (previewTransportStatus === 'preparing') {
    label = 'Preview Preparing';
    description = 'Preparing runtime workspace and selecting preview backend.';
    tone = 'active';
  } else if (previewTransportStatus === 'installing') {
    label = 'Preview Installing';
    description = 'Installing dependencies for the preview runtime.';
    tone = 'active';
  } else if (previewTransportStatus === 'building') {
    label = 'Preview Building';
    description = 'Installing dependencies or building the runtime image.';
    tone = 'active';
  } else if (previewTransportStatus === 'starting') {
    label = 'Preview Starting';
    description = 'Runtime is starting and health checks are not complete yet.';
    tone = 'active';
  } else if (previewHealthStatus === 'broken') {
    label = 'Preview Broken';
    description = exactReason ?? 'Transport is reachable, but the rendered application has a framework or runtime error.';
    tone = 'error';
  } else if (previewTransportStatus === 'failed') {
    label = 'Preview Failed';
    description = exactReason ?? 'Preview failed before the runtime became reachable.';
    tone = 'error';
  } else if (previewHealthStatus === 'placeholder') {
    label = 'Preview Placeholder';
    description = exactReason ?? 'Transport is reachable, but the rendered output appears to be placeholder content.';
    tone = 'warning';
  } else if (previewTransportStatus === 'ready' && previewHealthStatus === 'healthy') {
    label = 'Preview Ready';
    description = 'Transport is reachable and content health is healthy.';
    tone = 'success';
  } else if (previewTransportStatus === 'reachable') {
    label = 'Preview Reachable';
    description = 'Transport responded, but content health has not been confirmed.';
    tone = 'warning';
  }

  const isHealthy = previewTransportStatus === 'ready' && previewHealthStatus === 'healthy';

  return {
    projectStatus,
    previewTransportStatus,
    previewHealthStatus,
    label,
    description,
    tone,
    canRenderIframe: isHealthy && Boolean(previewUrl),
    canOpenUrl: Boolean(previewUrl) && (previewTransportStatus === 'reachable' || previewTransportStatus === 'ready'),
    isLoading:
      previewTransportStatus === 'preparing'
      || previewTransportStatus === 'installing'
      || previewTransportStatus === 'building'
      || previewTransportStatus === 'starting'
      || projectStatus === 'generating',
    isFailure: previewTransportStatus === 'failed',
    isBroken: previewHealthStatus === 'broken',
    isPlaceholder: previewHealthStatus === 'placeholder',
    isHealthy,
    exactReason,
    runtimeType,
    previewUrl,
    reproduceCommand: preview?.previewRuntimeLog?.cwd
      ? `cd ${preview.previewRuntimeLog.cwd}; ${preview.previewRuntimeLog.cmd ?? 'npm run dev'}`
      : `cd data/projects/${project?.id ?? '<projectId>'}/output; npm install; npm run dev`,
    contradictions: buildContradictions(project, previewTransportStatus, previewHealthStatus),
  };
}

export function previewToneToStatusDot(tone: PreviewTruthTone) {
  if (tone === 'success') return 'success' as const;
  if (tone === 'error') return 'error' as const;
  if (tone === 'warning') return 'warning' as const;
  if (tone === 'active') return 'active' as const;
  return 'neutral' as const;
}

function assertNever(value: never): never {
  throw new Error(`Unhandled preview status: ${String(value)}`);
}

export function previewToneToBadge(tone: PreviewTruthTone) {
  if (tone === 'success') return 'success' as const;
  if (tone === 'error') return 'error' as const;
  if (tone === 'warning') return 'warning' as const;
  if (tone === 'active') return 'active' as const;
  return 'neutral' as const;
}
