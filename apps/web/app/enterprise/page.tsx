import { CTAButton, MarketingSection, MarketingShell, OwnershipCallout, ProofStrip, TrustSecurityBand, TrustStrip } from '../../src/components/marketing';

const trustItems = [
  { label: 'Governed access', detail: 'Workspace controls and administrative review paths for production teams.' },
  { label: 'Own the code', detail: 'Export generated applications into your repository and delivery system.' },
  { label: 'Security review', detail: 'Support for security and procurement conversations before rollout.' },
  { label: 'Team onboarding', detail: 'Workflow alignment for product, engineering, and platform teams.' },
];

export default function EnterprisePage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Enterprise"
        title="Software generation with the controls organizations expect."
        description="Enterprise teams need more than generated screens. DEVteam focuses on ownership, governance, diagnostics, and integration into existing engineering workflows."
      >
        <TrustStrip />
        <div className="mt-6">
          <TrustSecurityBand items={trustItems} />
        </div>
      </MarketingSection>
      <MarketingSection eyebrow="Fit" title="For teams standardizing application production." className="border-y border-border bg-surface-base">
        <ProofStrip
          items={[
            { value: 'Repeatable', label: 'Application production workflow', detail: 'Define, build, verify, preview, export, and continue in your own process.' },
            { value: 'Inspectable', label: 'Evidence before handoff', detail: 'Runtime preview and diagnostics support engineering review before acceptance.' },
            { value: 'Portable', label: 'Generated source ownership', detail: 'Output is positioned for your repository, not permanent hosting lock-in.' },
          ]}
        />
      </MarketingSection>
      <MarketingSection eyebrow="Export posture" title="Designed to fit your engineering controls.">
        <OwnershipCallout
          title="Generated applications should enter your normal delivery system."
          description="Enterprise evaluation can focus on source ownership, security posture, review workflows, and the backend contracts required for production rollout."
          points={[
            'Review generated source before acceptance.',
            'Use diagnostics as part of engineering signoff.',
            'Connect deployment and billing controls only when real backend endpoints exist.',
          ]}
          action={<CTAButton href="/request-demo">Talk to enterprise sales</CTAButton>}
        />
      </MarketingSection>
    </MarketingShell>
  );
}
