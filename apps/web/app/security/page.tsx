import { Eye, FileCode2, KeyRound, LockKeyhole, Server, ShieldCheck } from 'lucide-react';
import { CTAButton, FeatureCard, MarketingSection, MarketingShell } from '../../src/components/marketing';

const trust = [
  { title: 'Code ownership', description: 'Generated applications are intended to move into your own repository and development process.', icon: <FileCode2 className="h-5 w-5" /> },
  { title: 'Preview evidence', description: 'Validate runtime behavior before accepting or exporting generated work.', icon: <Eye className="h-5 w-5" /> },
  { title: 'Access controls', description: 'Designed for workspace-based access patterns and administrative review.', icon: <KeyRound className="h-5 w-5" /> },
  { title: 'Production diagnostics', description: 'Inspect logs, build health, preview state, and verification status.', icon: <Server className="h-5 w-5" /> },
  { title: 'Security conversations', description: 'Enterprise engagement includes review of security posture and operational controls.', icon: <ShieldCheck className="h-5 w-5" /> },
  { title: 'No lock-in posture', description: 'The product direction prioritizes exportable source over proprietary runtime dependency.', icon: <LockKeyhole className="h-5 w-5" /> },
];

export default function SecurityPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Security / Trust"
        title="Trust starts with ownership and inspectable output."
        description="DEVteam is designed for teams that need to review generated software, validate runtime behavior, and keep control of source code."
      >
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {trust.map((item) => <FeatureCard key={item.title} {...item} />)}
        </div>
      </MarketingSection>
      <MarketingSection eyebrow="Enterprise review" title="Bring DEVteam through your normal evaluation process." className="border-y border-border bg-surface-base">
        <p className="max-w-[760px] text-body-l text-text-secondary">
          Security and compliance requirements vary by organization. Request a demo to review current controls, roadmap, data handling, and deployment assumptions with the DEVteam team.
        </p>
      </MarketingSection>
      <section className="mx-auto w-full max-w-[1180px] px-4 pb-20 sm:px-6 lg:px-8">
        <CTAButton href="/request-demo">Request security review</CTAButton>
      </section>
    </MarketingShell>
  );
}
