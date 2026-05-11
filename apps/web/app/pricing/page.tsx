import { CheckCircle2 } from 'lucide-react';
import { ComparisonTable, CTAButton, MarketingSection, MarketingShell, ProofStrip } from '../../src/components/marketing';

const plans = [
  { name: 'Early access', description: 'For individuals and small teams evaluating the production workflow.', cta: 'Join waitlist', href: '/waitlist', features: ['Waitlist access', 'Generated application previews', 'Source export path'] },
  { name: 'Studio', description: 'For teams regularly generating and validating full-stack applications.', cta: 'Request details', href: '/request-demo', features: ['Stack selection', 'Diagnostics', 'Project portfolio', 'Team workflow controls'] },
  { name: 'Enterprise', description: 'For organizations that require governance, security review, and support.', cta: 'Contact sales', href: '/request-demo', features: ['Security review', 'Admin controls', 'Custom onboarding', 'Commercial terms'] },
];

const comparisonRows = [
  { capability: 'Best for', devteam: 'Teams evaluating source-owned software generation', typical: 'Seat-based design or prototype access' },
  { capability: 'Commercial status', devteam: 'Early access and sales-led conversations', typical: 'Self-serve checkout before production fit is clear' },
  { capability: 'Primary value', devteam: 'Generated code, preview evidence, diagnostics, export', typical: 'Hosted page generation or prompt usage' },
];

export default function PricingPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Pricing"
        title="Pricing aligned to production usage."
        description="DEVteam is currently offered through early access and team conversations while production controls are finalized."
      >
        <div className="space-y-6">
          <ProofStrip
            items={[
              { value: 'Early', label: 'Current access model', detail: 'Teams enter through waitlist or sales conversations while paid controls are finalized.' },
              { value: 'Usage', label: 'Pricing direction', detail: 'Plans align to production workflow, project evidence, and team needs.' },
              { value: 'Sales', label: 'Enterprise path', detail: 'Security review, onboarding, and commercial terms are handled directly.' },
            ]}
          />

          <div className="overflow-hidden rounded-[var(--radius-modal)] border border-border bg-surface-raised shadow-card">
            {plans.map((plan, index) => (
              <div key={plan.name} className={index > 0 ? 'border-t border-border-muted' : undefined}>
                <div className="grid gap-5 p-5 lg:grid-cols-[0.65fr_1fr_0.45fr] lg:items-start">
                  <div>
                    <h2 className="text-title-s text-text-primary">{plan.name}</h2>
                    <p className="mt-2 text-body-s text-text-secondary">{plan.description}</p>
                  </div>
                  <ul className="grid gap-2 text-body-s text-text-secondary sm:grid-cols-2">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  <CTAButton href={plan.href} variant={plan.name === 'Enterprise' ? 'primary' : 'secondary'}>
                    {plan.cta}
                  </CTAButton>
                </div>
              </div>
            ))}
          </div>

          <ComparisonTable rows={comparisonRows} />
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="Billing availability" title="Checkout is not presented until the backend exists." className="border-y border-border bg-surface-base">
        <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-6 shadow-card">
          <p className="max-w-[760px] text-body-l text-text-secondary">
            Billing management currently requires a backend billing provider and portal endpoint. Pricing CTAs route to early access or sales conversations instead of showing fake checkout.
          </p>
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <CTAButton href="/waitlist" variant="secondary">Join early access</CTAButton>
            <CTAButton href="/request-demo">Contact sales</CTAButton>
          </div>
        </div>
      </MarketingSection>
    </MarketingShell>
  );
}
