'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AppShell } from '../../src/components/shell';
import { Badge, Button, Panel, Tabs } from '../../components/ui';
import {
  InlineStatusPanel,
  Modal,
  RecoveryActions,
  SystemBanner,
  Toast,
} from '../../src/components/feedback';
import { listProjects } from '../../lib/api';
import { getExperimentAssignments, getUiRedesignFlags } from '../../src/lib/flags/uiRedesignFlags';
import { useTrackEvent } from '../../src/lib/telemetry/useTrackEvent';
import type { GeneratedProject } from '../../types/dashboard';
import {
  BuildEvidencePanel,
  LaunchChecklist,
  ProjectCommandDock,
  ProjectHero,
  ProjectStageTimeline,
  ProjectStatusSummary,
  SyncWarningPanel,
  TrustSummaryPanel,
  VerificationSummary,
} from '../../src/features/projects/components';
import { deriveUnifiedProjectStatus } from '../../src/features/projects/model';
import { PreviewCanvasFrame } from '../../src/features/preview/components';
import { LogEvidenceView } from '../../src/features/logs/components';

const WORKSPACE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'preview', label: 'Preview' },
  { id: 'build', label: 'Build' },
  { id: 'verify', label: 'Verify' },
  { id: 'launch', label: 'Launch' },
  { id: 'activity', label: 'Activity' },
  { id: 'logs', label: 'Logs' },
];

export default function WorkspacePage() {
  const searchParams = useSearchParams();
  const trackEvent = useTrackEvent();
  const experiments = useMemo(() => getExperimentAssignments(), []);
  const flags = useMemo(() => getUiRedesignFlags(), []);
  const initialTab = searchParams.get('tab') ?? 'overview';
  const [activeTab, setActiveTab] = useState(initialTab);
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [liveMessage, setLiveMessage] = useState('Workspace ready.');
  const [retrying, setRetrying] = useState(false);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  const project = projects[0] ?? null;
  const status = deriveUnifiedProjectStatus(project);

  const previewState =
    status.key === 'preview-failed'
      ? 'failed'
      : status.key === 'preview-starting'
        ? 'starting'
        : status.key === 'preview-ready'
          ? 'ready'
          : status.key === 'stale'
            ? 'stale'
            : 'idle';

  const retryPreview = () => {
    const nextRetryCount = retryCount + 1;
    setRetryCount(nextRetryCount);
    setRetrying(true);
    setLiveMessage('Retrying preview startup.');
    trackEvent('preview_retry_clicked', {
      route: '/workspace',
      project_stage: status.stage,
      preview_state: previewState,
      retry_count: nextRetryCount,
      action_source: 'workspace-recovery',
    });
    setTimeout(() => {
      setRetrying(false);
      setLiveMessage('Retry completed. Review latest status.');
    }, 1200);
  };

  useEffect(() => {
    setLiveMessage(`Project status changed: ${status.label}.`);
    trackEvent('workspace_status_viewed', {
      route: '/workspace',
      project_stage: status.stage,
      preview_state: previewState,
      health_state: status.healthy ? 'healthy' : 'degraded',
      variant: experiments.status_summary_variant,
    });
  }, [experiments.status_summary_variant, previewState, status.healthy, status.label, status.stage, trackEvent]);

  useEffect(() => {
    if (!project) return;
    trackEvent('project_opened', {
      route: '/workspace',
      project_stage: status.stage,
      health_state: status.healthy ? 'healthy' : 'degraded',
      action_source: 'workspace-entry',
    });
  }, [project, status.healthy, status.stage, trackEvent]);

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

  const tabContent = useMemo(() => {
    if (!project) {
      return <p className="text-body-s text-secondary">No project selected.</p>;
    }

    if (activeTab === 'preview') {
      return (
        <PreviewCanvasFrame
          ready={Boolean(project.preview?.previewReady)}
          failed={project.preview?.previewStatus === 'failed'}
          loading={project.preview?.previewStatus === 'starting' || project.preview?.previewStatus === 'building'}
          url={project.preview?.previewUrl ?? undefined}
          message="Preview output will appear as soon as runtime is healthy."
        />
      );
    }

    if (activeTab === 'build') {
      return (
        <div className="space-y-4">
          <BuildEvidencePanel
            pipelineStep={project.preview?.previewStep ?? 'Code generation'}
            checksPassed={project.runtimeValidation?.finalVerdict === 'pass' ? 2 : 1}
            checksTotal={2}
            runtimeMs={project.durationMs}
            costUsd={project.totalCostUsd}
          />
          {(status.key === 'preview-failed' || status.key === 'preview-starting') ? (
            <InlineStatusPanel
              tone={status.key === 'preview-failed' ? 'error' : 'warning'}
              title={status.key === 'preview-failed' ? 'Preview boot failed' : 'Preview still starting'}
              where="Build -> runtime startup"
              whatWorked="Build artifacts were generated and persisted."
              whatFailed={status.key === 'preview-failed' ? 'Preview runtime did not become healthy.' : 'Health checks are still pending.'}
              nextAction="Retry startup, then inspect grouped log evidence."
              actions={
                <RecoveryActions
                  retrying={retrying}
                  onPrimary={retryPreview}
                  onSecondary={() => setActiveTab('logs')}
                  onTertiary={() => setShowRecoveryModal(true)}
                />
              }
            />
          ) : null}
        </div>
      );
    }

    if (activeTab === 'verify') {
      return (
        <VerificationSummary
          runtimeStatus={project.runtimeValidation?.finalVerdict === 'pass' ? 'passed' : project.runtimeValidation?.finalVerdict === 'fail' ? 'failed' : 'pending'}
          qaStatus={status.key === 'verification-pending' ? 'pending' : 'passed'}
          securityStatus={status.key === 'launch-ready' ? 'passed' : 'pending'}
        />
      );
    }

    if (activeTab === 'launch') {
      return (
        <div className="space-y-4">
          <LaunchChecklist
            items={[
              { id: '1', label: 'Build completed successfully', done: project.status === 'completed' },
              {
                id: '2',
                label: 'Preview is healthy',
                done: Boolean(project.preview?.previewReady),
                note: project.preview?.previewStatus === 'failed' ? 'Preview currently failed.' : undefined,
              },
              {
                id: '3',
                label: 'Verification checks passed',
                done: status.key === 'launch-ready' || project.runtimeValidation?.finalVerdict === 'pass',
              },
            ]}
          />
          <Panel title="Launch action" subtitle="Final approval before deployment.">
            <Button disabled={status.key !== 'launch-ready'}>Launch project</Button>
          </Panel>
        </div>
      );
    }

    if (activeTab === 'activity') {
      return (
        <Panel title="Recent activity" subtitle="Evidence timeline from prompts.">
          <ul className="space-y-2 text-body-s text-secondary">
            {(project.promptHistory ?? []).slice(-5).reverse().map((entry, index) => (
              <li key={`${entry.createdAt}-${index}`}>
                {new Date(entry.createdAt).toLocaleString()} - {entry.text}
              </li>
            ))}
          </ul>
        </Panel>
      );
    }

    if (activeTab === 'logs') {
      const logs = [
        {
          id: 'runtime-1',
          timestamp: project.preview?.previewRuntimeLog?.capturedAt ?? new Date().toISOString(),
          severity: project.preview?.previewStatus === 'failed' ? 'error' : 'info',
          step: project.preview?.previewStep ?? 'Preview',
          message: project.preview?.previewRuntimeLog?.stderrTail ?? 'No runtime stderr captured.',
          explanation:
            project.preview?.previewStatus === 'failed'
              ? 'Retry preview and verify environment configuration.'
              : 'Continue monitoring until preview is ready.',
        },
      ] as const;

      return <LogEvidenceView entries={[...logs]} />;
    }

    return (
      <div className="space-y-4">
        {status.key === 'stale' ? (
          <SyncWarningPanel retrying={retrying} onRefresh={retryPreview} onInspect={() => setActiveTab('logs')} />
        ) : null}
        {flags.ui_redesign_status_system && experiments.status_summary_variant === 'unified-summary' ? (
          <ProjectStatusSummary
            status={status}
            buildHealthy={project.status !== 'failed'}
            previewHealthy={Boolean(project.preview?.previewReady)}
            verificationHealthy={project.runtimeValidation?.finalVerdict === 'pass'}
            stale={status.key === 'stale'}
          />
        ) : (
          <Panel title="Legacy status row" subtitle="Experiment baseline for status visibility.">
            <div className="flex flex-wrap gap-2">
              <Badge variant={project.status === 'failed' ? 'error' : project.status === 'completed' ? 'success' : 'warning'}>
                Build: {project.status}
              </Badge>
              <Badge variant={project.preview?.previewReady ? 'success' : 'warning'}>
                Preview: {project.preview?.previewStatus ?? 'idle'}
              </Badge>
              <Badge variant={project.runtimeValidation?.finalVerdict === 'pass' ? 'success' : 'warning'}>
                Verify: {project.runtimeValidation?.finalVerdict ?? 'pending'}
              </Badge>
            </div>
          </Panel>
        )}
        <ProjectStageTimeline currentStage={status.stage} />
      </div>
    );
  }, [activeTab, experiments.status_summary_variant, flags.ui_redesign_status_system, project, retrying, status]);

  return (
    <AppShell
      title="Project workspace"
      subtitle="Primary production surface for deciding, building, verifying, and launching."
      lifecycle={{ label: status.label, tone: status.tone }}
      breadcrumbs={[{ label: 'Workspace', href: '/' }, { label: 'Project workspace' }]}
      actions={<Button>{status.nextActionLabel}</Button>}
      contextTitle="Trust and context"
      contextContent={<TrustSummaryPanel status={status} stale={status.key === 'stale'} syncedAt={project?.completedAt ?? undefined} />}
      defaultContextOpen
      workspaceName="DEVteam Studio"
    >
      <section aria-live="polite" className="sr-only">
        {liveMessage}
      </section>
      <div className="space-y-4">
        {(status.key === 'preview-failed' || status.key === 'stale' || status.key === 'preview-starting') ? (
          <SystemBanner
            tone={status.key === 'preview-failed' ? 'error' : status.key === 'stale' ? 'warning' : 'info'}
            title={status.key === 'preview-failed' ? 'Preview failed' : status.key === 'stale' ? 'State out of sync' : 'Preview starting'}
            description={status.description}
            actions={
              <RecoveryActions
                retrying={retrying}
                onPrimary={retryPreview}
                onSecondary={() => setActiveTab('logs')}
                onTertiary={() => setShowRecoveryModal(true)}
              />
            }
          />
        ) : null}

        <ProjectHero project={project} status={status} />
        <PreviewCanvasFrame
          ready={Boolean(project?.preview?.previewReady)}
          failed={project?.preview?.previewStatus === 'failed'}
          loading={project?.preview?.previewStatus === 'starting' || project?.preview?.previewStatus === 'building'}
          url={project?.preview?.previewUrl ?? undefined}
          message="The artifact preview is the hero surface for this workspace."
        />
        <Tabs items={WORKSPACE_TABS} value={activeTab} onChange={setActiveTab} ariaLabel="Workspace sections" />
        {tabContent}

        {flags.ui_redesign_workspace && experiments.command_dock_variant === 'command-dock' ? (
          <ProjectCommandDock
            onSubmit={() => {
              trackEvent('command_submitted', {
                route: '/workspace',
                project_stage: status.stage,
                action_source: 'command-dock',
              });
            }}
          />
        ) : (
          <Panel title="Prompt composer" subtitle="Legacy prompt flow for experiment parity.">
            <Button
              onClick={() =>
                trackEvent('command_submitted', {
                  route: '/workspace',
                  project_stage: status.stage,
                  action_source: 'legacy-prompt-composer',
                })
              }
            >
              Submit prompt
            </Button>
          </Panel>
        )}

        {retrying ? (
          <Toast tone="retrying" title="Retry in progress" message="Re-running preview startup checks." />
        ) : null}
      </div>

      <Modal
        open={showRecoveryModal}
        onClose={() => setShowRecoveryModal(false)}
        title="Recovery diagnostics"
        description="This run keeps completed artifacts and only retries failed runtime stages."
      >
        <InlineStatusPanel
          tone="warning"
          title="Recovery plan"
          where="Preview runtime"
          whatWorked="Generated build output and project evidence are intact."
          whatFailed="Preview health checks did not complete."
          nextAction="Retry startup and validate environment configuration."
          actions={
            <RecoveryActions
              retrying={retrying}
              onPrimary={retryPreview}
              onSecondary={() => setActiveTab('logs')}
              onTertiary={() => setShowRecoveryModal(false)}
            />
          }
        />
      </Modal>
    </AppShell>
  );
}
