'use client';

import { useCallback, useMemo } from 'react';
import type { GeneratedProject } from '../../../../types/dashboard';
import type { GateResult, ProjectContract, RequirementCoverageItem } from '../../../../types/projectContract';
import {
  mergeLivePreview,
  useProject,
  useProjectActivity,
  useProjectPreview,
  useProjects,
  useSelectedProject,
} from '../../../../hooks/useProjectData';
import {
  buildWorkflowTimelineViewModel,
  deriveUnifiedProjectStatus,
  type WorkflowStepState,
  type WorkflowTimelineViewModel,
} from '../../projects/model';
import { deriveCompletionMetrics, deriveCompletionReport } from '../../projects/model/contractCompletion';
import { derivePreviewTruth, type PreviewTruthModel } from '../../preview/model';
import type { LogEntry } from '../../logs/components';
import type { AgentStepState, TimelineEvent } from '../../agents/components';

const stepStateToAgentState: Record<WorkflowStepState, AgentStepState> = {
  pending: 'pending',
  running: 'running',
  success: 'success',
  warning: 'warning',
  failed: 'failed',
};

const pipelineOwner: Record<WorkflowTimelineViewModel['steps'][number]['id'], string> = {
  input: 'Definition intake',
  build: 'Generation pipeline',
  preview: 'Preview runner',
  verify: 'Verification gate',
  launch: 'Release package',
};

function previewIsBound(project: GeneratedProject | null, selectedProjectId: string | null) {
  return Boolean(project && selectedProjectId && project.id === selectedProjectId);
}

function buildPipelineEvents(timeline: WorkflowTimelineViewModel): TimelineEvent[] {
  return timeline.steps.map((step) => ({
    id: step.id,
    title: step.label,
    detail: step.description,
    owner: pipelineOwner[step.id],
    state: stepStateToAgentState[step.state],
    evidence: step.metadata,
  }));
}

function buildLogEntries(project: GeneratedProject | null, selectedProjectId: string | null): LogEntry[] {
  if (!previewIsBound(project, selectedProjectId)) return [];
  const preview = project?.preview;
  if (!preview) return [];

  const entries: LogEntry[] = [];

  preview.timeline?.slice(-8).forEach((event, index) => {
    const message = event.stderrTail ?? event.stdoutTail ?? JSON.stringify(event.details ?? { status: event.previewStatus });
    entries.push({
      id: `${project.id}-timeline-${event.event}-${index}`,
      timestamp: event.at,
      severity: event.previewStatus === 'failed' ? 'error' : event.event === 'failed' ? 'error' : 'info',
      step: event.event,
      message,
      explanation: event.durationMs ? `Duration ${Math.round(event.durationMs / 1000)}s` : undefined,
    });
  });

  if (preview.previewRuntimeLog) {
    entries.push({
      id: `${project.id}-runtime-log`,
      timestamp: preview.previewRuntimeLog.capturedAt,
      severity: preview.previewStatus === 'failed' ? 'error' : 'info',
      step: preview.previewStep ?? 'runtime-log',
      message: preview.previewRuntimeLog.stderrTail ?? preview.previewRuntimeLog.stdoutTail ?? 'Runtime process snapshot captured without output.',
      explanation: preview.previewRuntimeLog.cmd ? `Command: ${preview.previewRuntimeLog.cmd}` : undefined,
    });
  }

  if (preview.previewError) {
    entries.push({
      id: `${project.id}-preview-error`,
      timestamp: preview.previewFailedAt ?? new Date().toISOString(),
      severity: 'error',
      step: preview.previewStep ?? 'preview-failed',
      message: preview.previewError,
      explanation: 'Use this evidence to scope the next repair request.',
    });
  }

  if (entries.length === 0) {
    entries.push({
      id: `${project.id}-no-runtime-evidence`,
      timestamp: new Date().toISOString(),
      severity: 'info',
      step: preview.previewStep ?? 'Preview',
      message: 'No runtime stderr captured for this project.',
      explanation: preview.previewReady ? 'Preview is healthy.' : 'Start preview to collect runtime evidence.',
    });
  }

  return entries;
}

function getPreviewTelemetryState(previewTruth: PreviewTruthModel): 'idle' | 'starting' | 'ready' | 'failed' | 'stale' {
  if (previewTruth.contradictions.length > 0) return 'stale';
  if (previewTruth.isHealthy) return 'ready';
  if (previewTruth.isFailure || previewTruth.isBroken) return 'failed';
  if (previewTruth.isLoading) return 'starting';
  return 'idle';
}

export function useWorkspaceProject(params: {
  routeProjectId: string | null;
  optimisticProject: GeneratedProject | null;
}) {
  const { routeProjectId, optimisticProject } = params;
  const selectedProjectId = routeProjectId;

  const projectsState = useProjects();
  const projectState = useProject(selectedProjectId);
  const previewStateLive = useProjectPreview(selectedProjectId);
  const activityState = useProjectActivity(selectedProjectId);
  const selectedProjectFromData = useSelectedProject(
    selectedProjectId,
    projectsState.projects,
    projectState.project,
  );
  const selectedProjectRaw = optimisticProject && optimisticProject.id === selectedProjectId
    ? optimisticProject
    : selectedProjectFromData;
  const selectedProject = useMemo(
    () => mergeLivePreview(selectedProjectRaw, previewStateLive.previewStatus),
    [previewStateLive.previewStatus, selectedProjectRaw],
  );
  const projects = projectsState.projects;
  const projectsLoading = projectsState.loading;
  const projectLoading = projectState.loading;
  const status = deriveUnifiedProjectStatus(selectedProject);
  const previewTruth = useMemo(() => derivePreviewTruth(selectedProject), [selectedProject]);
  const timeline = useMemo(() => buildWorkflowTimelineViewModel(selectedProject, status), [selectedProject, status]);
  const pipelineEvents = useMemo(() => buildPipelineEvents(timeline), [timeline]);

  const contract = useMemo<ProjectContract | null>(() => {
    const raw = (selectedProject as unknown as { projectContract?: ProjectContract })?.projectContract;
    return raw ?? null;
  }, [selectedProject]);

  const coverage = useMemo<RequirementCoverageItem[]>(() => {
    const raw = (selectedProject as unknown as { requirementCoverage?: RequirementCoverageItem[] })?.requirementCoverage;
    return Array.isArray(raw) ? raw : [];
  }, [selectedProject]);

  const gates = useMemo<GateResult[]>(() => {
    const raw = (selectedProject as unknown as { gateResults?: GateResult[] })?.gateResults;
    return Array.isArray(raw) ? raw : [];
  }, [selectedProject]);

  const flowChecksPassed = useMemo(() => (gates.find((gate) => gate.id === 'flow')?.passed ? 1 : 0), [gates]);
  const completionMetrics = useMemo(
    () => deriveCompletionMetrics({ contract, coverage, flowChecksPassed, flowChecksTotal: 1, project: selectedProject }),
    [contract, coverage, flowChecksPassed, selectedProject],
  );
  const completionReport = useMemo(
    () => deriveCompletionReport({ contract, coverage, gates, metrics: completionMetrics }),
    [contract, coverage, gates, completionMetrics],
  );

  const previewState = getPreviewTelemetryState(previewTruth);
  const logEntries = useMemo(() => buildLogEntries(selectedProject, selectedProjectId), [selectedProject, selectedProjectId]);

  const workspaceBanner = useMemo(() => {
    const loadingError = projectsState.error ?? projectState.error ?? previewStateLive.error ?? activityState.error;
    if (loadingError) {
      return {
        tone: 'error' as const,
        title: 'Unable to load project data',
        description: loadingError,
      };
    }
    if (projectsState.reconnecting || projectState.reconnecting || previewStateLive.reconnecting || activityState.reconnecting) {
      return { tone: 'warning' as const, title: 'Reconnecting to backend', description: 'Live project, preview, or activity feeds are reconnecting. Showing last known state.' };
    }
    if (projectsState.stale || projectState.stale || previewStateLive.stale || activityState.stale) {
      return { tone: 'warning' as const, title: 'Stale backend snapshot', description: 'Data may be stale until backend refresh succeeds.' };
    }
    if (selectedProjectId && !selectedProject && !projectLoading) {
      return { tone: 'warning' as const, title: 'Project not found', description: `No backend project record was found for projectId ${selectedProjectId}. Choose another project or create a new one.` };
    }
    if (projectLoading || projectsLoading) {
      return { tone: 'info' as const, title: 'Loading project evidence', description: 'Fetching the latest project and preview state from the backend.' };
    }
    return null;
  }, [
    activityState.reconnecting,
    activityState.error,
    activityState.stale,
    previewStateLive.error,
    previewStateLive.reconnecting,
    previewStateLive.stale,
    projectLoading,
    projectState.error,
    projectState.reconnecting,
    projectState.stale,
    projectsLoading,
    projectsState.error,
    projectsState.reconnecting,
    projectsState.stale,
    selectedProject,
    selectedProjectId,
  ]);

  const refreshProject = useCallback(async (_projectId: string) => {
    await Promise.all([projectsState.refresh(), projectState.refresh(), previewStateLive.refresh(), activityState.refresh()]);
    return projectState.project;
  }, [activityState, previewStateLive, projectState, projectsState]);

  return {
    selectedProjectId,
    projectsState,
    projectState,
    previewStateLive,
    activityState,
    selectedProject,
    projects,
    projectsLoading,
    projectLoading,
    status,
    previewTruth,
    timeline,
    pipelineEvents,
    completionReport,
    previewState,
    logEntries,
    workspaceBanner,
    refreshProject,
  };
}

export function workspacePreviewBound(project: GeneratedProject | null, selectedProjectId: string | null): boolean {
  return previewIsBound(project, selectedProjectId);
}

export function workspacePreviewUrl(project: GeneratedProject | null, selectedProjectId: string | null): string | undefined {
  if (!previewIsBound(project, selectedProjectId)) return undefined;
  return project?.preview?.previewUrl ?? undefined;
}
