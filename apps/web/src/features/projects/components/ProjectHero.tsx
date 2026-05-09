import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Card, StatusDot } from '../../../../components/ui';
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
            <span className="text-label-s text-secondary">Stage: {status.stage}</span>
          </div>
          <div>
            <h2 className="text-title-l text-ink">{projectName}</h2>
            <p className="mt-2 max-w-[72ch] text-body-s text-secondary">{status.description}</p>
          </div>
        </div>

        <div className="min-w-[260px] space-y-2 rounded-[var(--radius-panel)] border border-border bg-surface-tint p-4">
          <StatusDot tone={status.healthy ? 'success' : 'warning'} label={status.healthy ? 'Healthy' : 'Needs attention'} />
          <StatusDot tone={project?.preview?.previewReady ? 'success' : 'neutral'} label={project?.preview?.previewReady ? 'Preview available' : 'Preview not ready'} />
          <Button className="mt-2 w-full" onClick={onPrimaryAction}>
            {status.nextActionLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
}
