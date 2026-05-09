import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Card, StatusDot } from '../../../../components/ui';
import { deriveUnifiedProjectStatus } from '../model/project-status';

interface ProjectCardProps {
  project: GeneratedProject;
  owner?: string;
  onOpen?: (projectId: string) => void;
}

export function ProjectCard({ project, owner = 'Platform team', onOpen }: ProjectCardProps) {
  const status = deriveUnifiedProjectStatus(project);

  return (
    <Card interactive className="overflow-hidden w-full max-w-full">
      <div className="h-36 rounded-[var(--radius-control)] border border-border bg-surface-tint w-full" aria-hidden="true" />
      <div className="mt-4 space-y-3 w-full">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 max-w-full">
            <h3 className="truncate break-words text-title-s text-ink w-full" title={project.name}>{project.name}</h3>
            <p className="mt-1 text-label-s text-secondary break-words">Owner: {owner}</p>
          </div>
          <Badge variant={status.healthy ? 'success' : status.tone === 'warning' ? 'warning' : 'error'}>
            {status.label}
          </Badge>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <StatusDot tone={status.healthy ? 'success' : 'warning'} label={`Stage: ${status.stage}`} />
          <span className="text-label-s text-secondary">Updated {new Date(project.createdAt).toLocaleDateString()}</span>
        </div>
        <Button variant="secondary" className="w-full" onClick={() => onOpen?.(project.id)}>
          Open workspace
        </Button>
      </div>
    </Card>
  );
}
