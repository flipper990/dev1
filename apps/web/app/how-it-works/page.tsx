import { CheckCircle2 } from 'lucide-react';
import { CTAButton, MarketingSection, MarketingShell } from '../../src/components/marketing';

const steps = [
  ['Define', 'Capture the product intent, core flows, entities, and operational requirements.'],
  ['Build', 'Generate frontend, backend, database, and supporting project structure.'],
  ['Verify', 'Inspect checks, logs, and diagnostics against the requested behavior.'],
  ['Preview', 'Run the generated application in a real preview environment.'],
  ['Export', 'Move source code into your own repository with the application artifacts.'],
  ['Launch', 'Continue through your normal deployment and review process.'],
];

export default function HowItWorksPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="How it works"
        title="A production workflow with explicit stages."
        description="DEVteam avoids open-ended prompt sprawl by organizing generation around the same lifecycle teams use to deliver software."
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {steps.map(([title, description], index) => (
            <div key={title} className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-5 shadow-card">
              <div className="flex items-center justify-between gap-3">
                <span className="font-mono text-mono-s text-text-muted">0{index + 1}</span>
                <CheckCircle2 className="h-5 w-5 text-status-success" aria-hidden="true" />
              </div>
              <h2 className="mt-5 text-title-s text-text-primary">{title}</h2>
              <p className="mt-2 text-body-s text-text-secondary">{description}</p>
            </div>
          ))}
        </div>
      </MarketingSection>
      <MarketingSection eyebrow="Operating model" title="Human review stays in the loop." className="border-y border-border bg-surface-base">
        <p className="max-w-[760px] text-body-l text-text-secondary">
          DEVteam is built to produce inspectable software artifacts. Teams can review the generated source, validate the preview, inspect diagnostics, and decide what moves forward.
        </p>
      </MarketingSection>
      <section className="mx-auto w-full max-w-[1180px] px-4 pb-20 sm:px-6 lg:px-8">
        <CTAButton href="/request-demo">Walk through a build</CTAButton>
      </section>
    </MarketingShell>
  );
}
