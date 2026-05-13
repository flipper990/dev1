'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckCircle2, KeyRound, Mail, UserPlus } from 'lucide-react';
import { Button, Input, Select, Textarea } from '../../../components/ui';
import {
  forgotPassword,
  resendVerificationEmail,
  resetPassword,
  signIn,
  signUp,
  verifyEmailToken,
  type AuthClientError,
} from '../../../lib/auth';
import { API_BASE } from '../../../lib/api-base';
import { AuthField, AuthStatus, DisabledAction } from './AuthShell';

type Availability = 'checking' | 'available' | 'error';

function useAuthAvailability() {
  const [state, setState] = useState<Availability>('checking');
  useEffect(() => {
    let canceled = false;
    fetch(`${API_BASE}/health`, { cache: 'no-store' })
      .then((response) => {
        if (!canceled) setState(response.ok ? 'available' : 'error');
      })
      .catch(() => {
        if (!canceled) setState('error');
      });
    return () => {
      canceled = true;
    };
  }, []);
  return state;
}

function emailError(email: string) {
  if (!email.trim()) return 'Email is required.';
  if (!/^\S+@\S+\.\S+$/.test(email)) return 'Use a valid work email address.';
  return undefined;
}

function passwordError(password: string) {
  if (!password) return 'Password is required.';
  if (password.length < 10) return 'Use at least 10 characters.';
  if (!/[A-Z]/.test(password)) return 'Include at least one uppercase letter.';
  if (!/[a-z]/.test(password)) return 'Include at least one lowercase letter.';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Include at least one symbol.';
  return undefined;
}

function nextDestination(params: URLSearchParams, fallback = '/overview') {
  const raw = params.get('next');
  if (!raw || !raw.startsWith('/')) return fallback;
  return raw;
}

function errorMessage(error: unknown, fallback: string): string {
  const authError = error as AuthClientError;
  return authError?.message ?? fallback;
}

export function LoginForm() {
  const availability = useAuthAvailability();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const errors = { email: emailError(email), password: passwordError(password) };
  const canSubmit = !errors.email && !errors.password && availability === 'available';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await signIn({ email: email.trim(), password });
      setSubmitSuccess('Signed in successfully. Redirecting…');
      router.push(nextDestination(searchParams, '/overview'));
    } catch (error) {
      setSubmitError(errorMessage(error, 'Unable to sign in.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => { void onSubmit(event); }} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="email" label="Work email" error={touched ? errors.email : undefined}>
        <Input id="email" type="email" autoComplete="email" value={email} onBlur={() => setTouched(true)} onChange={(event) => setEmail(event.target.value)} invalid={touched && Boolean(errors.email)} />
      </AuthField>
      <AuthField id="password" label="Password" error={touched ? errors.password : undefined}>
        <Input id="password" type="password" autoComplete="current-password" value={password} onBlur={() => setTouched(true)} onChange={(event) => setPassword(event.target.value)} invalid={touched && Boolean(errors.password)} />
      </AuthField>
      {submitError ? <p className="text-label-s text-status-error">{submitError}</p> : null}
      {submitSuccess ? <p className="text-label-s text-status-success">{submitSuccess}</p> : null}
      <Button type="submit" className="w-full" loading={submitting} disabled={!canSubmit}>
        Sign in
      </Button>
      <button
        type="button"
        disabled
        title="SSO requires an identity-provider backend contract"
        className="inline-flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-raised px-4 text-label-m text-text-muted"
      >
        <KeyRound className="h-4 w-4" /> SSO coming soon
      </button>
      <div className="flex flex-wrap justify-between gap-3 text-label-s text-text-secondary">
        <Link href="/forgot-password" className="hover:text-text-primary">Forgot password?</Link>
        <Link href="/signup" className="hover:text-text-primary">Create account</Link>
      </div>
    </form>
  );
}

export function SignupForm() {
  const availability = useAuthAvailability();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const errors = {
    name: name.trim() ? undefined : 'Name is required.',
    email: emailError(email),
    password: passwordError(password),
  };
  const canSubmit = !errors.name && !errors.email && !errors.password && availability === 'available';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const result = await signUp({ fullName: name.trim(), email: email.trim(), password });
      setSubmitSuccess('Account created successfully. Redirecting…');
      if (result.emailVerification?.required) {
        const params = new URLSearchParams({ email: email.trim() });
        if (result.emailVerification.token) params.set('token', result.emailVerification.token);
        router.push(`/verify-email?${params.toString()}`);
      } else {
        router.push('/overview');
      }
    } catch (error) {
      setSubmitError(errorMessage(error, 'Unable to create account.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => { void onSubmit(event); }} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="name" label="Full name" error={touched ? errors.name : undefined}>
        <Input id="name" autoComplete="name" value={name} onBlur={() => setTouched(true)} onChange={(event) => setName(event.target.value)} invalid={touched && Boolean(errors.name)} />
      </AuthField>
      <AuthField id="email" label="Work email" error={touched ? errors.email : undefined}>
        <Input id="email" type="email" autoComplete="email" value={email} onBlur={() => setTouched(true)} onChange={(event) => setEmail(event.target.value)} invalid={touched && Boolean(errors.email)} />
      </AuthField>
      <AuthField id="password" label="Password" hint="Use at least 10 characters, with uppercase, lowercase, number, and symbol." error={touched ? errors.password : undefined}>
        <Input id="password" type="password" autoComplete="new-password" value={password} onBlur={() => setTouched(true)} onChange={(event) => setPassword(event.target.value)} invalid={touched && Boolean(errors.password)} />
      </AuthField>
      {submitError ? <p className="text-label-s text-status-error">{submitError}</p> : null}
      {submitSuccess ? <p className="text-label-s text-status-success">{submitSuccess}</p> : null}
      <Button type="submit" className="w-full" loading={submitting} disabled={!canSubmit}>
        Create account
      </Button>
      <p className="text-label-s text-text-secondary">Already have an account? <Link href="/login" className="text-brand-primary hover:text-brand-primary-hover">Sign in</Link></p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const availability = useAuthAvailability();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | null>(null);
  const error = emailError(email);
  const canSubmit = !error && availability === 'available';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    setDevToken(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const response = await forgotPassword(email.trim());
      setSubmitSuccess(response.message);
      setDevToken(response.token ?? null);
    } catch (err) {
      setSubmitError(errorMessage(err, 'Unable to process password reset request.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => { void onSubmit(event); }} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="email" label="Account email" error={touched ? error : undefined}>
        <Input id="email" type="email" autoComplete="email" value={email} onBlur={() => setTouched(true)} onChange={(event) => setEmail(event.target.value)} invalid={touched && Boolean(error)} />
      </AuthField>
      {submitError ? <p className="text-label-s text-status-error">{submitError}</p> : null}
      {submitSuccess ? <p className="text-label-s text-status-success">{submitSuccess}</p> : null}
      {devToken ? (
        <p className="text-label-s text-text-secondary">
          Dev token: <Link href={`/reset-password?token=${encodeURIComponent(devToken)}`} className="text-brand-primary hover:text-brand-primary-hover">Open reset password</Link>
        </p>
      ) : null}
      <Button type="submit" className="w-full" loading={submitting} disabled={!canSubmit}>
        Send reset link
      </Button>
      <Link href="/login" className="block text-label-s text-text-secondary hover:text-text-primary">Return to sign in</Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const availability = useAuthAvailability();
  const params = useSearchParams();
  const [token, setToken] = useState(params.get('token') ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState<string | null>(null);
  const passwordMessage = passwordError(password);
  const confirmMessage = confirm && confirm !== password ? 'Passwords must match.' : !confirm ? 'Confirm your password.' : undefined;
  const tokenMessage = token.trim() ? undefined : 'Reset token is required.';
  const canSubmit = !passwordMessage && !confirmMessage && !tokenMessage && availability === 'available';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    setSubmitError(null);
    setSubmitSuccess(null);
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      const response = await resetPassword({ token: token.trim(), password });
      setSubmitSuccess(response.message);
    } catch (err) {
      setSubmitError(errorMessage(err, 'Unable to reset password.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="space-y-4" onSubmit={(event) => { void onSubmit(event); }} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="token" label="Reset token" error={touched ? tokenMessage : undefined}>
        <Input id="token" value={token} onBlur={() => setTouched(true)} onChange={(event) => setToken(event.target.value)} invalid={touched && Boolean(tokenMessage)} />
      </AuthField>
      <AuthField id="password" label="New password" error={touched ? passwordMessage : undefined}>
        <Input id="password" type="password" autoComplete="new-password" value={password} onBlur={() => setTouched(true)} onChange={(event) => setPassword(event.target.value)} invalid={touched && Boolean(passwordMessage)} />
      </AuthField>
      <AuthField id="confirm-password" label="Confirm password" error={touched ? confirmMessage : undefined}>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onBlur={() => setTouched(true)} onChange={(event) => setConfirm(event.target.value)} invalid={touched && Boolean(confirmMessage)} />
      </AuthField>
      {submitError ? <p className="text-label-s text-status-error">{submitError}</p> : null}
      {submitSuccess ? <p className="text-label-s text-status-success">{submitSuccess}</p> : null}
      <Button type="submit" className="w-full" loading={submitting} disabled={!canSubmit}>
        Reset password
      </Button>
      <Link href="/login" className="block text-label-s text-text-secondary hover:text-text-primary">Back to sign in</Link>
    </form>
  );
}

export function VerifyEmailPanel({ email, token }: { email?: string | null; token?: string | null }) {
  const availability = useAuthAvailability();
  const [working, setWorking] = useState(false);
  const [resending, setResending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [resendToken, setResendToken] = useState<string | null>(null);

  async function onVerify() {
    if (!token) {
      setError('Verification token missing. Request a new verification email.');
      return;
    }
    setWorking(true);
    setError(null);
    setSuccess(null);
    try {
      await verifyEmailToken(token);
      setSuccess('Email verified successfully. You can continue to your workspace.');
    } catch (err) {
      setError(errorMessage(err, 'Unable to verify email.'));
    } finally {
      setWorking(false);
    }
  }

  async function onResend() {
    if (!email) {
      setError('Email address is required to resend verification.');
      return;
    }
    setResending(true);
    setError(null);
    setSuccess(null);
    setResendToken(null);
    try {
      const result = await resendVerificationEmail(email);
      setSuccess(result.message);
      setResendToken(result.token ?? null);
    } catch (err) {
      setError(errorMessage(err, 'Unable to resend verification email.'));
    } finally {
      setResending(false);
    }
  }

  return (
    <div className="space-y-4">
      <AuthStatus state={availability} />
      <div className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-4">
        <Mail className="h-5 w-5 text-brand-primary" />
        <h2 className="mt-3 text-title-s text-text-primary">Check your inbox</h2>
        <p className="mt-2 text-body-s text-text-secondary">
          {email ? `Use the verification link sent to ${email}.` : 'Use the verification link from your inbox.'}
        </p>
        {token ? <p className="mt-2 text-label-s text-text-muted">Verification token detected in URL.</p> : null}
      </div>
      {error ? <p className="text-label-s text-status-error">{error}</p> : null}
      {success ? <p className="text-label-s text-status-success">{success}</p> : null}
      {resendToken ? (
        <p className="text-label-s text-text-secondary">
          Dev token generated. Reload with token:{' '}
          <Link href={`/verify-email?email=${encodeURIComponent(email ?? '')}&token=${encodeURIComponent(resendToken)}`} className="text-brand-primary hover:text-brand-primary-hover">
            verify now
          </Link>
        </p>
      ) : null}
      <Button type="button" className="w-full" onClick={() => { void onVerify(); }} loading={working} disabled={!token || availability !== 'available'}>
        Verify email
      </Button>
      <Button type="button" variant="secondary" className="w-full" onClick={() => { void onResend(); }} loading={resending} disabled={!email || availability !== 'available'}>
        Resend verification email
      </Button>
      <Link href="/login" className="block text-label-s text-text-secondary hover:text-text-primary">Back to sign in</Link>
    </div>
  );
}

export function AcceptInviteForm({ workspace, inviter, email }: { workspace?: string | null; inviter?: string | null; email?: string | null }) {
  const availability = useAuthAvailability();
  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()}>
      <AuthStatus state={availability} />
      <div className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-4">
        <UserPlus className="h-5 w-5 text-brand-primary" />
        <h2 className="mt-3 text-title-s text-text-primary">Invitation context</h2>
        <dl className="mt-3 space-y-2 text-body-s text-text-secondary">
          <div className="flex justify-between gap-3"><dt>Workspace</dt><dd className="text-text-primary">{workspace ?? 'Workspace pending'}</dd></div>
          <div className="flex justify-between gap-3"><dt>Invited by</dt><dd className="text-text-primary">{inviter ?? 'Admin'}</dd></div>
          <div className="flex justify-between gap-3"><dt>Email</dt><dd className="text-text-primary">{email ?? 'Invite email'}</dd></div>
        </dl>
      </div>
      <DisabledAction label="Accept invite requires invite endpoint" />
    </form>
  );
}

const stacks = ['Next.js + Node API + PostgreSQL', 'Next.js full-stack + Prisma', 'React + Express + PostgreSQL', 'Custom stack during setup'];

export function WorkspaceSelectionForm() {
  const availability = useAuthAvailability();
  return (
    <div className="space-y-4">
      <AuthStatus state={availability} />
      {['DEVteam Studio', 'Platform Lab'].map((workspace) => (
        <button key={workspace} type="button" disabled className="w-full cursor-not-allowed rounded-[var(--radius-panel)] border border-border bg-surface-base p-4 text-left opacity-70">
          <span className="text-label-m text-text-primary">{workspace}</span>
          <span className="mt-1 block text-body-s text-text-secondary">Workspace access requires authenticated session state.</span>
        </button>
      ))}
      <Link href="/workspaces/new" className="block text-label-s text-brand-primary hover:text-brand-primary-hover">Create a new workspace</Link>
    </div>
  );
}

export function CreateWorkspaceForm() {
  const availability = useAuthAvailability();
  const [name, setName] = useState('');
  const error = name.trim().length < 3 ? 'Use at least 3 characters.' : undefined;
  const canSubmit = false;
  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="workspace-name" label="Workspace name" error={name ? error : undefined}>
        <Input id="workspace-name" value={name} onChange={(event) => setName(event.target.value)} invalid={name.length > 0 && Boolean(error)} />
      </AuthField>
      <AuthField id="workspace-purpose" label="Primary production focus">
        <Select id="workspace-purpose" defaultValue="">
          <option value="" disabled>Select focus</option>
          <option>SaaS platforms</option>
          <option>Internal tools</option>
          <option>Marketplaces</option>
          <option>Dashboards</option>
        </Select>
      </AuthField>
      {canSubmit ? <Button type="submit" className="w-full">Create workspace</Button> : <DisabledAction label="Create workspace requires workspace endpoint" />}
    </form>
  );
}

export function OnboardingWelcome() {
  const concepts = [
    ['What DEVteam builds', 'Full-stack application foundations: UI, backend services, database structure, and project source.'],
    ['What you own', 'Generated source code and the export path into your own repository.'],
    ['Preview', 'A running view of generated output used to inspect application behavior before export.'],
    ['Verification', 'Checks and diagnostics that explain build health, runtime state, and readiness.'],
    ['Export', 'The handoff from DEVteam into your codebase and delivery process.'],
    ['Agents and pipeline', 'Specialized stages define, build, review, validate, and prepare output at a high level.'],
  ];
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        {concepts.map(([title, description]) => (
          <div key={title} className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-4">
            <CheckCircle2 className="h-4 w-4 text-status-success" />
            <h2 className="mt-3 text-label-m text-text-primary">{title}</h2>
            <p className="mt-1 text-body-s text-text-secondary">{description}</p>
          </div>
        ))}
      </div>
      <Link href="/onboarding/first-project" className="inline-flex h-11 w-full items-center justify-center rounded-[var(--radius-control)] border border-brand-primary bg-brand-primary px-4 text-label-m text-brand-primary-contrast shadow-hairline hover:bg-brand-primary-hover">
        Continue to first project setup
      </Link>
    </div>
  );
}

export function FirstProjectSetupForm() {
  const availability = useAuthAvailability();
  const [brief, setBrief] = useState('');
  const briefError = brief.trim().length > 0 && brief.trim().length < 24 ? 'Describe the application in at least 24 characters.' : undefined;
  const selectedStackSummary = useMemo(() => stacks[0], []);
  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="project-brief" label="Application brief" hint="Example: A booking system with customer accounts, admin scheduling, payments, and PostgreSQL.">
        <Textarea id="project-brief" rows={5} value={brief} onChange={(event) => setBrief(event.target.value)} invalid={Boolean(briefError)} />
      </AuthField>
      {briefError ? <p className="text-label-s text-status-error">{briefError}</p> : null}
      <AuthField id="stack" label="Preferred stack" hint={`Recommended: ${selectedStackSummary}`}>
        <Select id="stack" defaultValue={stacks[0]}>
          {stacks.map((stack) => <option key={stack}>{stack}</option>)}
        </Select>
      </AuthField>
      <AuthField id="verification-level" label="Verification focus">
        <Select id="verification-level" defaultValue="runtime">
          <option value="runtime">Runtime preview and health checks</option>
          <option value="contract">API and data contract checks</option>
          <option value="accessibility">Accessibility and UI review</option>
        </Select>
      </AuthField>
      <DisabledAction label="Create first project requires workspace endpoint" />
      <p className="text-label-s text-text-muted">Project creation after onboarding requires authenticated workspace state.</p>
    </form>
  );
}

