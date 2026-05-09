'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AppShell } from '../../src/components/shell';
import { Badge, Button, EmptyState, Panel } from '../../components/ui';
import { InlineStatusPanel, SystemBanner, Toast } from '../../src/components/feedback';
import {
  exportProject,
  generateProject,
  getProject,
  listProjects,
  startPreview,
  updateProject,
} from '../../lib/api';
import type { GeneratedProject } from '../../types/dashboard';
import type { GateResult, ProjectContract, RequirementCoverageItem } from '../../types/projectContract';
import {
  BuildEvidencePanel,
  LaunchChecklist,
  ProjectStatusSummary,
  SyncWarningPanel,
  VerificationSummary,
} from '../../src/features/projects/components';
import {
  buildWorkflowTimelineViewModel,
  deriveUnifiedProjectStatus,
  sortProjectsByUpdated,
  type WorkflowStepState,
  type WorkflowTimelineViewModel,
} from '../../src/features/projects/model';
import { deriveCompletionMetrics, deriveCompletionReport } from '../../src/features/projects/model/contractCompletion';
import { PreviewCanvasFrame } from '../../src/features/preview/components';
import { derivePreviewTruth, type PreviewTruthModel } from '../../src/features/preview/model';
import { LogEvidenceView, type LogEntry } from '../../src/features/logs/components';
import { ProductionTimeline, type AgentStepState, type TimelineEvent } from '../../src/features/agents/components';
import {
  CommandDock,
  DiagnosticsSummary,
  ExportActionPanel,
  TrustRail,
  WorkspaceHeader,
  WorkspaceTabs,
  normalizeWorkspaceTab,
  type WorkspaceTabId,
} from '../../src/features/workspace/components';
import { useTrackEvent } from '../../src/lib/telemetry/useTrackEvent';

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

type PreviewRuntimeSnapshot = NonNullable<GeneratedProject['preview']>;

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

function WorkspaceLoading() {
  return (
    <div className="min-h-screen bg-surface-canvas p-6 text-body-s text-text-secondary">
      Loading workspace...
    </div>
  );
}

export default function WorkspacePage() {
  return (
    <Suspense fallback={<WorkspaceLoading />}>
      <WorkspacePageContent />
    </Suspense>
  );
}

function makeOptimisticProject(projectId: string, prompt: string, name?: string): GeneratedProject {
  return {
    id: projectId,
    sessionId: '',
    name: name?.trim() || 'Generating project',
    status: 'generating',
    prompts: [prompt],
    promptHistory: [{ text: prompt, createdAt: new Date().toISOString() }],
    versions: [],
    totalTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    createdAt: new Date().toISOString(),
    stackSelectionMode: 'auto',
    preview: undefined,
  };
}

function previewIsBound(project: GeneratedProject | null, selectedProjectId: string | null) {
  return Boolean(project && selectedProjectId && project.id === selectedProjectId);
}

function getPreviewUrl(project: GeneratedProject | null, selectedProjectId: string | null) {
  if (!previewIsBound(project, selectedProjectId)) return undefined;
  return project?.preview?.previewUrl ?? undefined;
}

function getPreviewTelemetryState(previewTruth: PreviewTruthModel): 'idle' | 'starting' | 'ready' | 'failed' | 'stale' {
  if (previewTruth.contradictions.length > 0) return 'stale';
  if (previewTruth.isHealthy) return 'ready';
  if (previewTruth.isFailure || previewTruth.isBroken) return 'failed';
  if (previewTruth.isLoading) return 'starting';
  return 'idle';
}

function clearPreviewForGeneration(project: GeneratedProject): GeneratedProject {
  return {
    ...project,
    status: 'generating',
    preview: undefined,
  };
}

function markPreviewStarting(project: GeneratedProject): GeneratedProject {
  const previous = project.preview ?? ({} as Partial<PreviewRuntimeSnapshot>);
  return {
    ...project,
    preview: {
      ...previous,
      previewStatus: 'starting',
      previewReady: false,
      previewUrl: null,
      previewStartedAt: new Date().toISOString(),
    },
  };
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

function upsertProject(projects: GeneratedProject[], project: GeneratedProject) {
  const exists = projects.some((item) => item.id === project.id);
  return sortProjectsByUpdated(exists ? projects.map((item) => (item.id === project.id ? project : item)) : [project, ...projects]);
}

function WorkspacePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trackEvent = useTrackEvent();
  const routeProjectId = searchParams.get('projectId');
  const rawTab = searchParams.get('tab');

  const [activeTab, setActiveTab] = useState<WorkspaceTabId>(() => normalizeWorkspaceTab(rawTab));
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [selectedProject, setSelectedProject] = useState<GeneratedProject | null>(null);
  const [projectsLoading, setProjectsLoading] = useState(true);
  const [projectLoading, setProjectLoading] = useState(false);
  const [commandBusy, setCommandBusy] = useState(false);
  const [retryingPreview, setRetryingPreview] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewResetKey, setPreviewResetKey] = useState(0);
  const [liveMessage, setLiveMessage] = useState('Workspace ready.');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const selectedProjectId = routeProjectId ?? selectedProject?.id ?? null;
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
  const previewKey = `${selectedProjectId ?? 'none'}:${previewResetKey}:${selectedProject?.preview?.previewId ?? selectedProject?.preview?.previewReadyAt ?? selectedProject?.preview?.previewStatus ?? 'empty'}`;

  const refreshProject = useCallback(async (projectId: string) => {
    const latest = await getProject(projectId);
    if (!latest) return null;
    setSelectedProject((current) => (current?.id === projectId || routeProjectId === projectId ? latest : current));
    setProjects((current) => upsertProject(current, latest));
    return latest;
  }, [routeProjectId]);

  useEffect(() => {
    let cancelled = false;
    setProjectsLoading(true);
    listProjects()
      .then((items) => {
        if (!cancelled) setProjects(sortProjectsByUpdated(items));
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : 'Unable to load projects.');
      })
      .finally(() => {
        if (!cancelled) setProjectsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setActiveTab(normalizeWorkspaceTab(rawTab));
  }, [rawTab]);

  useEffect(() => {
    setPreviewDevice('desktop');
    setPreviewResetKey((value) => value + 1);
    setErrorMessage(null);

    if (!routeProjectId) {
      setSelectedProject(null);
      setProjectLoading(false);
      setLiveMessage('No project selected. Choose a project or create a new one.');
      return;
    }

    let cancelled = false;
    setSelectedProject(null);
    setProjectLoading(true);
    setLiveMessage(`Loading project ${routeProjectId}.`);

    getProject(routeProjectId)
      .then((project) => {
        if (cancelled) return;
        setSelectedProject(project);
        if (project) {
          setProjects((current) => upsertProject(current, project));
          setLiveMessage(`Project loaded: ${project.name}.`);
        } else {
          setLiveMessage(`Project ${routeProjectId} was not found.`);
        }
      })
      .catch((error) => {
        if (!cancelled) setErrorMessage(error instanceof Error ? error.message : 'Unable to load selected project.');
      })
      .finally(() => {
        if (!cancelled) setProjectLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [routeProjectId]);

  useEffect(() => {
    trackEvent('workspace_status_viewed', {
      route: '/workspace',
      project_stage: status.stage,
      preview_state: previewState,
      health_state: status.healthy ? 'healthy' : 'degraded',
      variant: 'studio-ledger-workspace',
    });
  }, [previewState, status.healthy, status.stage, trackEvent]);

  useEffect(() => {
    if (!selectedProjectId) return;
    trackEvent('project_opened', {
      route: '/workspace',
      project_stage: status.stage,
      health_state: status.healthy ? 'healthy' : 'degraded',
      action_source: 'workspace-projectId',
    });
  }, [selectedProjectId, status.healthy, status.stage, trackEvent]);

  useEffect(() => {
    if (activeTab === 'preview') {
      trackEvent('preview_opened', {
        route: '/workspace',
        project_stage: status.stage,
        preview_state: previewState,
        health_state: status.healthy ? 'healthy' : 'degraded',
      });
    }
    if (activeTab === 'build') {
      trackEvent('build_timeline_opened', {
        route: '/workspace',
        project_stage: status.stage,
        health_state: status.healthy ? 'healthy' : 'degraded',
      });
    }
  }, [activeTab, previewState, status.healthy, status.stage, trackEvent]);

  const selectProject = (projectId: string) => {
    router.push(`/workspace?projectId=${encodeURIComponent(projectId)}${activeTab !== 'overview' ? `&tab=${activeTab}` : ''}`);
  };

  const startOrRetryPreview = useCallback(async () => {
    if (!selectedProjectId || !selectedProject) return;
    setRetryingPreview(true);
    setErrorMessage(null);
    setPreviewResetKey((value) => value + 1);
    setSelectedProject(markPreviewStarting(selectedProject));
    setProjects((current) => current.map((project) => (project.id === selectedProjectId ? markPreviewStarting(project) : project)));
    setLiveMessage(`Starting preview for ${selectedProjectId}.`);

    trackEvent('preview_retry_clicked', {
      route: '/workspace',
      project_stage: status.stage,
      preview_state: previewState,
      retry_count: 1,
      action_source: 'workspace-preview-action',
    });

    try {
      await startPreview(selectedProjectId);
      await refreshProject(selectedProjectId);
      setLiveMessage('Preview run completed. Review the latest status.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Preview start failed.');
      await refreshProject(selectedProjectId).catch(() => null);
    } finally {
      setRetryingPreview(false);
    }
  }, [previewState, refreshProject, selectedProject, selectedProjectId, status.stage, trackEvent]);

  const handlePrimaryAction = useCallback(() => {
    if (!selectedProject) return;
    if (previewTruth.isFailure) {
      void startOrRetryPreview();
      return;
    }
    if (previewTruth.isBroken) {
      setActiveTab('logs');
      return;
    }
    if (previewTruth.isPlaceholder) {
      setActiveTab('verify');
      return;
    }
    if (status.key === 'preview-failed' || status.key === 'build-complete' || status.key === 'stale') {
      void startOrRetryPreview();
      return;
    }
    if (status.key === 'preview-starting') {
      setActiveTab('logs');
      return;
    }
    if (status.key === 'verification-pending' || status.key === 'preview-ready') {
      setActiveTab('verify');
      return;
    }
    if (status.key === 'launch-ready') {
      setActiveTab('export');
      return;
    }
    setActiveTab('build');
  }, [previewTruth.isBroken, previewTruth.isFailure, previewTruth.isPlaceholder, selectedProject, startOrRetryPreview, status.key]);

  const handleCommandSubmit = async (command: string) => {
    setCommandBusy(true);
    setErrorMessage(null);
    setPreviewResetKey((value) => value + 1);

    try {
      if (selectedProjectId && selectedProject) {
        setSelectedProject(clearPreviewForGeneration(selectedProject));
        setProjects((current) => current.map((project) => (project.id === selectedProjectId ? clearPreviewForGeneration(project) : project)));
        setLiveMessage(`Submitting change request for ${selectedProjectId}.`);
        trackEvent('command_submitted', {
          route: '/workspace',
          project_stage: status.stage,
          action_source: 'command-dock-change-request',
        });
        await updateProject(selectedProjectId, command);
        await refreshProject(selectedProjectId);
        setActiveTab('build');
      } else {
        setLiveMessage('Creating a new project from command dock.');
        trackEvent('command_submitted', {
          route: '/workspace',
          project_stage: 'decide',
          action_source: 'command-dock-create-project',
        });
        const result = await generateProject(command);
        const optimistic = makeOptimisticProject(result.projectId, command, result.project.name);
        setSelectedProject(optimistic);
        setProjects((current) => upsertProject(current, optimistic));
        router.replace(`/workspace?projectId=${encodeURIComponent(result.projectId)}&tab=build`);
        await refreshProject(result.projectId);
        setActiveTab('build');
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Command failed.');
    } finally {
      setCommandBusy(false);
    }
  };

  const handleExport = async () => {
    if (!selectedProjectId || !selectedProject) return;
    setExporting(true);
    setErrorMessage(null);
    try {
      await exportProject(selectedProjectId, selectedProject.name);
      setLiveMessage('Source export started.');
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  };

  const tabContent = useMemo(() => {
    if (!selectedProject) {
      return (
        <EmptyState
          title="No project selected"
          description="Choose a project by projectId or create a new software artifact from the command dock."
          action={<Link href="/projects"><Button variant="secondary">Browse projects</Button></Link>}
        />
      );
    }

    if (activeTab === 'preview') {
      return (
        <Panel title="Preview binding" subtitle="The preview frame is keyed by selectedProjectId to prevent old output from leaking between projects.">
          <dl className="grid gap-3 text-body-s sm:grid-cols-3">
            <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
              <dt className="text-label-s text-text-muted">Bound projectId</dt>
              <dd className="mt-1 break-all font-mono text-mono-s text-text-primary">{selectedProjectId}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
              <dt className="text-label-s text-text-muted">Preview state</dt>
              <dd className="mt-1 text-text-primary">{previewTruth.label}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
              <dt className="text-label-s text-text-muted">Runtime</dt>
              <dd className="mt-1 text-text-primary">{previewTruth.runtimeType ?? 'Not available'}</dd>
            </div>
          </dl>
          {previewTruth.contradictions.length ? (
            <ul className="mt-3 space-y-2 text-body-s text-status-warning">
              {previewTruth.contradictions.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
        </Panel>
      );
    }

    if (activeTab === 'build') {
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <BuildEvidencePanel
            pipelineStep={selectedProject.preview?.previewStep ?? (selectedProject.status === 'generating' ? 'Code generation' : 'Build artifact')}
            checksPassed={selectedProject.runtimeValidation?.finalVerdict === 'pass' ? 2 : selectedProject.status === 'completed' ? 1 : 0}
            checksTotal={2}
            runtimeMs={selectedProject.durationMs}
            costUsd={selectedProject.totalCostUsd}
          />
          <ProductionTimeline events={pipelineEvents} />
        </div>
      );
    }

    if (activeTab === 'verify') {
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <VerificationSummary
            runtimeStatus={selectedProject.runtimeValidation?.finalVerdict === 'pass' ? 'passed' : selectedProject.runtimeValidation?.finalVerdict === 'fail' ? 'failed' : 'pending'}
            qaStatus={status.key === 'verification-pending' || status.key === 'preview-ready' ? 'pending' : 'passed'}
            securityStatus={status.key === 'launch-ready' ? 'passed' : 'pending'}
          />
          <Panel title="Verification gate" subtitle="Completion requires required coverage, flow checks, and no critical failures.">
            <div className="grid gap-2 sm:grid-cols-2">
              <Badge variant={completionReport.metrics.requiredSatisfiedPct === 100 ? 'success' : 'warning'}>
                Required verified: {completionReport.metrics.requiredSatisfiedPct}%
              </Badge>
              <Badge variant={completionReport.metrics.flowPassRate === 100 ? 'success' : 'warning'}>
                Flow pass rate: {completionReport.metrics.flowPassRate}%
              </Badge>
              <Badge variant={completionReport.metrics.criticalFailuresCount === 0 ? 'success' : 'error'}>
                Critical failures: {completionReport.metrics.criticalFailuresCount}
              </Badge>
              <Badge variant={completionReport.canComplete ? 'success' : 'warning'}>
                Completion gate: {completionReport.canComplete ? 'pass' : 'blocked'}
              </Badge>
            </div>
            {completionReport.unresolvedRequiredIds.length > 0 ? (
              <p className="mt-3 text-body-s text-text-secondary">Missing required items: {completionReport.unresolvedRequiredIds.join(', ')}</p>
            ) : null}
          </Panel>
        </div>
      );
    }

    if (activeTab === 'activity') {
      const history = selectedProject.promptHistory ?? [];
      return (
        <Panel title="Activity" subtitle="Change requests and lifecycle events for this projectId.">
          {history.length ? (
            <ul className="space-y-2">
              {history.slice(-8).reverse().map((entry, index) => (
                <li key={`${selectedProject.id}-${entry.createdAt}-${index}`} className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
                  <p className="text-label-s text-text-muted">{new Date(entry.createdAt).toLocaleString()}</p>
                  <p className="mt-1 text-body-s text-text-primary">{entry.text}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-body-s text-text-secondary">No change request history is available for this project.</p>
          )}
        </Panel>
      );
    }

    if (activeTab === 'logs') {
      return <LogEvidenceView entries={logEntries} />;
    }

    if (activeTab === 'export') {
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
          <div className="space-y-4">
            <ExportActionPanel
              project={selectedProject}
              status={status}
              completionBlocked={!completionReport.canComplete}
              exporting={exporting}
              onExport={handleExport}
            />
            <LaunchChecklist
              items={[
                { id: 'build', label: 'Build completed successfully', done: selectedProject.status === 'completed' },
                { id: 'preview', label: 'Preview is healthy', done: previewTruth.isHealthy, note: previewTruth.isHealthy ? undefined : previewTruth.label },
                { id: 'verify', label: 'Verification checks passed', done: status.key === 'launch-ready' || selectedProject.runtimeValidation?.finalVerdict === 'pass' },
                { id: 'coverage', label: 'Required contract coverage is 100%', done: completionReport.metrics.requiredSatisfiedPct === 100 },
              ]}
            />
          </div>
          <TrustRail project={selectedProject} selectedProjectId={selectedProjectId} status={status} />
        </div>
      );
    }

    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
        <div className="space-y-4">
          {status.key === 'stale' ? <SyncWarningPanel retrying={retryingPreview} onRefresh={startOrRetryPreview} onInspect={() => setActiveTab('logs')} /> : null}
          <ProjectStatusSummary
            status={status}
            buildHealthy={selectedProject.status !== 'failed'}
            previewHealthy={previewTruth.isHealthy}
            verificationHealthy={selectedProject.runtimeValidation?.finalVerdict === 'pass'}
            stale={status.key === 'stale'}
            timeline={timeline}
            onPrimaryAction={handlePrimaryAction}
          />
          <DiagnosticsSummary project={selectedProject} status={status} previewTruth={previewTruth} onOpenLogs={() => setActiveTab('logs')} onRetryPreview={startOrRetryPreview} retrying={retryingPreview} />
        </div>
        <TrustRail project={selectedProject} selectedProjectId={selectedProjectId} status={status} />
      </div>
    );
  }, [
    activeTab,
    completionReport,
    exporting,
    handlePrimaryAction,
    logEntries,
    pipelineEvents,
    previewTruth,
    retryingPreview,
    selectedProject,
    selectedProjectId,
    startOrRetryPreview,
    status,
    timeline,
  ]);

  return (
    <AppShell
      title="Workspace / Builder"
      subtitle="Production surface for previewing, changing, verifying, and exporting generated applications."
      lifecycle={{ label: status.label, tone: status.tone }}
      breadcrumbs={[{ label: 'Workspace', href: '/workspace' }, selectedProjectId ? { label: selectedProjectId } : { label: 'No project selected' }]}
      actions={<Button onClick={handlePrimaryAction} disabled={!selectedProject}>{status.nextActionLabel}</Button>}
      secondaryActions={<Link href="/projects"><Button variant="secondary">Projects</Button></Link>}
      workspaceName="DEVteam Studio"
      projectName={selectedProject?.name}
    >
      <section aria-live="polite" className="sr-only">{liveMessage}</section>

      <div className="space-y-5">
        {errorMessage ? <SystemBanner tone="error" title="Workspace action failed" description={errorMessage} /> : null}
        {projectLoading || projectsLoading ? <SystemBanner tone="info" title="Loading project evidence" description="Fetching the latest project and preview state from the backend." /> : null}
        {selectedProjectId && !selectedProject && !projectLoading ? (
          <SystemBanner tone="warning" title="Project not found" description={`No backend project record was found for projectId ${selectedProjectId}. Choose another project or create a new one.`} />
        ) : null}
        {(previewTruth.isFailure || previewTruth.isBroken || previewTruth.isPlaceholder || previewTruth.contradictions.length > 0) && selectedProject ? (
          <SystemBanner
            tone={previewTruth.tone === 'error' ? 'error' : 'warning'}
            title={previewTruth.label}
            description={previewTruth.exactReason ?? previewTruth.description}
            actions={<Button variant="secondary" loading={retryingPreview} onClick={previewTruth.isFailure ? startOrRetryPreview : () => setActiveTab('logs')}>{previewTruth.isFailure ? 'Retry preview' : 'Inspect diagnostics'}</Button>}
          />
        ) : null}
        {!completionReport.canComplete && selectedProject ? (
          <SystemBanner
            tone="warning"
            title="Completion gate blocked"
            description={`Required coverage ${completionReport.metrics.requiredSatisfiedPct}% | flow pass ${completionReport.metrics.flowPassRate}% | critical failures ${completionReport.metrics.criticalFailuresCount}.`}
          />
        ) : null}

        <WorkspaceHeader
          project={selectedProject}
          projects={projects}
          selectedProjectId={selectedProjectId}
          status={status}
          loading={projectLoading || projectsLoading}
          onSelectProject={selectProject}
          onPrimaryAction={handlePrimaryAction}
        />

        <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <PreviewCanvasFrame
            key={previewKey}
            title="Artifact preview"
            ready={Boolean(previewIsBound(selectedProject, selectedProjectId) && previewTruth.isHealthy)}
            failed={Boolean(previewIsBound(selectedProject, selectedProjectId) && previewTruth.isFailure)}
            loading={Boolean(previewIsBound(selectedProject, selectedProjectId) && previewTruth.isLoading)}
            url={getPreviewUrl(selectedProject, selectedProjectId)}
            message={selectedProject ? 'Preview output will appear here after the selected project runtime is healthy.' : 'Select or create a project to generate a preview.'}
            device={previewDevice}
            onDeviceChange={setPreviewDevice}
            previewTruth={previewTruth}
            runtimeType={previewTruth.runtimeType}
            onRetry={selectedProject ? startOrRetryPreview : undefined}
            retrying={retryingPreview}
          />
          <div className="space-y-4">
            {selectedProject ? (
              <>
                <ProjectStatusSummary
                  status={status}
                  buildHealthy={selectedProject.status !== 'failed'}
                  previewHealthy={previewTruth.isHealthy}
                  verificationHealthy={selectedProject.runtimeValidation?.finalVerdict === 'pass'}
                  stale={status.key === 'stale'}
                  timeline={timeline}
                  onPrimaryAction={handlePrimaryAction}
                />
                <DiagnosticsSummary
                  project={selectedProject}
                  status={status}
                  previewTruth={previewTruth}
                  onOpenLogs={() => setActiveTab('logs')}
                  onRetryPreview={startOrRetryPreview}
                  retrying={retryingPreview}
                />
              </>
            ) : (
              <Panel title="Workspace state" subtitle="No projectId is selected.">
                <p className="text-body-s text-text-secondary">Use the project selector or create a project from the command dock. The preview will not render without a selected projectId.</p>
              </Panel>
            )}
          </div>
        </div>

        <CommandDock
          projectId={selectedProjectId}
          mode={selectedProjectId && selectedProject ? 'change' : 'create'}
          busy={commandBusy}
          onSubmit={handleCommandSubmit}
        />

        {(previewTruth.isFailure || previewTruth.isBroken) && selectedProject ? (
          <InlineStatusPanel
            tone="error"
            title={previewTruth.label}
            where="Preview runner"
            whatWorked="The project artifact remains bound to its projectId and prior output has been cleared for the next run."
            whatFailed={previewTruth.exactReason ?? 'The runtime did not become healthy. Logs contain the diagnostic evidence.'}
            nextAction="Submit a scoped repair request or retry preview after reviewing logs."
            actions={<Button variant="secondary" onClick={() => setActiveTab('logs')}>Inspect logs</Button>}
          />
        ) : null}

        <WorkspaceTabs value={activeTab} onChange={setActiveTab} />
        <section role="tabpanel" id={`${activeTab}-panel`} aria-labelledby={`${activeTab}-tab`} className="min-w-0">
          {tabContent}
        </section>

        {retryingPreview ? <Toast tone="retrying" title="Preview in progress" message="Starting runtime and refreshing project evidence." /> : null}
        {commandBusy ? <Toast tone="info" title="Command submitted" message="Clearing stale preview state and waiting for backend project evidence." /> : null}
      </div>
    </AppShell>
  );
}
