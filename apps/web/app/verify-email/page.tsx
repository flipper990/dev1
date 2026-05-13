'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthShell, VerifyEmailPanel } from '../../src/components/auth';

function VerifyEmailContent() {
  const params = useSearchParams();
  return (
    <AuthShell
      eyebrow="Verify email"
      title="Verify your email address"
      subtitle="Email verification protects workspace access and source export actions."
      asideTitle="Verified identity protects production context."
      asideItems={[
        'Workspace membership should be tied to a verified email address.',
        'Preview, diagnostics, and export actions can expose sensitive application details.',
        'Verification links are token-backed and validated by backend auth contracts.',
      ]}
    >
      <VerifyEmailPanel email={params.get('email')} token={params.get('token')} />
    </AuthShell>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-canvas p-6 text-body-s text-text-secondary">Loading verification...</div>}>
      <VerifyEmailContent />
    </Suspense>
  );
}
