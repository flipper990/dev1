import Link from 'next/link';
import { AuthShell, SignupForm } from '../../src/components/auth';

export default function SignupPage() {
  return (
    <AuthShell
      eyebrow="Create account"
      title="Start a DEVteam workspace"
      subtitle="Create an account to generate full-stack applications, validate previews, and export source your team owns."
      footer={<span>Already have access? <Link href="/login" className="text-brand-primary hover:text-brand-primary-hover">Sign in</Link></span>}
    >
      <SignupForm />
    </AuthShell>
  );
}
