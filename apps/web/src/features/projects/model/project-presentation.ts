import type { GeneratedProject } from '../../../../types/dashboard';
import { deriveUnifiedProjectStatus } from './project-status';
import { derivePreviewTruth } from '../../preview/model';

export type ProjectTone = 'neutral' | 'active' | 'success' | 'warning' | 'error';

export interface ProjectPresentation {
  projectId: string;
  name: string;
  owner: string;
  stackLabel: string;
  lastUpdatedAt: string;
  lastUpdatedLabel: string;
  build: { label: string; tone: ProjectTone };
  preview: { label: string; tone: ProjectTone };
  export: { label: string; tone: ProjectTone };
  health: { label: string; tone: ProjectTone; nextAction: string; stage: string };
  usage: { tokens: number; costUsd: number; durationMs: number };
}

function formatDate(value: string | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function getLastUpdatedAt(project: GeneratedProject): string {
  const previewUpdated = project.preview?.previewReadyAt ?? project.preview?.previewFailedAt ?? project.preview?.previewStartedAt ?? undefined;
  return previewUpdated ?? project.completedAt ?? project.createdAt;
}

function getStackLabel(project: GeneratedProject): string {
  const stack = project.techStack;
  if (!stack || Object.keys(stack).length === 0) return project.stackSelectionMode === 'manual' ? 'Manual stack selected' : 'Stack pending';

  const preferredKeys = ['frontend', 'backend', 'database'];
  const preferred = preferredKeys.map((key) => stack[key]).filter(Boolean);
  const values = preferred.length > 0 ? preferred : Object.values(stack).filter(Boolean);
  return values.slice(0, 3).join(' + ') || 'Stack pending';
}

function getBuild(project: GeneratedProject): ProjectPresentation['build'] {
  if (project.status === 'generating') return { label: 'Building', tone: 'active' };
  if (project.status === 'failed') return { label: 'Build failed', tone: 'error' };
  return { label: 'Code generated', tone: 'success' };
}

function getPreview(project: GeneratedProject): ProjectPresentation['preview'] {
  const preview = derivePreviewTruth(project);
  return { label: preview.label, tone: preview.tone };
}

function getExportStatus(project: GeneratedProject): ProjectPresentation['export'] {
  if (project.status === 'failed') return { label: 'Blocked', tone: 'error' };
  if (project.status === 'generating') return { label: 'Pending generation', tone: 'neutral' };

  if (project.verificationStatus === 'passed') return { label: 'Source available · verified', tone: 'success' };
  if (project.verificationStatus === 'running') return { label: 'Source available · verification running', tone: 'active' };
  if (project.verificationStatus === 'warning' || project.verificationStatus === 'failed') return { label: 'Source available · checks need review', tone: 'warning' };

  return { label: 'Source available · unverified', tone: 'warning' };
}

export function deriveProjectPresentation(project: GeneratedProject, owner = 'Platform team'): ProjectPresentation {
  const status = deriveUnifiedProjectStatus(project);
  const lastUpdatedAt = getLastUpdatedAt(project);

  return {
    projectId: project.id,
    name: project.name || 'Untitled project',
    owner,
    stackLabel: getStackLabel(project),
    lastUpdatedAt,
    lastUpdatedLabel: formatDate(lastUpdatedAt),
    build: getBuild(project),
    preview: getPreview(project),
    export: getExportStatus(project),
    health: {
      label: status.label,
      tone: status.tone,
      nextAction: status.nextActionLabel,
      stage: status.stage,
    },
    usage: {
      tokens: project.totalTokens ?? 0,
      costUsd: project.totalCostUsd ?? 0,
      durationMs: project.durationMs ?? 0,
    },
  };
}

export function sortProjectsByUpdated(projects: GeneratedProject[]) {
  return [...projects].sort((a, b) => new Date(getLastUpdatedAt(b)).getTime() - new Date(getLastUpdatedAt(a)).getTime());
}
