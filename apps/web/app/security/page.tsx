import { CTAButton, MarketingSection, MarketingShell, OwnershipCallout, ProofStrip, TrustSecurityBand } from '../../src/components/marketing';

const trust = [
  { label: 'Code ownership', detail: 'Generated applications are intended to move into your own repository and development process.' },
  { label: 'Preview evidence', detail: 'Validate runtime behavior before accepting or exporting generated work.' },
  { label: 'Access controls', detail: 'Designed for workspace-based access patterns and administrative review.' },
  { label: 'Production diagnostics', detail: 'Inspect logs, build health, preview state, and verification status.' },
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Security / Trust"
        title="Trust starts with ownership and inspectable output."
        description="DEVteam is designed for teams that need to review generated software, validate runtime behavior, and keep control of source code."
      >
        <TrustSecurityBand items={trust} />
      </MarketingSection>
      <MarketingSection eyebrow="Enterprise review" title="Bring DEVteam through your normal evaluation process." className="border-y border-border bg-surface-base">
        <ProofStrip
          items={[
            { value: 'Review', label: 'Security posture', detail: 'Evaluate current controls, roadmap, data handling, and deployment assumptions.' },
            { value: 'Inspect', label: 'Generated output', detail: 'Use source files, preview state, and diagnostics as review material.' },
            { value: 'Control', label: 'Operational handoff', detail: 'Carry generated source into your normal engineering and governance process.' },
          ]}
        />
      </MarketingSection>
      <MarketingSection eyebrow="No lock-in posture" title="Security review starts with what your team can inspect.">
        <OwnershipCallout
          title="The safest output is visible, reviewable, and portable."
          description="DEVteam's product direction prioritizes exportable source and runtime evidence over opaque generated results."
          points={[
            'Generated source can be reviewed before handoff.',
            'Preview evidence helps validate runtime assumptions.',
            'Enterprise conversations cover current controls and roadmap.',
          ]}
          action={<CTAButton href="/request-demo">Request security review</CTAButton>}
        />
      </MarketingSection>
    </MarketingShell>
  );
}
