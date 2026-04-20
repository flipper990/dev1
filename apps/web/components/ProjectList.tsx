import type { GeneratedProject } from '../types/dashboard';

interface ProjectListProps {
  projects: GeneratedProject[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}

export function ProjectList({ projects, selectedProjectId, onSelect }: ProjectListProps) {
  return (
    <section className="panel">
      <div className="panel__header panel__header--split">
        <h2>Projects</h2>
        <span className="count-chip">{projects.length}</span>
      </div>

      <div className="project-list">
        {projects.length === 0 ? (
          <div className="empty-state">No projects yet.</div>
        ) : (
          projects.map((project) => (
            <button
              className={`project-item ${selectedProjectId === project.id ? 'project-item--active' : ''}`}
              key={project.id}
              onClick={() => onSelect(project.id)}
              type="button"
            >
              <div className="project-item__top">
                <span className="project-item__name">{project.name}</span>
                <span className={`step-badge step-badge--${project.status === 'completed' ? 'completed' : project.status === 'failed' ? 'failed' : 'running'}`}>
                  {project.status}
                </span>
              </div>
              <div className="project-item__meta mono">{project.id}</div>
              <div className="project-item__meta">
                {Math.round(project.totalCostUsd * 10000) / 10000} USD • {project.totalTokens} tokens
              </div>
            </button>
          ))
        )}
      </div>
    </section>
  );
}
