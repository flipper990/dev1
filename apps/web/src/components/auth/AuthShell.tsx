import Link from 'next/link';
import { cloneElement, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Factory, ShieldCheck } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { SystemBanner } from '../feedback';

interface AuthShellProps {
  eyebrow?: string;
  title: string;
  subtitle: string;
  children: ReactNode;
  asideTitle?: string;
  asideItems?: string[];
  footer?: ReactNode;
}

const defaultAsideItems = [
  'DEVteam generates frontend, backend, and database foundations.',
  'Your team owns the generated source code and export path.',
  'Preview and verification explain runtime readiness before handoff.',
];

export function AuthShell({
  eyebrow = 'Secure access',
  title,
  subtitle,
  children,
  asideTitle = 'Software production, not a prompt sandbox.',
  asideItems = defaultAsideItems,
  footer,
}: AuthShellProps) {
  return (
    <main className="min-h-screen overflow-x-hidden bg-surface-canvas text-text-primary">
      <div className="mx-auto grid min-h-screen w-full max-w-[1180px] px-4 py-6 sm:px-6 lg:grid-cols-[0.88fr_1.12fr] lg:px-8">
        <section className="hidden min-h-[calc(100vh-3rem)] flex-col justify-between rounded-[var(--radius-modal)] border border-border bg-surface-raised p-8 shadow-card lg:flex">
          <div>
            <Link href="/" className="inline-flex items-center gap-3 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]">
              <span className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-brand-primary-subtle text-brand-primary shadow-hairline">
                <Factory className="h-5 w-5" aria-hidden="true" />
              </span>
              <span className="text-label-m font-semibold">DEVteam</span>
            </Link>

            <div className="mt-16 max-w-[420px]">
              <p className="text-label-s uppercase tracking-[0.16em] text-brand-secondary">{eyebrow}</p>
              <h1 className="mt-4 text-display-m text-text-primary">{asideTitle}</h1>
              <ul className="mt-6 space-y-4">
                {asideItems.map((item) => (
                  <li key={item} className="flex gap-3 text-body-s text-text-secondary">
                    <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-4">
            <p className="text-label-s uppercase tracking-[0.14em] text-text-muted">Auth availability</p>
            <p className="mt-2 text-body-s text-text-secondary">
              Authentication uses secure cookies, refresh sessions, and backend guards for protected workspace routes.
            </p>
          </div>
        </section>

        <section className="flex min-h-[calc(100vh-3rem)] items-center justify-center py-8 lg:py-0">
          <div className="w-full max-w-[520px]">
            <div className="mb-8 flex items-center justify-between gap-4 lg:hidden">
              <Link href="/" className="inline-flex items-center gap-3">
                <span className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-brand-primary-subtle text-brand-primary">
                  <Factory className="h-5 w-5" aria-hidden="true" />
                </span>
                <span className="text-label-m font-semibold">DEVteam</span>
              </Link>
            </div>

            <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-5 shadow-lg sm:p-7">
              <div>
                <p className="text-label-s uppercase tracking-[0.16em] text-brand-secondary">{eyebrow}</p>
                <h1 className="mt-3 text-title-l text-text-primary">{title}</h1>
                <p className="mt-2 text-body-s text-text-secondary">{subtitle}</p>
              </div>
              <div className="mt-6">{children}</div>
            </div>
            {footer ? <div className="mt-5 text-center text-body-s text-text-secondary">{footer}</div> : null}
          </div>
        </section>
      </div>
    </main>
  );
}

export function AuthField({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}) {
  const descriptionId = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const field = isValidElement(children)
    ? cloneElement(children as ReactElement<{ 'aria-describedby'?: string }>, {
        'aria-describedby': descriptionId,
      })
    : children;

  return (
    <div>
      <label htmlFor={id} className="text-label-m text-text-primary">
        {label}
      </label>
      <div className="mt-1.5">{field}</div>
      {error ? (
        <p id={`${id}-error`} className="mt-1.5 text-label-s text-status-error">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="mt-1.5 text-label-s text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function AuthStatus({ state = 'checking' }: { state?: 'checking' | 'available' | 'unavailable' | 'error' }) {
  if (state === 'checking') {
    return (
      <SystemBanner
        tone="info"
        title="Checking auth availability"
        description="Checking session services and authentication routes."
      />
    );
  }
  if (state === 'available') {
    return (
      <SystemBanner
        tone="success"
        title="Authentication service available"
        description="This form is connected to live backend auth endpoints."
      />
    );
  }

  return (
    <SystemBanner
      tone={state === 'error' ? 'error' : 'warning'}
      title="Authentication temporarily unavailable"
      description="Authentication service is unavailable right now. Try again shortly."
    />
  );
}

export function DisabledAction({ label }: { label: string }) {
  return (
    <button
      type="button"
      disabled
      className="inline-flex h-11 w-full cursor-not-allowed items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-tint px-4 text-label-m text-text-muted"
      aria-disabled="true"
    >
      {label}
    </button>
  );
}
