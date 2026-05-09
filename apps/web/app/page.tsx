'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { AppShell } from '../src/components/shell';
import { Badge, Button, Card, EmptyState, Panel } from '../components/ui';
import { listProjects } from '../lib/api';
import type { GeneratedProject } from '../types/dashboard';
import {
  BuildEvidencePanel,
  ProjectHero,
  ProjectStageTimeline,
  ProjectStatusSummary,
} from '../src/features/projects/components';
import { deriveUnifiedProjectStatus } from '../src/features/projects/model';

export default function HomePage() {
  const [projects, setProjects] = useState<GeneratedProject[]>([]);

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  const selectedProject = projects[0] ?? null;
  const status = deriveUnifiedProjectStatus(selectedProject);
  const recentProjects = projects.slice(0, 4);

  const recentActivity = useMemo(() => {
    if (!selectedProject) return [];
    return (selectedProject.promptHistory ?? []).slice(-3).reverse();
  }, [selectedProject]);

  return (
    <AppShell
      title="Overview"
      subtitle="Decide, build, verify, and launch with one clear lifecycle per project."
      lifecycle={{ label: status.label, tone: status.tone }}
      breadcrumbs={[{ label: 'Workspace' }, { label: 'Overview' }]}
      actions={<Link href="/workspace"><Button>{status.nextActionLabel}</Button></Link>}
      secondaryActions={<Link href="/projects"><Button variant="secondary">Open projects</Button></Link>}
      contextTitle="Trust details"
      contextDescription="Operational health and evidence context"
      contextContent={
        <div className="space-y-4">
          <ProjectStageTimeline currentStage={status.stage} />
          <BuildEvidencePanel
            checksPassed={selectedProject?.runtimeValidation?.finalVerdict === 'pass' ? 2 : 1}
            checksTotal={2}
            runtimeMs={selectedProject?.durationMs ?? 0}
            costUsd={selectedProject?.totalCostUsd ?? 0}
          />
        </div>
      }
      defaultContextOpen
      workspaceName="DEVteam Studio"
    >
      <div className="space-y-4">
        <ProjectHero project={selectedProject} status={status} />

        <ProjectStatusSummary
          status={status}
          buildHealthy={selectedProject?.status !== 'failed'}
          previewHealthy={Boolean(selectedProject?.preview?.previewReady)}
          verificationHealthy={selectedProject?.runtimeValidation?.finalVerdict === 'pass'}
          stale={status.key === 'stale'}
        />

        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="Quick actions" subtitle="Move the project lifecycle forward.">
            <div className="flex flex-wrap gap-2">
              <Link href="/workspace"><Button>Build</Button></Link>
              <Link href="/workspace?tab=verify"><Button variant="secondary">Verify</Button></Link>
              <Link href="/workspace?tab=launch"><Button variant="secondary">Launch</Button></Link>
            </div>
          </Panel>

          <Panel title="Recent activity" subtitle="Most recent project evidence.">
            {recentActivity.length === 0 ? (
              <p className="text-body-s text-secondary">No activity yet.</p>
            ) : (
              <ul className="space-y-2">
                {recentActivity.map((entry, index) => (
                  <li key={`${entry.createdAt}-${index}`} className="text-body-s text-secondary">
                    <span className="text-ink">{new Date(entry.createdAt).toLocaleString()}:</span> {entry.text}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>

        <Panel title="Recent projects" subtitle="Fast entry points into active workspaces.">
          {recentProjects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Create a project to begin the lifecycle."
              action={<Link href="/workspace"><Button>Start a project</Button></Link>}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {recentProjects.map((project) => {
                const projectStatus = deriveUnifiedProjectStatus(project);
                return (
                  <Card key={project.id} interactive>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <h3 className="text-title-s text-ink">{project.name}</h3>
                        <p className="mt-1 text-body-s text-secondary">{new Date(project.createdAt).toLocaleDateString()}</p>
                      </div>
                      <Badge variant={projectStatus.healthy ? 'success' : 'warning'}>{projectStatus.label}</Badge>
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
