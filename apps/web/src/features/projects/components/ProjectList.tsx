import type { GeneratedProject } from '../../../../types/dashboard';
import { Button, EmptyState } from '../../../../components/ui';
import { ProjectCard } from './ProjectCard';

interface ProjectListProps {
  projects: GeneratedProject[];
  showDebugIds?: boolean;
  onOpenProject?: (projectId: string) => void;
  onPreviewProject?: (projectId: string) => void;
  onExportProject?: (projectId: string) => void;
  onEmptyAction?: () => void;
}

export function ProjectList({
  projects,
  showDebugIds = false,
  onOpenProject,
  onPreviewProject,
  onExportProject,
  onEmptyAction,
}: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        title="No matching projects"
        description="Create a project or adjust filters to see software artifacts with build, preview, and export status."
        action={
          <Button
            variant="secondary"
            onClick={onEmptyAction}
            disabled={!onEmptyAction}
            title={!onEmptyAction ? 'Project creation is not available on this surface.' : undefined}
          >
            {onEmptyAction ? 'Create project' : 'Create project unavailable'}
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid w-full min-w-0 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {projects.map((project) => (
        <ProjectCard
          key={project.id}
          project={project}
          showDebugId={showDebugIds}
          onOpen={onOpenProject}
          onPreview={onPreviewProject}
          onExport={onExportProject}
        />
      ))}
    </div>
  );
}
