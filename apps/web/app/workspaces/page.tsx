import { AuthShell, WorkspaceSelectionForm } from '../../src/components/auth';

export default function WorkspacesPage() {
  return (
    <AuthShell
      eyebrow="Workspace selection"
      title="Choose a workspace"
      subtitle="Select the production workspace that contains your projects, previews, diagnostics, and exports."
      asideTitle="Workspaces organize production ownership."
      asideItems={[
        'Each workspace contains projects, generated source history, and operational evidence.',
        'Team access should be controlled before source export and launch workflows.',
        'Workspace state requires authenticated backend session support.',
      ]}
    >
      <WorkspaceSelectionForm />
    </AuthShell>
  );
}
