import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Factory, ShieldCheck } from 'lucide-react';
import { cn } from '../../../lib/cn';

export const marketingNav = [
  { label: 'Product', href: '/product' },
  { label: 'How it works', href: '/how-it-works' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Enterprise', href: '/enterprise' },
  { label: 'Security', href: '/security' },
];

interface MarketingShellProps {
  children: ReactNode;
}

export function MarketingShell({ children }: MarketingShellProps) {
  return (
    <div className="min-h-screen overflow-x-hidden bg-surface-canvas text-text-primary">
      <MarketingHeader />
      <main>{children}</main>
      <MarketingFooter />
    </div>
  );
}

export function MarketingHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-surface-raised/95 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-[1180px] items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex min-w-0 items-center gap-3 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]">
          <span className="inline-grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border bg-brand-primary-subtle text-brand-primary shadow-hairline">
            <Factory className="h-4 w-4" aria-hidden="true" />
          </span>
          <span className="text-label-m font-semibold text-text-primary">DEVteam</span>
        </Link>

        <nav aria-label="Marketing" className="hidden items-center gap-1 md:flex">
          {marketingNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="rounded-[var(--radius-control)] px-3 py-2 text-label-s text-text-secondary transition-colors duration-120 ease-ledger hover:bg-surface-tint hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex shrink-0 items-center gap-2">
          <Link
            href="/waitlist"
            className="hidden rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 py-2 text-label-s text-text-primary shadow-hairline transition-colors hover:bg-surface-tint sm:inline-flex"
          >
            Early access
          </Link>
          <Link
            href="/request-demo"
            className="inline-flex items-center gap-2 rounded-[var(--radius-control)] border border-brand-primary bg-brand-primary px-3 py-2 text-label-s text-brand-primary-contrast shadow-hairline transition-colors hover:bg-brand-primary-hover"
          >
            Request demo
            <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border bg-surface-raised">
      <div className="mx-auto grid w-full max-w-[1180px] gap-8 px-4 py-10 sm:px-6 md:grid-cols-[1.2fr_2fr] lg:px-8">
        <div>
          <div className="flex items-center gap-3">
            <span className="inline-grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border bg-brand-primary-subtle text-brand-primary">
              <Factory className="h-4 w-4" aria-hidden="true" />
            </span>
            <span className="text-label-m font-semibold">DEVteam</span>
          </div>
          <p className="mt-3 max-w-[36ch] text-body-s text-text-secondary">
            AI software production studio for generating full-stack applications your team owns.
          </p>
        </div>
        <div className="grid gap-6 sm:grid-cols-3">
          <FooterGroup title="Product" links={[['Product', '/product'], ['How it works', '/how-it-works'], ['Pricing', '/pricing']]} />
          <FooterGroup title="Company" links={[['Enterprise', '/enterprise'], ['Security / Trust', '/security'], ['Request demo', '/request-demo']]} />
          <FooterGroup title="Access" links={[['Early access', '/waitlist'], ['App workspace', '/overview'], ['Builder', '/workspace']]} />
        </div>
      </div>
    </footer>
  );
}

function FooterGroup({ title, links }: { title: string; links: Array<[string, string]> }) {
  return (
    <div>
      <h3 className="text-label-s uppercase tracking-[0.12em] text-text-muted">{title}</h3>
      <ul className="mt-3 space-y-2">
        {links.map(([label, href]) => (
          <li key={href}>
            <Link href={href} className="text-body-s text-text-secondary hover:text-text-primary">
              {label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function MarketingSection({
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('mx-auto w-full max-w-[1180px] px-4 py-16 sm:px-6 lg:px-8', className)}>
      <div className="max-w-[760px]">
        {eyebrow ? <p className="text-label-s uppercase tracking-[0.16em] text-brand-secondary">{eyebrow}</p> : null}
        <h2 className="mt-3 text-display-m text-text-primary">{title}</h2>
        {description ? <p className="mt-4 text-body-l text-text-secondary">{description}</p> : null}
      </div>
      {children ? <div className="mt-8">{children}</div> : null}
    </section>
  );
}

export function CTAButton({ href, children, variant = 'primary' }: { href: string; children: ReactNode; variant?: 'primary' | 'secondary' }) {
  return (
    <Link
      href={href}
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border px-4 text-label-m shadow-hairline transition-colors duration-120 ease-ledger focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        variant === 'primary'
          ? 'border-brand-primary bg-brand-primary text-brand-primary-contrast hover:bg-brand-primary-hover'
          : 'border-border bg-surface-raised text-text-primary hover:bg-surface-tint',
      )}
    >
      {children}
      <ArrowRight className="h-4 w-4" aria-hidden="true" />
    </Link>
  );
}

export function ProofVisual() {
  const rows = [
    ['Frontend', 'Next.js interface generated with typed routes'],
    ['Backend', 'API services, auth-ready contracts, job orchestration'],
    ['Database', 'Schema, seed data, migrations, persistence layer'],
    ['Preview', 'Runtime validation and diagnostics before export'],
  ];

  return (
    <div className="relative rounded-[var(--radius-modal)] border border-border bg-surface-raised p-3 shadow-lg">
      <div
        className="absolute inset-0 rounded-[var(--radius-modal)] opacity-40"
        style={{
          backgroundImage:
            'linear-gradient(var(--color-border-muted) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-muted) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
        }}
        aria-hidden="true"
      />
      <div className="relative overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface-base">
        <div className="flex items-center justify-between border-b border-border-muted px-4 py-3">
          <div>
            <p className="text-label-m text-text-primary">Production package</p>
            <p className="text-label-s text-text-muted">Full-stack application output</p>
          </div>
          <span className="rounded-[var(--radius-control)] border border-status-success bg-status-success-subtle px-2 py-1 text-label-s text-status-success">
            Validated
          </span>
        </div>
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          {rows.map(([label, value]) => (
            <div key={label} className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-4 shadow-hairline">
              <p className="text-label-s uppercase tracking-[0.12em] text-text-muted">{label}</p>
              <p className="mt-2 text-body-s text-text-primary">{value}</p>
            </div>
          ))}
        </div>
        <div className="border-t border-border-muted bg-surface-tint px-4 py-3 font-mono text-mono-s text-text-secondary">
          export devteam-source --target own-repo --include database api ui
        </div>
      </div>
    </div>
  );
}

export function FeatureCard({ title, description, icon }: { title: string; description: string; icon?: ReactNode }) {
  return (
    <div className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-5 shadow-card">
      <div className="mb-4 inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-brand-primary-subtle text-brand-primary">
        {icon ?? <CheckCircle2 className="h-5 w-5" aria-hidden="true" />}
      </div>
      <h3 className="text-title-s text-text-primary">{title}</h3>
      <p className="mt-2 text-body-s text-text-secondary">{description}</p>
    </div>
  );
}

export function TrustStrip() {
  return (
    <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-5 shadow-card">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="flex items-start gap-3">
          <span className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-status-info-subtle text-status-info">
            <ShieldCheck className="h-5 w-5" aria-hidden="true" />
          </span>
          <div>
            <h3 className="text-title-s text-text-primary">Built for teams that need control</h3>
            <p className="mt-1 text-body-s text-text-secondary">Exportable source, stack choice, diagnostics, and reviewable runtime evidence.</p>
          </div>
        </div>
        <CTAButton href="/enterprise" variant="secondary">Enterprise trust</CTAButton>
      </div>
    </div>
  );
}
