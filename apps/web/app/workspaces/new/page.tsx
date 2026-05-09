import { AuthShell, CreateWorkspaceForm } from '../../../src/components/auth';

export default function CreateWorkspacePage() {
  return (
    <AuthShell
      eyebrow="Create workspace"
      title="Set up your production workspace"
      subtitle="A workspace gives your team a controlled place for generated applications, validation evidence, and export workflows."
      asideTitle="Start with ownership boundaries."
      asideItems={[
        'Define the team or business unit that owns generated applications.',
        'Set the primary application category so onboarding can recommend the right workflow.',
        'Workspace creation requires authenticated account and membership contracts.',
      ]}
    >
      <CreateWorkspaceForm />
    </AuthShell>
  );
}
