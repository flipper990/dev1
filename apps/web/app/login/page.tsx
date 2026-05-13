import Link from 'next/link';
import { Suspense } from 'react';
import { AuthShell, LoginForm } from '../../src/components/auth';

export default function LoginPage() {
  return (
    <AuthShell
      title="Sign in to DEVteam"
      subtitle="Access your production workspace, generated projects, preview evidence, and export workflow."
      footer={<span>New to DEVteam? <Link href="/signup" className="text-brand-primary hover:text-brand-primary-hover">Create an account</Link></span>}
    >
      <Suspense fallback={<div className="text-body-s text-text-secondary">Loading sign-in…</div>}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
