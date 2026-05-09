import Link from 'next/link';
import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Card, EmptyState, StatusDot } from '../../../../components/ui';
import { deriveProjectPresentation } from '../model/project-presentation';

interface DashboardHeroProps {
  project: GeneratedProject | null;
}

function toneToBadge(tone: 'neutral' | 'active' | 'success' | 'warning' | 'error') {
  if (tone === 'active') return 'active';
  return tone;
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
            <Badge variant={toneToBadge(vm.health.tone)}>{vm.health.label}</Badge>
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
          <h3 className="text-label-m text-text-primary">Artifact health</h3>
          <div className="mt-4 space-y-3">
            <StatusDot tone={vm.build.tone === 'error' ? 'error' : vm.build.tone === 'active' ? 'active' : 'success'} label={`Build: ${vm.build.label}`} />
            <StatusDot tone={vm.preview.tone === 'error' ? 'error' : vm.preview.tone === 'active' ? 'active' : vm.preview.tone === 'success' ? 'success' : 'neutral'} label={`Preview: ${vm.preview.label}`} />
            <StatusDot tone={vm.export.tone === 'error' ? 'error' : vm.export.tone === 'warning' ? 'warning' : vm.export.tone === 'success' ? 'success' : 'neutral'} label={`Export: ${vm.export.label}`} />
          </div>
          <dl className="mt-4 border-t border-border-muted pt-4 text-body-s text-text-secondary">
            <div className="flex justify-between gap-3"><dt>Stack</dt><dd className="truncate text-text-primary">{vm.stackLabel}</dd></div>
            <div className="mt-2 flex justify-between gap-3"><dt>Updated</dt><dd className="text-text-primary">{vm.lastUpdatedLabel}</dd></div>
          </dl>
        </div>
      </div>
    </Card>
  );
}
