'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, EmptyState, Panel, Skeleton } from '../../components/ui';
import { VerificationSummary } from '../../src/features/projects/components';
import { LogEvidenceView } from '../../src/features/logs/components';
import { PreviewCanvasFrame } from '../../src/features/preview/components';
import {
  CodeWorkbench,
  ConversationWorkspace,
  DiagnosticsSummary,
  MemoryWorkspace,
  RuntimeControlPanel,
  WorkspaceMainPanel,
  WorkspacePageShell,
  WorkspaceStatusArea,
} from '../../src/features/workspace/components';
import { useTrackEvent } from '../../src/lib/telemetry/useTrackEvent';
import {
  useWorkspaceProject,
  workspacePreviewBound,
  workspacePreviewUrl,
} from '../../src/features/workspace/hooks/useWorkspaceProject';
import { useWorkspacePreview } from '../../src/features/workspace/hooks/useWorkspacePreview';
import { useWorkspaceGeneration } from '../../src/features/workspace/hooks/useWorkspaceGeneration';
import { useWorkspaceActions } from '../../src/features/workspace/hooks/useWorkspaceActions';

function WorkspaceLoading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="min-h-screen bg-surface-canvas p-4 sm:p-6">
      <span className="sr-only">Loading engineering workspace</span>
      <div className="mx-auto grid max-w-[1800px] gap-3 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_320px]">
        <Skeleton className="hidden h-[calc(100dvh-3rem)] lg:block" />
        <div className="space-y-4 rounded-[var(--radius-panel)] border border-border-muted bg-surface-base p-5"><Skeleton className="h-8 w-2/5"/><Skeleton className="h-10"/><Skeleton className="h-[60dvh]"/></div>
        <Skeleton className="hidden h-[calc(100dvh-3rem)] xl:block" />
      </div>
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

function WorkspacePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trackEvent = useTrackEvent();
  const routeProjectId = searchParams.get('projectId');
  const rawTab = searchParams.get('tab');
  const requestedSource = searchParams.get('source');
  const [optimisticProject, setOptimisticProject] = useState<import('../../types/dashboard').GeneratedProject | null>(null);
  const [contextMode, setContextMode] = useState<'run' | 'conversation' | 'memory'>('run');
  const handleRouteChanged = useCallback(() => {
    setOptimisticProject(null);
  }, []);

  const projectState = useWorkspaceProject({
    routeProjectId,
    optimisticProject,
  });

  const previewState = useWorkspacePreview({
    rawTab,
    routeProjectId,
    selectedProjectId: projectState.selectedProjectId,
    selectedProject: projectState.selectedProject,
    previewTruth: projectState.previewTruth,
  });

  const generationState = useWorkspaceGeneration({
    routeProjectId,
    selectedProjectId: projectState.selectedProjectId,
    selectedProject: projectState.selectedProject,
    projectLoading: projectState.projectLoading,
    onRouteChanged: handleRouteChanged,
  });

  const trackWorkspaceEvent = useCallback((event: string, props?: Record<string, unknown>) => {
    trackEvent(event as never, (props ?? {}) as never);
  }, [trackEvent]);

  const actions = useWorkspaceActions({
    router,
    trackEvent: trackWorkspaceEvent,
    activeTab: previewState.activeTab,
    setActiveTab: previewState.setActiveTab,
    selectedProjectId: projectState.selectedProjectId,
    selectedProject: projectState.selectedProject,
    status: projectState.status,
    previewTruth: projectState.previewTruth,
    previewState: previewState.previewState,
    refreshProject: projectState.refreshProject,
    setPreviewResetKey: previewState.setPreviewResetKey,
    setOptimisticProject,
    setLiveMessage: generationState.setLiveMessage,
    setErrorMessage: generationState.setErrorMessage,
    setRetryingPreview: generationState.setRetryingPreview,
    setCommandBusy: generationState.setCommandBusy,
    setExporting: generationState.setExporting,
  });

  useEffect(() => {
    trackEvent('workspace_status_viewed', {
      route: '/workspace',
      project_stage: projectState.status.stage,
      preview_state: previewState.previewState,
      health_state: projectState.status.healthy ? 'healthy' : 'degraded',
      variant: 'studio-ledger-workspace',
    });
  }, [previewState.previewState, projectState.status.healthy, projectState.status.stage, trackEvent]);

  useEffect(() => {
    if (!projectState.selectedProjectId) return;
    trackEvent('project_opened', {
      route: '/workspace',
      project_stage: projectState.status.stage,
      health_state: projectState.status.healthy ? 'healthy' : 'degraded',
      action_source: 'workspace-projectId',
    });
  }, [projectState.selectedProjectId, projectState.status.healthy, projectState.status.stage, trackEvent]);

  useEffect(() => {
    if (previewState.activeTab === 'preview') {
      trackEvent('preview_opened', {
        route: '/workspace',
        project_stage: projectState.status.stage,
        preview_state: previewState.previewState,
        health_state: projectState.status.healthy ? 'healthy' : 'degraded',
      });
    }
    if (previewState.activeTab === 'logs') {
      trackEvent('build_timeline_opened', {
        route: '/workspace',
        project_stage: projectState.status.stage,
        health_state: projectState.status.healthy ? 'healthy' : 'degraded',
      });
    }
  }, [previewState.activeTab, previewState.previewState, projectState.status.healthy, projectState.status.stage, trackEvent]);

  const workspaceBanner = generationState.errorMessage
    ? { tone: 'error' as const, title: 'Workspace action failed', description: generationState.errorMessage }
    : projectState.workspaceBanner;

  const navigateWorkspace = useCallback((tab: 'code' | 'preview' | 'logs' | 'diagnostics', source?: string) => {
    previewState.setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    if (source) params.set('source', source);
    router.replace(`/workspace?${params.toString()}`, { scroll: false });
  }, [previewState, router, searchParams]);

  const tabContent = useMemo(() => {
    const selectedProject = projectState.selectedProject;
    const selectedProjectId = projectState.selectedProjectId;
    const activeTab = previewState.activeTab;
    const status = projectState.status;
    const previewTruth = projectState.previewTruth;
    const completionReport = projectState.completionReport;

    if (!selectedProject) {
      return (
        <EmptyState
          title="No project selected"
          description="Choose a project or describe what you want to build below."
          action={<Link href="/projects"><Button variant="secondary">Browse projects</Button></Link>}
        />
      );
    }

    if (activeTab === 'preview') return (
      <PreviewCanvasFrame
        key={previewState.previewKey}
        title="App preview"
        ready={Boolean(workspacePreviewBound(selectedProject, selectedProjectId) && previewTruth.isHealthy)}
        failed={Boolean(workspacePreviewBound(selectedProject, selectedProjectId) && previewTruth.isFailure)}
        loading={Boolean(workspacePreviewBound(selectedProject, selectedProjectId) && previewTruth.isLoading)}
        url={workspacePreviewUrl(selectedProject, selectedProjectId)}
        message="The app preview appears here when the project runtime is ready."
        device={previewState.previewDevice}
        onDeviceChange={previewState.setPreviewDevice}
        previewTruth={previewTruth}
        onRetry={actions.startOrRetryPreview}
        retrying={generationState.retryingPreview}
      />
    );

    if (activeTab === 'code') return <CodeWorkbench projectId={selectedProjectId} requestedPath={requestedSource} onProjectChanged={async () => { await projectState.refreshProject(selectedProjectId!); }} />;
    if (activeTab === 'logs') return <LogEvidenceView entries={projectState.logEntries} onJumpToSource={(path) => navigateWorkspace('code', path)} onRelatedAgent={() => setContextMode('conversation')} onRelatedPrompt={() => setContextMode('conversation')} />;

    return (
      <div className="grid gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <DiagnosticsSummary project={selectedProject} status={status} previewTruth={previewTruth} onOpenLogs={() => navigateWorkspace('logs')} onRetryPreview={actions.startOrRetryPreview} retrying={generationState.retryingPreview} />
        <div className="space-y-4">
          <VerificationSummary runtimeStatus={selectedProject.verificationStatus === 'passed' ? 'passed' : selectedProject.verificationStatus === 'failed' || selectedProject.verificationStatus === 'warning' ? 'failed' : 'pending'} qaStatus={selectedProject.verificationStatus === 'passed' ? 'passed' : 'pending'} securityStatus={selectedProject.verificationStatus === 'passed' && previewTruth.isHealthy ? 'passed' : 'pending'} />
          <Panel title="Release checks" subtitle="The project can ship when required checks pass.">
            <dl className="grid gap-2 text-body-s text-text-secondary sm:grid-cols-2 2xl:grid-cols-1">
              <div className="rounded-[var(--radius-control)] bg-surface-tint p-3"><dt>Required checks</dt><dd className="mt-1 text-text-primary">{completionReport.metrics.requiredSatisfiedPct}% complete</dd></div>
              <div className="rounded-[var(--radius-control)] bg-surface-tint p-3"><dt>Critical issues</dt><dd className="mt-1 text-text-primary">{completionReport.metrics.criticalFailuresCount}</dd></div>
              <div className="rounded-[var(--radius-control)] bg-surface-tint p-3"><dt>Release status</dt><dd className="mt-1 text-text-primary">{completionReport.canComplete ? 'Ready' : 'Needs attention'}</dd></div>
            </dl>
          </Panel>
        </div>
      </div>
    );
  }, [
    actions.startOrRetryPreview,
    generationState.retryingPreview,
    previewState,
    projectState,
    requestedSource,
    navigateWorkspace,
  ]);

  return (
    <WorkspacePageShell
      selectedProjectId={projectState.selectedProjectId}
      selectedProjectName={projectState.selectedProject?.name}
      nextActionLabel={projectState.status.nextActionLabel}
      canAct={Boolean(projectState.selectedProject)}
      onPrimaryAction={actions.handlePrimaryAction}
      liveMessage={generationState.liveMessage}
      pipelineContent={
        <div className="space-y-4">
          <nav aria-label="Workspace context" className="grid grid-cols-3 gap-1 rounded-xl border border-border-subtle bg-surface-muted p-1">
            {(['run', 'conversation', 'memory'] as const).map((mode) => <button key={mode} onClick={() => setContextMode(mode)} aria-current={contextMode === mode ? 'page' : undefined} className={`rounded-lg px-2 py-2 text-label-xs capitalize transition-colors ${contextMode === mode ? 'bg-surface-card text-text-primary shadow-sm' : 'text-text-tertiary hover:text-text-secondary'}`}>{mode === 'conversation' ? 'AI thread' : mode}</button>)}
          </nav>
          {contextMode === 'run' && <RuntimeControlPanel
              projectId={projectState.selectedProjectId}
              onRefresh={async () => projectState.selectedProjectId ? projectState.refreshProject(projectState.selectedProjectId) : null}
            />}
          {contextMode === 'conversation' && <ConversationWorkspace
              project={projectState.selectedProject}
              pipelineEvents={projectState.pipelineEvents}
              busy={generationState.commandBusy || generationState.retryingPreview}
              onSubmit={async (prompt) => { await actions.handleCommandSubmit(prompt); }}
              onRefresh={async () => projectState.selectedProjectId ? projectState.refreshProject(projectState.selectedProjectId) : null}
            />}
          {contextMode === 'memory' && <MemoryWorkspace projectId={projectState.selectedProjectId} />}
        </div>
      }
    >
      <div className="space-y-4">
        <WorkspaceStatusArea
          workspaceBanner={workspaceBanner}
          project={projectState.selectedProject}
          projects={projectState.projects}
          selectedProjectId={projectState.selectedProjectId}
          status={projectState.status}
          loading={projectState.projectLoading || projectState.projectsLoading}
          onSelectProject={actions.selectProject}
        />

        <WorkspaceMainPanel
          selectedProjectId={projectState.selectedProjectId}
          retryingPreview={generationState.retryingPreview}
          commandBusy={generationState.commandBusy}
          onCommandSubmit={(command) => { void actions.handleCommandSubmit(command); }}
          activeTab={previewState.activeTab}
          onTabChange={(tab) => {
            previewState.setActiveTab(tab);
            const params = new URLSearchParams(searchParams.toString());
            params.set('tab', tab);
            router.replace(`/workspace?${params.toString()}`, { scroll: false });
          }}
          tabContent={tabContent}
        />
      </div>
    </WorkspacePageShell>
  );
}
