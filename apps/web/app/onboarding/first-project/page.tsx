import { AuthShell, FirstProjectSetupForm } from '../../../src/components/auth';

export default function FirstProjectSetupPage() {
  return (
    <AuthShell
      eyebrow="First project"
      title="Prepare your first full-stack build"
      subtitle="Define the application brief, choose a stack direction, and decide what verification should focus on before generation starts."
      asideTitle="A better first prompt is a production brief."
      asideItems={[
        'Stack selection guides frontend, backend, database, auth, and styling choices.',
        'Agents and pipeline stages translate the brief into specification, code, review, and validation work.',
        'Preview and verification should be treated as acceptance evidence before export.',
      ]}
    >
      <FirstProjectSetupForm />
    </AuthShell>
  );
}
