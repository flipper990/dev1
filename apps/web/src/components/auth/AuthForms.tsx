'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, KeyRound, Mail, UserPlus } from 'lucide-react';
import { Button, Input, Select, Textarea } from '../../../components/ui';
import { AuthField, AuthStatus, DisabledAction } from './AuthShell';

type Availability = 'checking' | 'unavailable';

function useAuthAvailability() {
  const [state, setState] = useState<Availability>('checking');
  useEffect(() => {
    const id = window.setTimeout(() => setState('unavailable'), 500);
    return () => window.clearTimeout(id);
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
  return undefined;
}

export function LoginForm() {
  const availability = useAuthAvailability();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const errors = { email: emailError(email), password: passwordError(password) };
  const canSubmit = false;

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="email" label="Work email" error={touched ? errors.email : undefined}>
        <Input id="email" type="email" autoComplete="email" value={email} onBlur={() => setTouched(true)} onChange={(event) => setEmail(event.target.value)} invalid={touched && Boolean(errors.email)} />
      </AuthField>
      <AuthField id="password" label="Password" error={touched ? errors.password : undefined}>
        <Input id="password" type="password" autoComplete="current-password" value={password} onBlur={() => setTouched(true)} onChange={(event) => setPassword(event.target.value)} invalid={touched && Boolean(errors.password)} />
      </AuthField>
      {canSubmit ? <Button type="submit" className="w-full">Sign in</Button> : <DisabledAction label="Sign in requires auth endpoint" />}
      <button
        type="button"
        disabled
        title="SSO requires an identity-provider backend contract"
        className="inline-flex h-11 w-full cursor-not-allowed items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border bg-surface-raised px-4 text-label-m text-text-muted"
      >
        <KeyRound className="h-4 w-4" /> SSO coming soon
      </button>
      <div className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-3 text-body-s text-text-secondary">
        <p>Available now: product overview, workflow docs, and workspace preview pages.</p>
        <div className="mt-2 flex flex-wrap gap-3 text-label-s">
          <Link href="/waitlist" className="text-brand-primary hover:text-brand-primary-hover">Join early access</Link>
          <Link href="/docs" className="text-brand-primary hover:text-brand-primary-hover">Open docs</Link>
        </div>
      </div>
      <div className="flex flex-wrap justify-between gap-3 text-label-s text-text-secondary">
        <Link href="/forgot-password" className="hover:text-text-primary">Forgot password?</Link>
        <Link href="/signup" className="hover:text-text-primary">Create account</Link>
      </div>
    </form>
  );
}

export function SignupForm() {
  const availability = useAuthAvailability();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [touched, setTouched] = useState(false);
  const errors = {
    name: name.trim() ? undefined : 'Name is required.',
    email: emailError(email),
    password: passwordError(password),
  };
  const canSubmit = false;

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="name" label="Full name" error={touched ? errors.name : undefined}>
        <Input id="name" autoComplete="name" value={name} onBlur={() => setTouched(true)} onChange={(event) => setName(event.target.value)} invalid={touched && Boolean(errors.name)} />
      </AuthField>
      <AuthField id="email" label="Work email" error={touched ? errors.email : undefined}>
        <Input id="email" type="email" autoComplete="email" value={email} onBlur={() => setTouched(true)} onChange={(event) => setEmail(event.target.value)} invalid={touched && Boolean(errors.email)} />
      </AuthField>
      <AuthField id="password" label="Password" hint="Use at least 10 characters." error={touched ? errors.password : undefined}>
        <Input id="password" type="password" autoComplete="new-password" value={password} onBlur={() => setTouched(true)} onChange={(event) => setPassword(event.target.value)} invalid={touched && Boolean(errors.password)} />
      </AuthField>
      {canSubmit ? <Button type="submit" className="w-full">Create account</Button> : <DisabledAction label="Create account requires auth endpoint" />}
      <div className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-3 text-body-s text-text-secondary">
        <p>Account creation is planned, but no signup, email verification, or session endpoint is connected yet.</p>
        <div className="mt-2 flex flex-wrap gap-3 text-label-s">
          <Link href="/waitlist" className="text-brand-primary hover:text-brand-primary-hover">Join early access</Link>
          <Link href="/docs" className="text-brand-primary hover:text-brand-primary-hover">Open docs</Link>
        </div>
      </div>
      <p className="text-label-s text-text-secondary">Already have an account? <Link href="/login" className="text-brand-primary hover:text-brand-primary-hover">Sign in</Link></p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const availability = useAuthAvailability();
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const error = emailError(email);
  const canSubmit = false;

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="email" label="Account email" error={touched ? error : undefined}>
        <Input id="email" type="email" autoComplete="email" value={email} onBlur={() => setTouched(true)} onChange={(event) => setEmail(event.target.value)} invalid={touched && Boolean(error)} />
      </AuthField>
      {canSubmit ? <Button type="submit" className="w-full">Send reset link</Button> : <DisabledAction label="Reset link requires email endpoint" />}
      <Link href="/login" className="block text-label-s text-text-secondary hover:text-text-primary">Return to sign in</Link>
    </form>
  );
}

export function ResetPasswordForm() {
  const availability = useAuthAvailability();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [touched, setTouched] = useState(false);
  const passwordMessage = passwordError(password);
  const confirmMessage = confirm && confirm !== password ? 'Passwords must match.' : !confirm ? 'Confirm your password.' : undefined;
  const canSubmit = false;

  return (
    <form className="space-y-4" onSubmit={(event) => event.preventDefault()} noValidate>
      <AuthStatus state={availability} />
      <AuthField id="password" label="New password" error={touched ? passwordMessage : undefined}>
        <Input id="password" type="password" autoComplete="new-password" value={password} onBlur={() => setTouched(true)} onChange={(event) => setPassword(event.target.value)} invalid={touched && Boolean(passwordMessage)} />
      </AuthField>
      <AuthField id="confirm-password" label="Confirm password" error={touched ? confirmMessage : undefined}>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onBlur={() => setTouched(true)} onChange={(event) => setConfirm(event.target.value)} invalid={touched && Boolean(confirmMessage)} />
      </AuthField>
      {canSubmit ? <Button type="submit" className="w-full">Reset password</Button> : <DisabledAction label="Reset password requires auth endpoint" />}
    </form>
  );
}

export function VerifyEmailPanel({ email }: { email?: string | null }) {
  const availability = useAuthAvailability();
  return (
    <div className="space-y-4">
      <AuthStatus state={availability} />
      <div className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-4">
        <Mail className="h-5 w-5 text-brand-primary" />
        <h2 className="mt-3 text-title-s text-text-primary">Check your inbox</h2>
        <p className="mt-2 text-body-s text-text-secondary">
          {email ? `A verification link would be sent to ${email}.` : 'A verification link would be sent to the account email.'} Email verification requires backend email/auth contracts.
        </p>
      </div>
      <DisabledAction label="Resend verification requires email endpoint" />
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
      {canSubmit ? <Button type="submit" className="w-full">Create workspace</Button> : <DisabledAction label="Create workspace requires auth endpoint" />}
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
