import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Card, Select } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../../projects/model';
import { sortProjectsByUpdated } from '../../projects/model';

interface WorkspaceHeaderProps {
  project: GeneratedProject | null;
  projects: GeneratedProject[];
  selectedProjectId: string | null;
  status: UnifiedProjectStatus;
  loading?: boolean;
  onSelectProject: (projectId: string) => void;
  onPrimaryAction: () => void;
}

function formatStack(project: GeneratedProject | null) {
  if (!project?.techStack || Object.keys(project.techStack).length === 0) {
    return project?.stackSelectionMode === 'manual' ? 'Manual stack selected' : 'Stack pending';
  }
  const preferred = ['frontend', 'backend', 'database']
    .map((key) => project.techStack?.[key])
    .filter(Boolean);
  const values = preferred.length > 0 ? preferred : Object.values(project.techStack).filter(Boolean);
  return values.slice(0, 4).join(' + ') || 'Stack pending';
}

export function WorkspaceHeader({
  project,
  projects,
  selectedProjectId,
  status,
  loading = false,
  onSelectProject,
  onPrimaryAction,
}: WorkspaceHeaderProps) {
  const sortedProjects = sortProjectsByUpdated(projects);

  return (
    <Card className="overflow-hidden bg-surface-base shadow-hairline" padded={false}>
      <div className="flex flex-col gap-3 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2 className="truncate text-title-s text-text-primary">
              {project?.name ?? (loading ? 'Loading project' : 'Select a project')}
            </h2>
            <Badge statusKey={status.key}>{status.label}</Badge>
          </div>
          <div className="mt-1 flex min-w-0 flex-wrap items-center gap-2 text-label-s text-text-secondary">
            {selectedProjectId ? <span className="max-w-[220px] truncate font-mono text-mono-s text-text-muted sm:max-w-[340px]">{selectedProjectId}</span> : null}
            {selectedProjectId ? <span className="text-text-muted">/</span> : null}
            <span className="max-w-[48ch] truncate">{formatStack(project)}</span>
          </div>
        </div>

        <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center lg:w-auto">
          <div className="min-w-0 flex-1 lg:w-[340px] lg:flex-none">
            <label htmlFor="workspace-project" className="sr-only">Project context</label>
            <Select
              id="workspace-project"
              value={selectedProjectId ?? ''}
              onChange={(event) => {
                if (event.target.value) onSelectProject(event.target.value);
              }}
              disabled={loading || sortedProjects.length === 0}
            >
              <option value="">{sortedProjects.length ? 'Choose project' : 'No projects available'}</option>
              {sortedProjects.map((item) => (
                <option key={item.id} value={item.id}>{item.name || 'Untitled project'} - {item.id}</option>
              ))}
            </Select>
          </div>
          <Button onClick={onPrimaryAction} disabled={!project} variant="secondary">
            {status.nextActionLabel}
          </Button>
        </div>
      </div>
    </Card>
  );
}
