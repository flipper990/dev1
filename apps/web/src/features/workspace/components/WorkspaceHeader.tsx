import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Card, Select, StatusDot } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../../projects/model';
import { deriveProjectPresentation, sortProjectsByUpdated } from '../../projects/model';
import { derivePreviewTruth, previewToneToStatusDot } from '../../preview/model';

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

function previewLabel(project: GeneratedProject | null) {
  return derivePreviewTruth(project).label;
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
  const presentation = project ? deriveProjectPresentation(project) : null;
  const previewTruth = derivePreviewTruth(project);

  return (
    <Card className="overflow-hidden" padded={false}>
      <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-label-s uppercase tracking-[0.16em] text-text-muted">Production workspace</p>
              <h2 className="mt-2 truncate text-title-l text-text-primary">
                {project?.name ?? (loading ? 'Loading project' : 'Select a project')}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {selectedProjectId ? (
                  <span className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint px-2 py-1 font-mono text-mono-s text-text-secondary">
                    {selectedProjectId}
                  </span>
                ) : null}
                <Badge statusKey={status.key}>{status.label}</Badge>
              </div>
            </div>
            <Button onClick={onPrimaryAction} disabled={!project}>
              {status.nextActionLabel}
            </Button>
          </div>

          <dl className="mt-6 grid gap-3 sm:grid-cols-3">
            <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
              <dt className="text-label-s text-text-muted">Stack</dt>
              <dd className="mt-1 truncate text-body-s text-text-primary">{formatStack(project)}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
              <dt className="text-label-s text-text-muted">Preview</dt>
              <dd className="mt-1 text-body-s text-text-primary">{previewLabel(project)}</dd>
            </div>
            <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
              <dt className="text-label-s text-text-muted">Export</dt>
              <dd className="mt-1 text-body-s text-text-primary">{presentation?.export.label ?? 'Pending project'}</dd>
            </div>
          </dl>
        </div>

        <aside className="border-t border-border-muted bg-surface-base p-5 lg:border-l lg:border-t-0 sm:p-6">
          <label htmlFor="workspace-project" className="text-label-m text-text-primary">Project context</label>
          <p className="mt-1 text-body-s text-text-secondary">Selection and actions are bound to projectId.</p>
          <div className="mt-3">
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
          <div className="mt-4 space-y-2">
            <StatusDot tone={project?.status === 'failed' ? 'error' : project?.status === 'generating' ? 'active' : project ? 'success' : 'neutral'} label={`Build: ${project?.status ?? 'No project'}`} />
            <StatusDot tone={previewToneToStatusDot(previewTruth.tone)} label={`Preview: ${previewTruth.label}`} />
          </div>
        </aside>
      </div>
    </Card>
  );
}
