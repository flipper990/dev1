import Link from 'next/link';
import type { GeneratedProject } from '../../../../types/dashboard';
import { Button, Card, EmptyState } from '../../../../components/ui';
import { deriveProjectPresentation } from '../model/project-presentation';

interface DashboardHeroProps {
  project: GeneratedProject | null;
}

export function DashboardHero({ project }: DashboardHeroProps) {
  if (!project) {
    return (
      <EmptyState
        title="No active project"
        description="Start a project to create a software artifact with build, preview, verification, and export evidence."
        action={<Link href="/workspace"><Button>Start first project</Button></Link>}
      />
    );
  }

  const vm = deriveProjectPresentation(project);

  return (
    <Card className="overflow-hidden">
      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-label-s text-text-secondary">Stage: {vm.health.stage}</span>
            <span className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint px-2 py-1 font-mono text-mono-s text-text-muted">
              {vm.projectId}
            </span>
          </div>
          <h2 className="mt-4 truncate text-display-m text-text-primary" title={vm.name}>{vm.name}</h2>
          <p className="mt-3 max-w-[72ch] text-body-s text-text-secondary">
            Active software artifact in the {vm.health.stage} stage. Review health, inspect preview readiness, and continue from the next production action.
          </p>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <Link href={`/workspace?projectId=${encodeURIComponent(vm.projectId)}`}><Button>{vm.health.nextAction}</Button></Link>
            <Link href="/projects"><Button variant="secondary">View all projects</Button></Link>
          </div>
        </div>

        <div className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-4">
          <h3 className="text-label-m text-text-primary">Artifact details</h3>
          <dl className="mt-4 text-body-s text-text-secondary">
            <div className="flex justify-between gap-3"><dt>Stack</dt><dd className="truncate text-text-primary">{vm.stackLabel}</dd></div>
            <div className="mt-2 flex justify-between gap-3"><dt>Updated</dt><dd className="text-text-primary">{vm.lastUpdatedLabel}</dd></div>
            <div className="mt-2 flex justify-between gap-3"><dt>Tokens</dt><dd className="text-text-primary">{vm.usage.tokens.toLocaleString()}</dd></div>
            <div className="mt-2 flex justify-between gap-3"><dt>Cost</dt><dd className="text-text-primary">${vm.usage.costUsd.toFixed(2)}</dd></div>
          </dl>
        </div>
      </div>
    </Card>
  );
}
