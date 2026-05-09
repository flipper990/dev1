'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { BookOpen, LifeBuoy } from 'lucide-react';
import { AppShell } from '../../src/components/shell';
import { Button, Card, Panel, Skeleton, StatusDot } from '../../components/ui';
import { listProjects } from '../../lib/api';
import type { GeneratedProject } from '../../types/dashboard';
import {
  DashboardHero,
  ProjectStageTimeline,
  ProjectStatusSummary,
  RecentProjects,
  UsageSummary,
} from '../../src/features/projects/components';
import { buildWorkflowTimelineViewModel, deriveUnifiedProjectStatus, sortProjectsByUpdated } from '../../src/features/projects/model';
import { derivePreviewTruth } from '../../src/features/preview/model';

export default function DashboardPage() {
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listProjects()
      .then((result) => {
        if (!alive) return;
        setProjects(sortProjectsByUpdated(result));
        setError(null);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : 'Unable to load projects.');
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  const activeProject = projects[0] ?? null;
  const status = deriveUnifiedProjectStatus(activeProject);
  const previewTruth = derivePreviewTruth(activeProject);
  const timeline = buildWorkflowTimelineViewModel(activeProject, status);

  const recentActivity = useMemo(() => {
    return projects
      .flatMap((project) => (project.promptHistory ?? []).map((entry) => ({ ...entry, projectId: project.id, projectName: project.name })))
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, 5);
  }, [projects]);

  return (
    <AppShell
      title="Overview"
      subtitle="Production health, usage, and next actions across generated software artifacts."
      lifecycle={{ label: loading ? 'Loading' : status.label, tone: loading ? 'neutral' : status.tone }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Overview' }]}
      actions={<Link href={activeProject ? `/workspace?projectId=${encodeURIComponent(activeProject.id)}` : '/workspace'}><Button>{status.nextActionLabel}</Button></Link>}
      secondaryActions={<Link href="/projects"><Button variant="secondary">Open projects</Button></Link>}
      contextTitle="Project evidence"
      contextDescription="Workflow state from backend project data"
      contextContent={<ProjectStageTimeline timeline={timeline} />}
      workspaceName="DEVteam Studio"
    >
      {loading ? (
        <div className="space-y-4">
          <Skeleton lines={4} />
          <div className="grid gap-4 lg:grid-cols-2"><Skeleton lines={6} /><Skeleton lines={6} /></div>
        </div>
      ) : (
        <div className="min-w-0 space-y-4">
          {error ? (
            <div className="rounded-[var(--radius-panel)] border border-status-error bg-status-error-subtle p-4 text-body-s text-status-error" role="alert">
              {error}
            </div>
          ) : null}

          <DashboardHero project={activeProject} />

          <div className="grid min-w-0 gap-4 xl:grid-cols-[1.15fr_0.85fr]">
            <ProjectStatusSummary
              status={status}
              buildHealthy={activeProject?.status !== 'failed'}
              previewHealthy={previewTruth.isHealthy}
              verificationHealthy={activeProject?.runtimeValidation?.finalVerdict === 'pass'}
              stale={status.key === 'stale'}
              timeline={timeline}
            />
            <UsageSummary projects={projects} />
          </div>

          <div className="grid min-w-0 gap-4 xl:grid-cols-[1fr_360px]">
            <RecentProjects projects={projects} />

            <div className="space-y-4">
              <Panel title="Recent activity" subtitle="Latest prompts and project evidence.">
                {recentActivity.length === 0 ? (
                  <p className="text-body-s text-text-secondary">No activity yet.</p>
                ) : (
                  <ul className="space-y-3">
                    {recentActivity.map((entry, index) => (
                      <li key={`${entry.projectId}-${entry.createdAt}-${index}`} className="min-w-0 rounded-[var(--radius-control)] border border-border bg-surface-base p-3">
                        <p className="truncate text-label-m text-text-primary">{entry.projectName}</p>
                        <p className="mt-1 line-clamp-2 text-body-s text-text-secondary">{entry.text}</p>
                        <p className="mt-2 font-mono text-mono-s text-text-muted">{entry.projectId}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              <Panel title="Support and docs" subtitle="Shortcuts for production work.">
                <div className="space-y-3">
                  <Link href="/how-it-works" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface-base p-3 hover:bg-surface-tint">
                    <BookOpen className="mt-0.5 h-4 w-4 text-brand-primary" />
                    <span><span className="block text-label-m text-text-primary">Workflow docs</span><span className="block text-body-s text-text-secondary">Define, build, verify, preview, export, launch.</span></span>
                  </Link>
                  <Link href="/request-demo" className="flex items-start gap-3 rounded-[var(--radius-control)] border border-border bg-surface-base p-3 hover:bg-surface-tint">
                    <LifeBuoy className="mt-0.5 h-4 w-4 text-brand-primary" />
                    <span><span className="block text-label-m text-text-primary">Support</span><span className="block text-body-s text-text-secondary">Get help with production workflow setup.</span></span>
                  </Link>
                  <StatusDot tone={error ? 'error' : 'success'} label={error ? 'Project API unavailable' : 'Project API connected'} />
                </div>
              </Panel>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
