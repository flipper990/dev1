import { Building2, GitBranch, KeyRound, ShieldCheck } from 'lucide-react';
import { CTAButton, FeatureCard, MarketingSection, MarketingShell, TrustStrip } from '../../src/components/marketing';

export default function EnterprisePage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Enterprise"
        title="Software generation with the controls organizations expect."
        description="Enterprise teams need more than generated screens. DEVteam focuses on ownership, governance, diagnostics, and integration into existing engineering workflows."
      >
        <TrustStrip />
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          <FeatureCard title="Governed access" description="Workspace controls and administrative review paths for production teams." icon={<KeyRound className="h-5 w-5" />} />
          <FeatureCard title="Own the code" description="Export generated applications into your repository and delivery system." icon={<GitBranch className="h-5 w-5" />} />
          <FeatureCard title="Security review" description="Support for security and procurement conversations before rollout." icon={<ShieldCheck className="h-5 w-5" />} />
          <FeatureCard title="Team onboarding" description="Workflow alignment for product, engineering, and platform teams." icon={<Building2 className="h-5 w-5" />} />
        </div>
      </MarketingSection>
      <MarketingSection eyebrow="Fit" title="For teams standardizing application production." className="border-y border-border bg-surface-base">
        <p className="max-w-[760px] text-body-l text-text-secondary">
          DEVteam is appropriate when teams need repeatable full-stack output, reviewable evidence, stack consistency, and clear ownership after generation.
        </p>
      </MarketingSection>
      <section className="mx-auto w-full max-w-[1180px] px-4 pb-20 sm:px-6 lg:px-8">
        <CTAButton href="/request-demo">Talk to enterprise sales</CTAButton>
      </section>
    </MarketingShell>
  );
}
