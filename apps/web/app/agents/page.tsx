'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../src/components/shell';
import { Button, Card, EmptyState, Panel, Skeleton, StatusDot } from '../../components/ui';
import { ApiError, getSessionProgress, listActiveSessions, listProjects } from '../../lib/api';
import type { GeneratedProject, PipelineStep, SessionProgress } from '../../types/dashboard';
import { useTrackEvent } from '../../src/lib/telemetry/useTrackEvent';
import { ProductionTimeline, type AgentStepState, type TimelineEvent } from '../../src/features/agents/components';
import { deriveProjectPresentation, deriveUnifiedProjectStatus, sortProjectsByUpdated } from '../../src/features/projects/model';
import { derivePreviewTruth, previewToneToStatusDot } from '../../src/features/preview/model';

type EvidenceSource = 'session-progress' | 'preview-timeline' | 'project-history' | 'none';

interface ProjectActivityEvidence {
  project: GeneratedProject;
  progress: SessionProgress | null;
  progressError: string | null;
  events: TimelineEvent[];
  source: EvidenceSource;
}

function formatDuration(ms: number | undefined) {
  if (!ms || ms <= 0) return undefined;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${minutes}m ${remainder}s`;
}

function formatDate(value: string | undefined) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return date.toLocaleString();
}

function truncate(value: string, max = 160) {
  return value.length > max ? `${value.slice(0, max - 1)}...` : value;
}

function stepState(step: PipelineStep): AgentStepState {
  if (step.status === 'completed') return 'success';
  if (step.status === 'running') return 'running';
  if (step.status === 'failed') return 'failed';
  if (step.status === 'skipped') return 'warning';
  return 'pending';
}

function progressEvents(project: GeneratedProject, progress: SessionProgress): TimelineEvent[] {
  const stepEvents = progress.steps.map((step) => ({
    id: `${project.id}-${progress.sessionId}-${step.stepId}`,
    title: step.name,
    detail: step.error ? truncate(step.error) : `Pipeline step ${step.status}.`,
    owner: step.agent,
    state: stepState(step),
    runtime: formatDuration(step.durationMs),
    evidence: [`projectId ${project.id}`, `sessionId ${progress.sessionId}`],
  }));

  if (stepEvents.length > 0) return stepEvents;
  if (!progress.currentStep) return [];

  return [{
    id: `${project.id}-${progress.sessionId}-${progress.currentStep.stepId}`,
    title: progress.currentStep.name,
    detail: progress.currentStep.description,
    owner: progress.currentStep.agent,
    state: 'running',
    runtime: formatDuration(progress.durationMs),
    evidence: [`projectId ${project.id}`, `attempt ${progress.currentStep.attempt}`],
  }];
}

function previewEvents(project: GeneratedProject): TimelineEvent[] {
  return (project.preview?.timeline ?? []).slice(-10).map((event, index) => {
    const detail = event.details && typeof event.details === 'object'
      ? String((event.details.message ?? event.details.reason ?? event.details.error ?? `Preview ${event.previewStatus}`) as string)
      : `Preview ${event.previewStatus}`;

    return {
      id: `${project.id}-preview-${event.event}-${index}`,
      title: event.event.replace(/-/g, ' '),
      detail: truncate(detail),
      owner: 'Preview runner',
      state: event.previewStatus === 'failed' || event.event === 'failed' ? 'failed' : event.previewStatus === 'ready' ? 'success' : 'running',
      runtime: formatDuration(event.durationMs),
      evidence: [`projectId ${project.id}`, `captured ${formatDate(event.at)}`],
    };
  });
}

function promptEvents(project: GeneratedProject): TimelineEvent[] {
  return (project.promptHistory ?? []).slice(-6).reverse().map((entry, index) => ({
    id: `${project.id}-prompt-${entry.createdAt}-${index}`,
    title: 'Change request recorded',
    detail: truncate(entry.text),
    owner: 'Product input',
    state: 'success',
    evidence: [`projectId ${project.id}`, entry.sessionId ? `sessionId ${entry.sessionId}` : `created ${formatDate(entry.createdAt)}`],
  }));
}

function buildEvidence(project: GeneratedProject, progress: SessionProgress | null, progressError: string | null): ProjectActivityEvidence {
  if (progress) {
    const events = progressEvents(project, progress);
    if (events.length > 0) return { project, progress, progressError, events, source: 'session-progress' };
  }

  const persistedPreviewEvents = previewEvents(project);
  if (persistedPreviewEvents.length > 0) {
    return { project, progress, progressError, events: persistedPreviewEvents, source: 'preview-timeline' };
  }

  const persistedPromptEvents = promptEvents(project);
  if (persistedPromptEvents.length > 0) {
    return { project, progress, progressError, events: persistedPromptEvents, source: 'project-history' };
  }

  return { project, progress, progressError, events: [], source: 'none' };
}

function sourceLabel(source: EvidenceSource) {
  if (source === 'session-progress') return 'Live session progress';
  if (source === 'preview-timeline') return 'Persisted preview timeline';
  if (source === 'project-history') return 'Persisted project history';
  return 'No retained activity evidence';
}

export default function AgentsPage() {
  const router = useRouter();
  const trackEvent = useTrackEvent();
  const [rows, setRows] = useState<ProjectActivityEvidence[]>([]);
  const [activeSessionCount, setActiveSessionCount] = useState(0);
  const [activeSessionsError, setActiveSessionsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function loadActivity() {
      setLoading(true);
      setError(null);
      setActiveSessionsError(null);

      try {
        let sessionsError: string | null = null;
        const [projects, activeSessions] = await Promise.all([
          listProjects(),
          listActiveSessions().catch((err) => {
            sessionsError = err instanceof Error ? err.message : 'Unable to load active sessions.';
            return [];
          }),
        ]);

        const sortedProjects = sortProjectsByUpdated(projects);
        const evidence = await Promise.all(sortedProjects.map(async (project) => {
          if (!project.sessionId) return buildEvidence(project, null, 'Project has no sessionId in the backend record.');

          try {
            const progress = await getSessionProgress(project.sessionId);
            return buildEvidence(project, progress, null);
          } catch (err) {
            const progressError = err instanceof ApiError && err.status === 404
              ? 'Live session progress is no longer retained by /api/sessions/:id/progress.'
              : err instanceof Error ? err.message : 'Unable to load session progress.';
            return buildEvidence(project, null, progressError);
          }
        }));

        if (!alive) return;
        setRows(evidence);
        setActiveSessionCount(activeSessions.length);
        setActiveSessionsError(sessionsError);
      } catch (err) {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Unable to load project activity.');
      } finally {
        if (alive) setLoading(false);
      }
    }

    void loadActivity();
    return () => {
      alive = false;
    };
  }, []);

  const activeRow = useMemo(() => {
    return rows.find((row) => row.progress?.status === 'active')
      ?? rows.find((row) => row.events.length > 0)
      ?? rows[0]
      ?? null;
  }, [rows]);

  const activeProject = activeRow?.project ?? null;
  const activeStatus = deriveUnifiedProjectStatus(activeProject);
  const activePreview = derivePreviewTruth(activeProject);
  const activePresentation = activeProject ? deriveProjectPresentation(activeProject) : null;
  const projectCount = rows.length;
  const visibleEvents = activeRow?.events ?? [];
  const totalCost = rows.reduce((sum, row) => sum + (row.project.totalCostUsd ?? 0), 0);
  const totalTokens = rows.reduce((sum, row) => sum + (row.project.totalTokens ?? 0), 0);

  useEffect(() => {
    trackEvent('build_timeline_opened', {
      route: '/agents',
      project_stage: activeStatus.stage,
      health_state: activeStatus.healthy ? 'healthy' : 'degraded',
      action_source: activeRow?.source ?? 'none',
    });
  }, [activeRow?.source, activeStatus.healthy, activeStatus.stage, trackEvent]);

  return (
    <AppShell
      title="Activity"
      subtitle="Real production evidence from projects, live sessions, preview timelines, and retained project history."
      lifecycle={{ label: loading ? 'Loading' : activeStatus.label, tone: loading ? 'neutral' : activeStatus.tone }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Activity' }]}
      actions={
        <Button
          disabled={!activeProject}
          onClick={() => {
            if (activeProject) router.push(`/workspace?projectId=${encodeURIComponent(activeProject.id)}&tab=activity`);
          }}
        >
          Open workspace
        </Button>
      }
      contextTitle="Backend evidence"
      contextDescription="Activity data uses projectId as identity and does not synthesize missing agent history."
      contextContent={
        <div className="space-y-4">
          <Panel title="API bindings" subtitle="Sources used by this page">
            <div className="space-y-3">
              <StatusDot tone={error ? 'error' : 'success'} label={error ? 'Unable to load /api/projects' : 'Using /api/projects'} />
              <StatusDot tone={activeSessionsError ? 'warning' : 'success'} label={activeSessionsError ? 'Active sessions unavailable' : 'Using /api/sessions/active'} />
              <StatusDot tone="warning" label="No historical agent-event endpoint" />
              <p className="text-body-s text-text-secondary">
                Completed session step history is only shown when retained by the session API. Otherwise this page uses persisted preview and project history from real project records.
              </p>
            </div>
          </Panel>
          <Panel title="Selected artifact" subtitle="Actions are bound to projectId">
            <dl className="space-y-3 text-body-s text-text-secondary">
              <div>
                <dt className="text-label-s text-text-muted">projectId</dt>
                <dd className="mt-1 break-all font-mono text-mono-s text-text-primary">{activeProject?.id ?? 'No project selected'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Evidence source</dt>
                <dd className="text-text-primary">{activeRow ? sourceLabel(activeRow.source) : 'Not available'}</dd>
              </div>
              <div className="flex items-center justify-between gap-3">
                <dt>Active sessions</dt>
                <dd className="text-text-primary">{activeSessionCount}</dd>
              </div>
            </dl>
          </Panel>
        </div>
      }
      workspaceName="DEVteam Studio"
      projectName={activeProject?.name}
    >
      <div className="min-w-0 space-y-5">
        {error ? (
          <div className="rounded-[var(--radius-panel)] border border-status-error bg-status-error-subtle p-4 text-body-s text-status-error" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <Skeleton lines={12} />
            <Skeleton lines={10} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            title="No project activity"
            description="The backend returned no projects. Create a project to produce build, preview, diagnostics, and activity evidence."
            action={<Button onClick={() => router.push('/workspace')}>Create project</Button>}
          />
        ) : (
          <>
            <div className="grid gap-4 md:grid-cols-4">
              <Card>
                <p className="text-label-s text-text-muted">Projects</p>
                <p className="mt-2 text-title-m text-text-primary">{projectCount}</p>
              </Card>
              <Card>
                <p className="text-label-s text-text-muted">Active sessions</p>
                <p className="mt-2 text-title-m text-text-primary">{activeSessionCount}</p>
              </Card>
              <Card>
                <p className="text-label-s text-text-muted">Tokens</p>
                <p className="mt-2 text-title-m text-text-primary">{totalTokens.toLocaleString()}</p>
              </Card>
              <Card>
                <p className="text-label-s text-text-muted">Cost</p>
                <p className="mt-2 text-title-m text-text-primary">${totalCost.toFixed(2)}</p>
              </Card>
            </div>

            <div className="grid min-w-0 gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
              <div className="min-w-0 space-y-4">
                {activeRow && visibleEvents.length > 0 ? (
                  <ProductionTimeline
                    events={visibleEvents}
                    heading={`${activeProject?.name ?? 'Selected project'} activity`}
                    summary={`${sourceLabel(activeRow.source)} for projectId ${activeProject?.id}.`}
                  />
                ) : (
                  <EmptyState
                    title="No retained pipeline events"
                    description="This project has no live session progress, preview timeline, or prompt history in the backend record."
                  />
                )}
              </div>

              <div className="space-y-4">
                <Card>
                  <p className="text-label-s uppercase tracking-[0.16em] text-text-muted">Current artifact</p>
                  <h3 className="mt-2 truncate text-title-s text-text-primary">{activeProject?.name ?? 'No project selected'}</h3>
                  <div className="mt-3 space-y-2">
                    <StatusDot tone={activeStatus.tone} label={`Build: ${activeStatus.label}`} />
                    <StatusDot tone={previewToneToStatusDot(activePreview.tone)} label={`Preview: ${activePreview.label}`} />
                    <StatusDot tone={activePresentation?.export.tone === 'success' ? 'success' : activePresentation?.export.tone === 'error' ? 'error' : 'warning'} label={`Export: ${activePresentation?.export.label ?? 'Pending'}`} />
                  </div>
                  {activeRow?.progressError ? (
                    <p className="mt-4 rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3 text-body-s text-text-secondary">
                      {activeRow.progressError}
                    </p>
                  ) : null}
                </Card>

                <Panel title="Recent project records" subtitle="Sorted by latest backend evidence">
                  <ul className="space-y-2">
                    {rows.slice(0, 6).map((row) => {
                      const vm = deriveProjectPresentation(row.project);
                      return (
                        <li key={row.project.id}>
                          <button
                            type="button"
                            onClick={() => router.push(`/workspace?projectId=${encodeURIComponent(row.project.id)}&tab=activity`)}
                            className="w-full rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3 text-left transition-colors hover:border-border-strong hover:bg-surface-raised focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none"
                          >
                            <span className="block truncate text-label-s text-text-primary">{vm.name}</span>
                            <span className="mt-1 block break-all font-mono text-mono-s text-text-muted">{vm.projectId}</span>
                            <span className="mt-2 block text-body-s text-text-secondary">{sourceLabel(row.source)}</span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </Panel>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
