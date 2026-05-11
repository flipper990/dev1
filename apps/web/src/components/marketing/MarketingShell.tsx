import Link from 'next/link';
import type { ReactNode } from 'react';
import { ArrowRight, CheckCircle2, Factory, ShieldCheck } from 'lucide-react';
import { cn } from '../../../lib/cn';

export const marketingNav = [
  { label: 'Product', href: '/product' },
  { label: 'Docs', href: '/docs' },
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
      <nav aria-label="Marketing sections" className="border-t border-border-muted px-4 py-2 md:hidden">
        <div className="mx-auto flex w-full max-w-[1180px] gap-1 overflow-x-auto [scrollbar-width:thin]">
          {marketingNav.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-[var(--radius-control)] px-3 py-2 text-label-s text-text-secondary hover:bg-surface-tint hover:text-text-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              {item.label}
            </Link>
          ))}
        </div>
      </nav>
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
          <FooterGroup title="Product" links={[['Product', '/product'], ['Docs', '/docs'], ['Pricing', '/pricing']]} />
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
        <div className="overflow-x-auto border-t border-border-muted bg-surface-tint px-4 py-3 font-mono text-mono-s text-text-secondary [scrollbar-width:thin]">
          export devteam-source --target own-repo --include database api ui
        </div>
      </div>
    </div>
  );
}

export function ProofStrip({
  items,
}: {
  items: Array<{ value: string; label: string; detail: string }>;
}) {
  return (
    <div className="grid overflow-hidden rounded-[var(--radius-modal)] border border-border bg-surface-raised shadow-card md:grid-cols-3">
      {items.map((item, index) => (
        <div
          key={item.label}
          className={cn(
            'p-5 md:p-6',
            index > 0 && 'border-t border-border-muted md:border-l md:border-t-0',
          )}
        >
          <p className="text-display-s text-text-primary">{item.value}</p>
          <h3 className="mt-2 text-label-m text-text-primary">{item.label}</h3>
          <p className="mt-1 text-body-s text-text-secondary">{item.detail}</p>
        </div>
      ))}
    </div>
  );
}

export function LifecycleDiagram({ steps }: { steps: Array<{ label: string; detail: string }> }) {
  return (
    <ol className="relative grid gap-4 lg:grid-cols-6">
      {steps.map((step, index) => (
        <li key={step.label} className="relative">
          {index < steps.length - 1 ? (
            <span className="absolute left-5 top-5 hidden h-px w-[calc(100%+1rem)] bg-border-strong lg:block" aria-hidden="true" />
          ) : null}
          <div className="relative flex h-full gap-4 rounded-[var(--radius-panel)] border border-border bg-surface-raised p-4 shadow-hairline lg:block">
            <span className="inline-grid h-10 w-10 shrink-0 place-items-center rounded-full border border-border bg-surface-base font-mono text-mono-s text-text-primary shadow-hairline">
              {String(index + 1).padStart(2, '0')}
            </span>
            <div className="lg:mt-4">
              <h3 className="text-label-m text-text-primary">{step.label}</h3>
              <p className="mt-1 text-body-s text-text-secondary">{step.detail}</p>
            </div>
          </div>
        </li>
      ))}
    </ol>
  );
}

export function ComparisonTable({
  rows,
}: {
  rows: Array<{ capability: string; devteam: string; typical: string }>;
}) {
  return (
    <div className="overflow-hidden rounded-[var(--radius-modal)] border border-border bg-surface-raised shadow-card">
      <div className="hidden grid-cols-[1.1fr_1fr_1fr] border-b border-border-muted bg-surface-base px-4 py-3 text-label-s text-text-secondary sm:grid sm:px-5">
        <span>Capability</span>
        <span>DEVteam</span>
        <span>Typical AI builder</span>
      </div>
      <div className="divide-y divide-border-muted">
        {rows.map((row) => (
          <div key={row.capability} className="grid grid-cols-1 gap-3 px-4 py-4 text-body-s sm:grid-cols-[1.1fr_1fr_1fr] sm:px-5">
            <p className="text-label-m text-text-primary">{row.capability}</p>
            <p className="text-text-primary">{row.devteam}</p>
            <p className="text-text-secondary">{row.typical}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function OwnershipCallout({
  title,
  description,
  points,
  action,
}: {
  title: string;
  description: string;
  points: string[];
  action?: ReactNode;
}) {
  return (
    <div className="grid gap-6 rounded-[var(--radius-modal)] border border-border bg-brand-primary-subtle p-6 shadow-card md:grid-cols-[1fr_0.85fr] md:p-8">
      <div>
        <p className="text-label-s uppercase tracking-[0.16em] text-brand-secondary">Ownership and export</p>
        <h3 className="mt-3 text-display-s text-text-primary">{title}</h3>
        <p className="mt-3 text-body-l text-text-secondary">{description}</p>
        {action ? <div className="mt-5">{action}</div> : null}
      </div>
      <ul className="grid content-center gap-3">
        {points.map((point) => (
          <li key={point} className="flex items-start gap-3 rounded-[var(--radius-panel)] border border-border bg-surface-raised p-3 text-body-s text-text-primary shadow-hairline">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function StackedProductScreenshots() {
  const rows = [
    ['Preview ready', 'Runtime responding'],
    ['Diagnostics clear', '0 blocking errors'],
    ['Export package', 'Source prepared'],
  ];

  return (
    <div className="relative min-h-[420px]">
      <div className="absolute left-0 top-8 w-[88%] rounded-[var(--radius-modal)] border border-border bg-surface-raised p-3 shadow-lg">
        <div className="flex items-center justify-between border-b border-border-muted px-3 py-2">
          <div>
            <p className="text-label-m text-text-primary">Workspace preview</p>
            <p className="text-label-s text-text-muted">Generated application output</p>
          </div>
          <span className="rounded-[var(--radius-control)] border border-status-success bg-status-success-subtle px-2 py-1 text-label-s text-status-success">
            Live
          </span>
        </div>
        <div className="grid gap-3 p-3 md:grid-cols-[1fr_0.8fr]">
          <div className="min-h-[210px] rounded-[var(--radius-panel)] border border-border bg-surface-base p-4">
            <div className="h-7 w-40 rounded-[var(--radius-control)] bg-brand-primary-subtle" />
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="h-24 rounded-[var(--radius-panel)] border border-border-muted bg-surface-raised" />
              <div className="h-24 rounded-[var(--radius-panel)] border border-border-muted bg-surface-raised" />
            </div>
            <div className="mt-3 h-20 rounded-[var(--radius-panel)] border border-border-muted bg-surface-tint" />
          </div>
          <div className="space-y-3">
            {rows.map(([label, value]) => (
              <div key={label} className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-3">
                <p className="text-label-s text-text-muted">{label}</p>
                <p className="mt-1 text-label-m text-text-primary">{value}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="absolute bottom-8 right-0 w-[72%] rounded-[var(--radius-modal)] border border-border bg-surface-base p-4 shadow-overlay">
        <p className="text-label-m text-text-primary">Project artifacts</p>
        <div className="mt-4 space-y-2 font-mono text-mono-s text-text-secondary">
          <p className="rounded-[var(--radius-control)] bg-surface-raised px-3 py-2">app/dashboard/page.tsx</p>
          <p className="rounded-[var(--radius-control)] bg-surface-raised px-3 py-2">api/projects/route.ts</p>
          <p className="rounded-[var(--radius-control)] bg-surface-raised px-3 py-2">db/schema.prisma</p>
        </div>
      </div>
    </div>
  );
}

export function TrustSecurityBand({
  items,
}: {
  items: Array<{ label: string; detail: string }>;
}) {
  return (
    <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-5 shadow-card">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="max-w-[420px]">
          <p className="text-label-s uppercase tracking-[0.16em] text-brand-secondary">Trust posture</p>
          <h3 className="mt-2 text-title-l text-text-primary">Control stays with your team.</h3>
          <p className="mt-2 text-body-s text-text-secondary">
            DEVteam emphasizes inspectable output, source ownership, and reviewable runtime evidence before handoff.
          </p>
        </div>
        <div className="grid flex-1 gap-3 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.label} className="border-l border-border-strong pl-4">
              <p className="text-label-m text-text-primary">{item.label}</p>
              <p className="mt-1 text-body-s text-text-secondary">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export function UseCaseGrid({
  items,
}: {
  items: Array<{ title: string; description: string; icon: ReactNode }>;
}) {
  return (
    <div className="grid gap-px overflow-hidden rounded-[var(--radius-modal)] border border-border bg-border shadow-card sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <div key={item.title} className="bg-surface-raised p-5">
          <div className="mb-4 inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-base text-brand-primary">
            {item.icon}
          </div>
          <h3 className="text-title-s text-text-primary">{item.title}</h3>
          <p className="mt-2 text-body-s text-text-secondary">{item.description}</p>
        </div>
      ))}
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
