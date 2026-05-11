import Link from 'next/link';
import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Card, EmptyState } from '../../../../components/ui';
import { deriveProjectPresentation, sortProjectsByUpdated } from '../model';

interface RecentProjectsProps {
  projects: GeneratedProject[];
  limit?: number;
}

export function RecentProjects({ projects, limit = 4 }: RecentProjectsProps) {
  const recent = sortProjectsByUpdated(projects).slice(0, limit);

  if (recent.length === 0) {
    return (
      <EmptyState
        title="No recent projects"
        description="Generated projects will appear here with build, preview, and export state."
        action={<Link href="/workspace"><Button variant="secondary">Create project</Button></Link>}
      />
    );
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title-s text-text-primary">Recent projects</h2>
          <p className="mt-1 text-body-s text-text-secondary">Latest software artifacts from backend project records.</p>
        </div>
        <Link href="/projects"><Button variant="secondary" size="sm">Open portfolio</Button></Link>
      </div>
      <div className="mt-5 grid gap-3 lg:grid-cols-2">
        {recent.map((project) => {
          const vm = deriveProjectPresentation(project);
          return (
            <Link
              key={vm.projectId}
              href={`/workspace?projectId=${encodeURIComponent(vm.projectId)}`}
              className="min-w-0 rounded-[var(--radius-panel)] border border-border bg-surface-base p-4 shadow-hairline transition-colors hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate text-label-m text-text-primary" title={vm.name}>{vm.name}</h3>
                  <p className="mt-1 truncate font-mono text-mono-s text-text-muted">{vm.projectId}</p>
                </div>
                <Badge variant={vm.health.tone === 'active' ? 'active' : vm.health.tone}>{vm.health.label}</Badge>
              </div>
              <div className="mt-4 grid gap-2 text-label-s text-text-secondary sm:grid-cols-2">
                <span>Stage: {vm.health.stage}</span>
                <span>Updated {vm.lastUpdatedLabel}</span>
              </div>
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
