import { AuthShell, ResetPasswordForm } from '../../src/components/auth';

export default function ResetPasswordPage() {
  return (
    <AuthShell
      eyebrow="Account recovery"
      title="Choose a new password"
      subtitle="Use a strong password before returning to your production workspace."
      asideTitle="Protect generated software assets."
      asideItems={[
        'DEVteam workspaces can contain generated source, logs, previews, and export paths.',
        'Password reset must be token-backed before it can be enabled.',
        'Use SSO or centralized identity when your organization requires it.',
      ]}
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
