import { CTAButton, MarketingSection, MarketingShell } from '../../src/components/marketing';

const plans = [
  ['Early access', 'For individuals and small teams evaluating the production workflow.', ['Waitlist access', 'Generated application previews', 'Source export path']],
  ['Studio', 'For teams regularly generating and validating full-stack applications.', ['Stack selection', 'Diagnostics', 'Project portfolio', 'Team workflow controls']],
  ['Enterprise', 'For organizations that require governance, security review, and support.', ['Security review', 'Admin controls', 'Custom onboarding', 'Commercial terms']],
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Pricing"
        title="Pricing aligned to production usage."
        description="DEVteam is currently offered through early access and team conversations while production controls are finalized."
      >
        <div className="grid gap-4 lg:grid-cols-3">
          {plans.map(([name, description, features]) => (
            <div key={name as string} className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-6 shadow-card">
              <h2 className="text-title-s text-text-primary">{name as string}</h2>
              <p className="mt-2 text-body-s text-text-secondary">{description as string}</p>
              <ul className="mt-5 space-y-2 text-body-s text-text-secondary">
                {(features as string[]).map((feature) => <li key={feature}>- {feature}</li>)}
              </ul>
              <div className="mt-6">
                <CTAButton href={name === 'Early access' ? '/waitlist' : '/request-demo'} variant={name === 'Enterprise' ? 'primary' : 'secondary'}>
                  {name === 'Early access' ? 'Join waitlist' : 'Request details'}
                </CTAButton>
              </div>
            </div>
          ))}
        </div>
      </MarketingSection>
    </MarketingShell>
  );
}
