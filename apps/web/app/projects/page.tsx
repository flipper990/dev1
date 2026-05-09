'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AppShell } from '../../src/components/shell';
import { Button, Panel, Skeleton, StatusDot } from '../../components/ui';
import { listProjects } from '../../lib/api';
import { getExperimentAssignments } from '../../src/lib/flags/uiRedesignFlags';
import { useTrackEvent } from '../../src/lib/telemetry/useTrackEvent';
import type { GeneratedProject } from '../../types/dashboard';
import {
  ProjectFilters,
  ProjectList,
  UsageSummary,
  type ProjectHealthFilter,
  type ProjectStageFilter,
} from '../../src/features/projects/components';
import { deriveProjectPresentation, deriveUnifiedProjectStatus, sortProjectsByUpdated } from '../../src/features/projects/model';

const SHOW_DEBUG_IDS = process.env.NODE_ENV !== 'production';

export default function ProjectsPage() {
  const router = useRouter();
  const trackEvent = useTrackEvent();
  const experiments = useMemo(() => getExperimentAssignments(), []);
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [stageFilter, setStageFilter] = useState<ProjectStageFilter>('all');
  const [healthFilter, setHealthFilter] = useState<ProjectHealthFilter>('all');

  useEffect(() => {
    const applySearch = (value: string | null) => {
      if (value) setQuery(value);
    };
    applySearch(new URLSearchParams(window.location.search).get('search'));

    const onProjectSearch = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (typeof detail === 'string') setQuery(detail);
    };

    window.addEventListener('devteam:project-search', onProjectSearch);
    return () => window.removeEventListener('devteam:project-search', onProjectSearch);
  }, []);

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

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return projects.filter((project) => {
      const status = deriveUnifiedProjectStatus(project);
      const vm = deriveProjectPresentation(project);
      const searchable = [vm.name, vm.projectId, vm.stackLabel, vm.owner].join(' ').toLowerCase();
      const matchesQuery = !needle || searchable.includes(needle);
      const matchesStage = stageFilter === 'all' || status.stage === stageFilter;
      const matchesHealth = healthFilter === 'all' || (healthFilter === 'healthy' ? status.healthy : !status.healthy);
      return matchesQuery && matchesStage && matchesHealth;
    });
  }, [projects, query, stageFilter, healthFilter]);

  const openProject = (projectId: string, tab?: string) => {
    const selected = projects.find((project) => project.id === projectId);
    const selectedStatus = selected ? deriveUnifiedProjectStatus(selected) : null;
    trackEvent('project_opened', {
      route: '/projects',
      project_stage: selectedStatus?.stage ?? 'decide',
      action_source: tab ? `projects-${tab}` : 'projects-card',
    });
    router.push(`/workspace?projectId=${encodeURIComponent(projectId)}${tab ? `&tab=${tab}` : ''}`);
  };

  return (
    <AppShell
      title="Projects"
      subtitle="Portfolio of generated software artifacts with build, preview, export, ownership, and usage state."
      lifecycle={{ label: loading ? 'Loading' : `${filtered.length} visible`, tone: 'neutral' }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Projects' }]}
      actions={<Button onClick={() => router.push('/workspace')}>New project</Button>}
      contextTitle="Portfolio health"
      contextContent={
        <Panel title="Backend data" subtitle="Project identity and state source">
          <div className="space-y-3">
            <StatusDot tone={error ? 'error' : 'success'} label={error ? 'Unable to load /api/projects' : 'Using /api/projects'} />
            <StatusDot tone={SHOW_DEBUG_IDS ? 'active' : 'neutral'} label={SHOW_DEBUG_IDS ? 'Debug project IDs visible' : 'Debug project IDs hidden'} />
            <p className="text-body-s text-text-secondary">Project actions use projectId as identity. Names are display labels only.</p>
          </div>
        </Panel>
      }
      workspaceName="DEVteam Studio"
    >
      <div className="min-w-0 space-y-4">
        <ProjectFilters
          query={query}
          stage={stageFilter}
          health={healthFilter}
          onQueryChange={setQuery}
          onStageChange={setStageFilter}
          onHealthChange={setHealthFilter}
          onReset={() => {
            setQuery('');
            setStageFilter('all');
            setHealthFilter('all');
          }}
        />

        {error ? (
          <div className="rounded-[var(--radius-panel)] border border-status-error bg-status-error-subtle p-4 text-body-s text-status-error" role="alert">
            {error}
          </div>
        ) : null}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"><Skeleton lines={8} /><Skeleton lines={8} /><Skeleton lines={8} /></div>
        ) : (
          <>
            <UsageSummary projects={filtered} />
            <ProjectList
              projects={filtered}
              showDebugIds={SHOW_DEBUG_IDS}
              onOpenProject={(projectId) => openProject(projectId)}
              onPreviewProject={(projectId) => openProject(projectId, 'preview')}
              onExportProject={(projectId) => openProject(projectId, 'launch')}
              onEmptyAction={() => {
                trackEvent('empty_state_action_clicked', {
                  route: '/projects',
                  action_source: 'projects-empty-create-first',
                  variant: experiments.status_summary_variant,
                });
                router.push('/workspace');
              }}
            />
          </>
        )}
      </div>
    </AppShell>
  );
}
