import { AuthShell, OnboardingWelcome } from '../../src/components/auth';

export default function OnboardingPage() {
  return (
    <AuthShell
      eyebrow="Onboarding"
      title="Understand the DEVteam workflow"
      subtitle="Before creating a project, learn what DEVteam builds, what you own, and how preview, verification, export, stack selection, and agents fit together."
      asideTitle="DEVteam generates software foundations your team can own."
      asideItems={[
        'Generated output includes frontend, backend, database, and project structure.',
        'Preview means running output for review; verification means evidence and checks.',
        'Export moves source into your own engineering workflow.',
      ]}
    >
      <OnboardingWelcome />
    </AuthShell>
  );
}
