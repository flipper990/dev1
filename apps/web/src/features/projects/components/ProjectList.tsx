import type { GeneratedProject } from '../../../../types/dashboard';
import { Button, EmptyState } from '../../../../components/ui';
import { ProjectCard } from './ProjectCard';

interface ProjectListProps {
  projects: GeneratedProject[];
  onOpenProject?: (projectId: string) => void;
  onEmptyAction?: () => void;
}

export function ProjectList({ projects, onOpenProject, onEmptyAction }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects yet"
        description="Start a build to create your first project workspace."
        action={
          <Button variant="secondary" onClick={onEmptyAction}>
            Create first project
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 w-full overflow-x-hidden">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} onOpen={onOpenProject} />
      ))}
    </div>
  );
}
