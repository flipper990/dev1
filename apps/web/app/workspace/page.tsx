'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button, EmptyState, Panel } from '../../components/ui';
import {
  BuildEvidencePanel,
  LaunchChecklist,
  ProjectStatusSummary,
  SyncWarningPanel,
  VerificationSummary,
} from '../../src/features/projects/components';
import { LogEvidenceView } from '../../src/features/logs/components';
import { ProductionTimeline } from '../../src/features/agents/components';
import {
  AgentPipelineRail,
  DiagnosticsSummary,
  ExportActionPanel,
  TrustRail,
  WorkspaceMainPanel,
  WorkspacePageShell,
  WorkspaceSidePanel,
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

function WorkspacePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const trackEvent = useTrackEvent();
  const routeProjectId = searchParams.get('projectId');
  const rawTab = searchParams.get('tab');
  const [optimisticProject, setOptimisticProject] = useState<import('../../types/dashboard').GeneratedProject | null>(null);
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
    if (previewState.activeTab === 'build') {
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
          description="Choose a project by projectId or create a new software artifact from the command dock."
          action={<Link href="/projects"><Button variant="secondary">Browse projects</Button></Link>}
        />
      );
    }

    if (activeTab === 'preview') {
      return (
        <Panel title="Preview details" subtitle="Metadata for the generated application shown above. The iframe itself is rendered once and keyed by selectedProjectId.">
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
            checksPassed={selectedProject.verificationStatus === 'passed' ? 2 : selectedProject.status === 'generated' ? 1 : 0}
            checksTotal={2}
            runtimeMs={selectedProject.durationMs}
            costUsd={selectedProject.totalCostUsd}
          />
          <ProductionTimeline events={projectState.pipelineEvents} />
        </div>
      );
    }

    if (activeTab === 'verify') {
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <VerificationSummary
            runtimeStatus={
              selectedProject.verificationStatus === 'passed'
                ? 'passed'
                : selectedProject.verificationStatus === 'failed' || selectedProject.verificationStatus === 'warning'
                  ? 'failed'
                  : 'pending'
            }
            qaStatus={selectedProject.verificationStatus === 'passed' ? 'passed' : 'pending'}
            securityStatus={selectedProject.verificationStatus === 'passed' && previewTruth.isHealthy ? 'passed' : 'pending'}
          />
          <Panel title="Verification gate" subtitle="Completion requires required coverage, flow checks, and no critical failures.">
            <dl className="grid gap-2 text-body-s text-text-secondary sm:grid-cols-2">
              <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3"><dt>Required verified</dt><dd className="mt-1 text-text-primary">{completionReport.metrics.requiredSatisfiedPct}%</dd></div>
              <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3"><dt>Flow pass rate</dt><dd className="mt-1 text-text-primary">{completionReport.metrics.flowPassRate}%</dd></div>
              <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3"><dt>Critical failures</dt><dd className="mt-1 text-text-primary">{completionReport.metrics.criticalFailuresCount}</dd></div>
              <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3"><dt>Completion gate</dt><dd className="mt-1 text-text-primary">{completionReport.canComplete ? 'Pass' : 'Blocked'}</dd></div>
            </dl>
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
      return <LogEvidenceView entries={projectState.logEntries} />;
    }

    if (activeTab === 'export') {
      return (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
          <WorkspaceSidePanel>
            <ExportActionPanel
              project={selectedProject}
              completionBlocked={!completionReport.canComplete}
              exporting={generationState.exporting}
              onExport={actions.handleExport}
            />
            <LaunchChecklist
              items={[
                { id: 'build', label: 'Code generated successfully', done: selectedProject.status === 'generated' },
                { id: 'preview', label: 'Preview is healthy', done: previewTruth.isHealthy, note: previewTruth.isHealthy ? undefined : previewTruth.label },
                { id: 'verify', label: 'Verification checks passed', done: selectedProject.verificationStatus === 'passed' },
                { id: 'coverage', label: 'Required contract coverage is 100%', done: completionReport.metrics.requiredSatisfiedPct === 100 },
              ]}
            />
          </WorkspaceSidePanel>
          <TrustRail project={selectedProject} selectedProjectId={selectedProjectId} />
        </div>
      );
    }

    return (
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(320px,0.55fr)]">
        <WorkspaceSidePanel>
          {status.key === 'stale' ? <SyncWarningPanel retrying={generationState.retryingPreview} onRefresh={actions.startOrRetryPreview} onInspect={() => previewState.setActiveTab('logs')} /> : null}
          <ProjectStatusSummary
            status={status}
            timeline={projectState.timeline}
            onPrimaryAction={actions.handlePrimaryAction}
          />
          <DiagnosticsSummary project={selectedProject} status={status} previewTruth={previewTruth} onOpenLogs={() => previewState.setActiveTab('logs')} onRetryPreview={actions.startOrRetryPreview} retrying={generationState.retryingPreview} />
        </WorkspaceSidePanel>
        <TrustRail project={selectedProject} selectedProjectId={selectedProjectId} />
      </div>
    );
  }, [
    actions.handleExport,
    actions.handlePrimaryAction,
    actions.startOrRetryPreview,
    generationState.exporting,
    generationState.retryingPreview,
    previewState,
    projectState,
  ]);

  return (
    <WorkspacePageShell
      selectedProjectId={projectState.selectedProjectId}
      selectedProjectName={projectState.selectedProject?.name}
      nextActionLabel={projectState.status.nextActionLabel}
      canAct={Boolean(projectState.selectedProject)}
      onPrimaryAction={actions.handlePrimaryAction}
      liveMessage={generationState.liveMessage}
      pipelineContent={<AgentPipelineRail events={projectState.pipelineEvents} status={projectState.status} />}
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
          onPrimaryAction={actions.handlePrimaryAction}
        />

        <WorkspaceMainPanel
          selectedProject={projectState.selectedProject}
          selectedProjectId={projectState.selectedProjectId}
          previewTruth={projectState.previewTruth}
          previewKey={previewState.previewKey}
          previewDevice={previewState.previewDevice}
          onPreviewDeviceChange={previewState.setPreviewDevice}
          previewUrl={workspacePreviewUrl(projectState.selectedProject, projectState.selectedProjectId)}
          previewBound={workspacePreviewBound(projectState.selectedProject, projectState.selectedProjectId)}
          onRetryPreview={projectState.selectedProject ? actions.startOrRetryPreview : undefined}
          retryingPreview={generationState.retryingPreview}
          commandBusy={generationState.commandBusy}
          onCommandSubmit={(command) => { void actions.handleCommandSubmit(command); }}
          evidenceOpen={previewState.evidenceOpen}
          onEvidenceToggle={() => previewState.setEvidenceOpen((value) => !value)}
          activeTab={previewState.activeTab}
          onTabChange={previewState.setActiveTab}
          tabContent={tabContent}
        />
      </div>
    </WorkspacePageShell>
  );
}
