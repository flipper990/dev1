import { BriefcaseBusiness, CalendarDays, CheckCircle2, Layers3, LayoutDashboard, ShoppingCart, Users } from 'lucide-react';
import {
  ComparisonTable,
  CTAButton,
  LifecycleDiagram,
  MarketingSection,
  MarketingShell,
  OwnershipCallout,
  ProofStrip,
  ProofVisual,
  TrustSecurityBand,
  UseCaseGrid,
} from '../src/components/marketing';

const proofItems = [
  { value: '3 layers', label: 'Frontend, backend, database', detail: 'Application UI, service contracts, schema, and persistence are generated as one package.' },
  { value: '1 preview', label: 'Runtime validation surface', detail: 'Generated output is inspected through preview health, logs, and diagnostics.' },
  { value: '100%', label: 'Source ownership posture', detail: 'The product direction prioritizes exportable code over proprietary runtime lock-in.' },
];

const workflow = [
  { label: 'Define', detail: 'Capture the product brief and delivery assumptions.' },
  { label: 'Select', detail: 'Choose the stack before generation starts.' },
  { label: 'Build', detail: 'Produce UI, API, data, and project structure.' },
  { label: 'Verify', detail: 'Inspect build health, diagnostics, and runtime evidence.' },
  { label: 'Preview', detail: 'Review the generated application as the main artifact.' },
  { label: 'Export', detail: 'Move source into your own engineering process.' },
];

const comparisonRows = [
  { capability: 'Application scope', devteam: 'Full-stack application foundations', typical: 'Mostly screens or prompt-generated page flows' },
  { capability: 'Engineering handoff', devteam: 'Exportable source and project artifacts', typical: 'Hosted output or opaque generation state' },
  { capability: 'Runtime confidence', devteam: 'Preview, logs, diagnostics, and health state', typical: 'Visual preview without production evidence' },
  { capability: 'Stack control', devteam: 'Stack selected before generation', typical: 'Preset stack or limited implementation control' },
];

const useCases = [
  { title: 'SaaS platforms', description: 'Generate product surfaces, account flows, dashboards, and service foundations.', icon: <Layers3 className="h-5 w-5" /> },
  { title: 'Marketplaces', description: 'Start from structured buyer, seller, listing, and transaction workflows.', icon: <ShoppingCart className="h-5 w-5" /> },
  { title: 'Internal tools', description: 'Produce admin workflows with data models, actions, and operational views.', icon: <BriefcaseBusiness className="h-5 w-5" /> },
  { title: 'Dashboards', description: 'Build validated reporting surfaces connected to application data concepts.', icon: <LayoutDashboard className="h-5 w-5" /> },
  { title: 'Booking systems', description: 'Model scheduling, availability, customer flows, and management screens.', icon: <CalendarDays className="h-5 w-5" /> },
  { title: 'Communities', description: 'Create foundations for profiles, feeds, moderation, and member workflows.', icon: <Users className="h-5 w-5" /> },
];

const trustItems = [
  { label: 'Reviewable artifacts', detail: 'Generated source, preview state, diagnostics, and export package are visible before handoff.' },
  { label: 'Repository portability', detail: 'Projects are intended to continue in your own repository and delivery system.' },
  { label: 'Security conversations', detail: 'Enterprise review can cover controls, roadmap, and deployment assumptions.' },
  { label: 'Operational evidence', detail: 'Runtime preview and logs help teams evaluate generated output.' },
];

const faq = [
  ['Is DEVteam an AI website builder?', 'No. DEVteam is focused on full-stack software production: application UI, backend services, database structure, preview validation, and exportable source code.'],
  ['Who owns the generated application?', 'You do. The goal is source code ownership, repository portability, and no dependency on a proprietary runtime to keep operating.'],
  ['Can teams choose their stack?', 'Yes. Stack choice is part of the production workflow so teams can align output with their engineering standards.'],
  ['What makes it suitable for serious software work?', 'DEVteam emphasizes lifecycle stages, diagnostics, preview validation, code export, and reviewable evidence instead of prompt-only generation.'],
];

export default function LandingPage() {
  return (
    <MarketingShell>
      <section className="relative border-b border-border bg-surface-canvas">
        <div
          className="absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              'linear-gradient(var(--color-border-muted) 1px, transparent 1px), linear-gradient(90deg, var(--color-border-muted) 1px, transparent 1px)',
            backgroundSize: '32px 32px',
          }}
          aria-hidden="true"
        />
        <div className="relative mx-auto grid w-full max-w-[1180px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_0.9fr] lg:px-8 lg:py-24">
          <div className="flex flex-col justify-center">
            <p className="text-label-s uppercase tracking-[0.16em] text-brand-secondary">AI software production studio</p>
            <h1 className="mt-4 max-w-[820px] text-display-l text-text-primary">
              Generate full-stack applications your team owns.
            </h1>
            <p className="mt-6 max-w-[680px] text-body-l text-text-secondary">
              DEVteam turns product requirements into application code, backend services, database structure, preview evidence, and exportable source. It is built for software delivery, not disposable website mockups.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <CTAButton href="/request-demo">Request demo</CTAButton>
              <CTAButton href="/product" variant="secondary">Explore product</CTAButton>
            </div>
            <div className="mt-8 grid gap-3 text-body-s text-text-secondary sm:grid-cols-3">
              <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-status-success" /> Source export</span>
              <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-status-success" /> Runtime preview</span>
              <span className="inline-flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-status-success" /> Stack choice</span>
            </div>
          </div>
          <ProofVisual />
        </div>
      </section>

      <MarketingSection
        eyebrow="Product proof"
        title="A production package, not a landing page mockup."
        description="DEVteam is designed around the artifacts engineering teams expect to review, run, and own."
      >
        <ProofStrip items={proofItems} />
      </MarketingSection>

      <MarketingSection
        eyebrow="Workflow"
        title="A clear path from requirement to launch-ready code."
        description="The workflow keeps generation grounded in software production stages rather than an open-ended prompt loop."
        className="border-y border-border bg-surface-base"
      >
        <LifecycleDiagram steps={workflow} />
      </MarketingSection>

      <MarketingSection eyebrow="Differentiators" title="Built for ownership, validation, and engineering control.">
        <ComparisonTable rows={comparisonRows} />
      </MarketingSection>

      <MarketingSection
        eyebrow="Use cases"
        title="Production starting points for real application categories."
        description="Use DEVteam when the output needs application logic, data models, operational visibility, and source ownership."
        className="border-y border-border bg-surface-base"
      >
        <UseCaseGrid items={useCases} />
      </MarketingSection>

      <MarketingSection eyebrow="Pricing preview" title="Start with early access. Scale with production needs.">
        <div className="overflow-hidden rounded-[var(--radius-modal)] border border-border bg-surface-raised shadow-card">
          {[
            ['Early access', 'For builders validating the workflow.', 'Join waitlist'],
            ['Studio', 'For teams producing full-stack applications regularly.', 'Request pricing'],
            ['Enterprise', 'For governance, security, and deployment controls.', 'Talk to sales'],
          ].map(([name, description, cta], index) => (
            <div key={name} className={index > 0 ? 'border-t border-border-muted p-5 md:grid md:grid-cols-[0.7fr_1fr_0.7fr] md:items-center md:gap-6' : 'p-5 md:grid md:grid-cols-[0.7fr_1fr_0.7fr] md:items-center md:gap-6'}>
              <h3 className="text-title-s text-text-primary">{name}</h3>
              <p className="mt-2 text-body-s text-text-secondary md:mt-0">{description}</p>
              <div className="mt-4 flex items-center justify-between md:mt-0">
                <span className="text-label-s text-text-muted">Pricing by access level</span>
                <span className="text-label-m text-brand-primary">{cta}</span>
              </div>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="Enterprise trust" title="Control points for teams that ship software professionally." className="border-y border-border bg-surface-base">
        <TrustSecurityBand items={trustItems} />
        <div className="mt-6">
          <OwnershipCallout
            title="The output is meant to leave with you."
            description="DEVteam is positioned around code ownership, reviewable implementation details, and a handoff into your existing engineering workflow."
            points={[
              'Generated source is the core artifact.',
              'Preview and diagnostics support acceptance review.',
              'Export is part of the product workflow, not an afterthought.',
            ]}
            action={<CTAButton href="/product" variant="secondary">See product flow</CTAButton>}
          />
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="FAQ" title="Straight answers for software teams.">
        <div className="grid gap-4 md:grid-cols-2">
          {faq.map(([question, answer]) => (
            <div key={question} className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-5 shadow-card">
              <h3 className="text-title-s text-text-primary">{question}</h3>
              <p className="mt-2 text-body-s text-text-secondary">{answer}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <section className="mx-auto w-full max-w-[1180px] px-4 pb-20 sm:px-6 lg:px-8">
        <div className="rounded-[var(--radius-modal)] border border-border bg-brand-primary-subtle p-8 shadow-lg md:p-10">
          <div className="max-w-[760px]">
            <h2 className="text-display-m text-text-primary">Build software from a production workflow, not a prompt canvas.</h2>
            <p className="mt-4 text-body-l text-text-secondary">Request a demo to see how DEVteam generates full-stack code, validates previews, and exports source your team owns.</p>
          </div>
          <div className="mt-6 flex flex-col gap-3 sm:flex-row">
            <CTAButton href="/request-demo">Request demo</CTAButton>
            <CTAButton href="/waitlist" variant="secondary">Join early access</CTAButton>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
