import { SystemBanner } from '../../../components/feedback';
import type { GeneratedProject } from '../../../../types/dashboard';
import type { UnifiedProjectStatus } from '../../projects/model';
import { WorkspaceHeader } from './WorkspaceHeader';

interface WorkspaceStatusAreaProps {
  workspaceBanner: { tone: 'info' | 'warning' | 'error'; title: string; description: string } | null;
  project: GeneratedProject | null;
  projects: GeneratedProject[];
  selectedProjectId: string | null;
  status: UnifiedProjectStatus;
  loading: boolean;
  onSelectProject: (projectId: string) => void;
}

export function WorkspaceStatusArea({
  workspaceBanner,
  project,
  projects,
  selectedProjectId,
  status,
  loading,
  onSelectProject,
}: WorkspaceStatusAreaProps) {
  return (
    <>
      {workspaceBanner ? <SystemBanner tone={workspaceBanner.tone} title={workspaceBanner.title} description={workspaceBanner.description} /> : null}

      <WorkspaceHeader
        project={project}
        projects={projects}
        selectedProjectId={selectedProjectId}
        status={status}
        loading={loading}
        onSelectProject={onSelectProject}
      />
    </>
  );
}
