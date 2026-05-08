'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../src/components/shell';
import { Button, Card, Input, Panel } from '../../components/ui';
import { listProjects } from '../../lib/api';
import { getExperimentAssignments } from '../../src/lib/flags/uiRedesignFlags';
import { useTrackEvent } from '../../src/lib/telemetry/useTrackEvent';
import type { GeneratedProject } from '../../types/dashboard';
import { ProjectList } from '../../src/features/projects/components';
import { deriveUnifiedProjectStatus } from '../../src/features/projects/model';

export default function ProjectsPage() {
  const router = useRouter();
  const trackEvent = useTrackEvent();
  const experiments = useMemo(() => getExperimentAssignments(), []);
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<'all' | 'decide' | 'build' | 'verify' | 'launch'>('all');

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  const filtered = useMemo(() => {
    return projects.filter((project) => {
      const status = deriveUnifiedProjectStatus(project);
      const matchesQuery = project.name.toLowerCase().includes(query.toLowerCase());
      const matchesStage = stageFilter === 'all' || status.stage === stageFilter;
      return matchesQuery && matchesStage;
    });
  }, [projects, query, stageFilter]);

  return (
    <AppShell
      title="Projects"
      subtitle="Portfolio of real products progressing through Decide -> Build -> Verify -> Launch."
      lifecycle={{ label: `${filtered.length} visible`, tone: 'neutral' }}
      breadcrumbs={[{ label: 'Workspace', href: '/' }, { label: 'Projects' }]}
      actions={<Button onClick={() => router.push('/workspace')}>New project</Button>}
      contextTitle="Project portfolio health"
      contextContent={
        <Panel title="Filters" subtitle="Refine the project set">
          <div className="space-y-3">
            <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search projects" />
            <select
              value={stageFilter}
              onChange={(event) => setStageFilter(event.target.value as typeof stageFilter)}
              className="h-11 w-full rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 text-body-s text-ink"
            >
              <option value="all">All stages</option>
              <option value="decide">Decide</option>
              <option value="build">Build</option>
              <option value="verify">Verify</option>
              <option value="launch">Launch</option>
            </select>
          </div>
        </Panel>
      }
      workspaceName="DEVteam Studio"
    >
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search by project name"
              className="sm:max-w-[320px]"
            />
            <Button variant="secondary" onClick={() => setStageFilter('all')}>All</Button>
            <Button variant="secondary" onClick={() => setStageFilter('build')}>Build</Button>
            <Button variant="secondary" onClick={() => setStageFilter('verify')}>Verify</Button>
            <Button variant="secondary" onClick={() => setStageFilter('launch')}>Launch</Button>
          </div>
        </Card>

        <ProjectList
          projects={filtered}
          onOpenProject={(projectId) => {
            const selected = projects.find((project) => project.id === projectId);
            const selectedStatus = selected ? deriveUnifiedProjectStatus(selected) : null;
            trackEvent('project_opened', {
              route: '/projects',
              project_stage: selectedStatus?.stage ?? 'decide',
              action_source: 'projects-card',
            });
            router.push('/workspace');
          }}
          onEmptyAction={() => {
            trackEvent('empty_state_action_clicked', {
              route: '/projects',
              action_source: 'projects-empty-create-first',
              variant: experiments.status_summary_variant,
            });
            router.push('/workspace');
          }}
        />
      </div>
    </AppShell>
  );
}
