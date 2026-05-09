'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthShell, AcceptInviteForm } from '../../src/components/auth';

function AcceptInviteContent() {
  const params = useSearchParams();
  return (
    <AuthShell
      eyebrow="Workspace invite"
      title="Accept your workspace invitation"
      subtitle="Review the invite context before joining a DEVteam production workspace."
      asideTitle="Invites connect people to software production assets."
      asideItems={[
        'Workspace membership controls access to generated projects and diagnostics.',
        'Invite acceptance should validate token, email, and role before creating membership.',
        'SSO can be enabled once identity contracts are connected.',
      ]}
    >
      <AcceptInviteForm workspace={params.get('workspace')} inviter={params.get('inviter')} email={params.get('email')} />
    </AuthShell>
  );
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-surface-canvas p-6 text-body-s text-text-secondary">Loading invite...</div>}>
      <AcceptInviteContent />
    </Suspense>
  );
}
