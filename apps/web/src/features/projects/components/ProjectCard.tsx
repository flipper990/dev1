import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Card } from '../../../../components/ui';
import { deriveProjectPresentation } from '../model/project-presentation';

interface ProjectCardProps {
  project: GeneratedProject;
  owner?: string;
  showDebugId?: boolean;
  onOpen?: (projectId: string) => void;
  onPreview?: (projectId: string) => void;
  onExport?: (projectId: string) => void;
}

function badgeTone(tone: 'neutral' | 'active' | 'success' | 'warning' | 'error') {
  return tone === 'active' ? 'active' : tone;
}

export function ProjectCard({ project, owner, showDebugId = false, onOpen, onPreview, onExport }: ProjectCardProps) {
  const vm = deriveProjectPresentation(project, owner);
  const canExport = project.status === 'generated';

  return (
    <Card className="min-w-0 overflow-hidden" padded={false}>
      <div className="border-b border-border-muted bg-surface-base p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-title-s text-text-primary" title={vm.name}>{vm.name}</h3>
            {showDebugId ? <p className="mt-1 truncate font-mono text-mono-s text-text-muted">{vm.projectId}</p> : null}
          </div>
          <Badge variant={badgeTone(vm.health.tone)}>{vm.health.label}</Badge>
        </div>
        <p className="mt-3 line-clamp-2 text-body-s text-text-secondary">{vm.stackLabel}</p>
      </div>

      <div className="space-y-4 p-4">
        <dl className="grid gap-3 text-body-s sm:grid-cols-2">
          <div className="min-w-0">
            <dt className="text-label-s text-text-muted">Owner</dt>
            <dd className="mt-1 truncate text-text-primary">{vm.owner}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-label-s text-text-muted">Last updated</dt>
            <dd className="mt-1 truncate text-text-primary">{vm.lastUpdatedLabel}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-label-s text-text-muted">Tokens</dt>
            <dd className="mt-1 truncate text-text-primary">{vm.usage.tokens.toLocaleString()}</dd>
          </div>
          <div className="min-w-0">
            <dt className="text-label-s text-text-muted">Cost</dt>
            <dd className="mt-1 truncate text-text-primary">${vm.usage.costUsd.toFixed(2)}</dd>
          </div>
        </dl>

        <div className="grid gap-2 sm:grid-cols-3">
          <Button variant="secondary" size="sm" onClick={() => onOpen?.(vm.projectId)} disabled={!onOpen} title={!onOpen ? 'Open action is not available here.' : undefined}>Open</Button>
          <Button variant="secondary" size="sm" onClick={() => onPreview?.(vm.projectId)} disabled={!onPreview || vm.preview.tone === 'neutral'} title={!onPreview ? 'Preview action is not available here.' : vm.preview.tone === 'neutral' ? 'Preview is not available for this project yet.' : undefined}>Preview</Button>
          <Button variant="secondary" size="sm" onClick={() => onExport?.(vm.projectId)} disabled={!onExport || !canExport} title={!onExport ? 'Export action is not available here.' : !canExport ? 'Export is available after code generation finishes.' : undefined}>Export</Button>
        </div>
      </div>
    </Card>
  );
}
