import { AuthShell, ForgotPasswordForm } from '../../src/components/auth';

export default function ForgotPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Reset your password"
      subtitle="Enter the work email associated with your DEVteam account."
      asideTitle="Secure recovery for production workspaces."
      asideItems={[
        'Password reset uses token issuance and verification on backend auth endpoints.',
        'Workspace and project access should remain protected by verified identity.',
        'Generated source and diagnostics should only be visible to authorized members.',
      ]}
    >
      <ForgotPasswordForm />
    </AuthShell>
  );
}
