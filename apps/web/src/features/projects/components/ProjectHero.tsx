import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Card } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../model/project-status';

interface ProjectHeroProps {
  project: GeneratedProject | null;
  status: UnifiedProjectStatus;
  onPrimaryAction?: () => void;
}

export function ProjectHero({ project, status, onPrimaryAction }: ProjectHeroProps) {
  const projectName = project?.name ?? 'No project selected';

  return (
    <Card>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={status.healthy ? 'success' : status.tone === 'warning' ? 'warning' : 'error'}>
              {status.label}
            </Badge>
            <span className="text-label-s text-text-secondary">Stage: {status.stage}</span>
          </div>
          <div>
            <h2 className="text-title-l text-text-primary">{projectName}</h2>
            <p className="mt-2 max-w-[72ch] text-body-s text-text-secondary">{status.description}</p>
          </div>
        </div>

        <div className="min-w-[260px] rounded-[var(--radius-panel)] border border-border bg-surface-tint p-4">
          <p className="text-label-s text-text-muted">Primary action</p>
          <Button className="mt-2 w-full" onClick={onPrimaryAction} disabled={!onPrimaryAction} title={!onPrimaryAction ? 'Open the project workspace to run this action.' : undefined}>
            {onPrimaryAction ? status.nextActionLabel : 'Action unavailable'}
          </Button>
        </div>
      </div>
    </Card>
  );
}
