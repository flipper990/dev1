import Link from 'next/link';
import { Badge, Button, Card, EmptyState } from '../components/ui';
import type { GeneratedProject } from '../types/dashboard';
import { deriveUnifiedProjectStatus } from '../src/features/projects/model';

interface ProjectListProps {
  projects: GeneratedProject[];
  onOpenProject: (projectId: string) => void;
  onEmptyAction?: () => void;
}

export function ProjectList({ projects, onOpenProject, onEmptyAction }: ProjectListProps) {
  if (projects.length === 0) {
    return (
      <EmptyState
        title="No projects found"
        description="Try changing filters or create a new project."
        action={
          <Button onClick={onEmptyAction} disabled={!onEmptyAction}>
            Create project
          </Button>
        }
      />
    );
  }

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {projects.map((project) => {
        const status = deriveUnifiedProjectStatus(project);
        return (
          <Card key={project.id} interactive className="h-full">
            <div className="flex h-full flex-col justify-between gap-4">
              <div className="space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-title-s text-ink break-words">{project.name}</h3>
                  <Badge variant={status.healthy ? 'success' : status.key === 'preview-failed' ? 'error' : 'warning'}>
                    {status.label}
                  </Badge>
                </div>
                <p className="text-body-s text-secondary">
                  Created {new Date(project.createdAt).toLocaleDateString()}
                </p>
                <p className="text-body-s text-secondary">
                  {project.totalTokens.toLocaleString()} tokens · ${project.totalCostUsd.toFixed(4)}
                </p>
              </div>

              <div className="flex items-center justify-between gap-2">
                <Badge variant={project.status === 'completed' ? 'success' : project.status === 'failed' ? 'error' : 'warning'}>
                  Build: {project.status}
                </Badge>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => onOpenProject(project.id)}>
                    Open
                  </Button>
                  <Link href={`/workspace?projectId=${encodeURIComponent(project.id)}`} className="inline-flex">
                    <Button>Go to workspace</Button>
                  </Link>
                </div>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
