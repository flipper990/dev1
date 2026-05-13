import { Suspense } from 'react';
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
        'Password reset uses token-backed validation before password updates.',
        'Use SSO or centralized identity when your organization requires it.',
      ]}
    >
      <Suspense fallback={<div className="text-body-s text-text-secondary">Loading reset form…</div>}>
        <ResetPasswordForm />
      </Suspense>
    </AuthShell>
  );
}
