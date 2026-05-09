import { ArrowUpRight, Boxes, CheckCircle2, Code2, Database, Eye, FileCode2, GitBranch, Layers3, LockKeyhole, Server, ShieldCheck } from 'lucide-react';
import { CTAButton, FeatureCard, MarketingSection, MarketingShell, ProofVisual, TrustStrip } from '../src/components/marketing';

const proofItems = [
  { title: 'Frontend + backend + database', description: 'Generate application surfaces, service contracts, database schema, and persistence code as one coherent project.', icon: <Layers3 className="h-5 w-5" /> },
  { title: 'Stack selection', description: 'Choose the implementation stack before generation so output matches your team and deployment target.', icon: <Boxes className="h-5 w-5" /> },
  { title: 'Preview validation', description: 'Run the generated application and inspect health, logs, and runtime evidence before export.', icon: <Eye className="h-5 w-5" /> },
  { title: 'Exportable source code', description: 'Keep the generated code in your own repository. DEVteam is a production tool, not a hosting lock-in.', icon: <FileCode2 className="h-5 w-5" /> },
];

const workflow = ['Define', 'Build', 'Verify', 'Preview', 'Export', 'Launch'];

const differentiators = [
  'Full-stack output',
  '100% code ownership',
  'No platform lock-in',
  'Diagnostics built in',
  'Real preview runtime',
  'Stack choice before build',
];

const useCases = ['SaaS platforms', 'Marketplaces', 'Internal tools', 'Dashboards', 'Booking systems', 'Social and community platforms'];

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
            <h1 className="mt-4 max-w-[820px] text-[44px] font-semibold leading-[1.05] tracking-[-0.03em] text-text-primary sm:text-[64px]">
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
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {proofItems.map((item) => <FeatureCard key={item.title} {...item} />)}
        </div>
      </MarketingSection>

      <MarketingSection
        eyebrow="Workflow"
        title="A clear path from requirement to launch-ready code."
        description="The workflow keeps generation grounded in software production stages rather than an open-ended prompt loop."
        className="border-y border-border bg-surface-base"
      >
        <div className="grid gap-3 md:grid-cols-6">
          {workflow.map((step, index) => (
            <div key={step} className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-4 shadow-card">
              <p className="font-mono text-mono-s text-text-muted">0{index + 1}</p>
              <h3 className="mt-3 text-label-m text-text-primary">{step}</h3>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="Differentiators" title="Built for ownership, validation, and engineering control.">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {differentiators.map((item) => (
            <div key={item} className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-border bg-surface-raised p-4 shadow-hairline">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-status-success" aria-hidden="true" />
              <span className="text-body-s text-text-primary">{item}</span>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection
        eyebrow="Use cases"
        title="Production starting points for real application categories."
        description="Use DEVteam when the output needs application logic, data models, operational visibility, and source ownership."
        className="border-y border-border bg-surface-base"
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {useCases.map((item) => (
            <div key={item} className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-5 shadow-card">
              <h3 className="text-title-s text-text-primary">{item}</h3>
              <p className="mt-2 text-body-s text-text-secondary">Generate the application foundation, validate behavior, then continue development in your own codebase.</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="Pricing preview" title="Start with early access. Scale with production needs.">
        <div className="grid gap-4 lg:grid-cols-3">
          {[
            ['Early access', 'For builders validating the workflow.', 'Join waitlist'],
            ['Studio', 'For teams producing full-stack applications regularly.', 'Request pricing'],
            ['Enterprise', 'For governance, security, and deployment controls.', 'Talk to sales'],
          ].map(([name, description, cta]) => (
            <div key={name} className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-6 shadow-card">
              <h3 className="text-title-s text-text-primary">{name}</h3>
              <p className="mt-2 min-h-[44px] text-body-s text-text-secondary">{description}</p>
              <div className="mt-5 flex items-center justify-between border-t border-border-muted pt-4">
                <span className="text-label-s text-text-muted">Pricing by access level</span>
                <ArrowUpRight className="h-4 w-4 text-text-muted" />
              </div>
              <p className="mt-4 text-label-m text-brand-primary">{cta}</p>
            </div>
          ))}
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="Enterprise trust" title="Control points for teams that ship software professionally." className="border-y border-border bg-surface-base">
        <TrustStrip />
        <div className="mt-4 grid gap-4 md:grid-cols-3">
          <FeatureCard title="Security posture" description="Designed around code ownership, reviewable artifacts, and controlled access patterns." icon={<ShieldCheck className="h-5 w-5" />} />
          <FeatureCard title="Repository portability" description="Move generated projects into your own repository and delivery process." icon={<GitBranch className="h-5 w-5" />} />
          <FeatureCard title="Technical evidence" description="Use diagnostics and preview validation to assess generated output before handoff." icon={<Code2 className="h-5 w-5" />} />
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
