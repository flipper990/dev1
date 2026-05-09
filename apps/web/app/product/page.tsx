import { Code2, Database, Eye, FileCode2, Layers3, Server } from 'lucide-react';
import { CTAButton, FeatureCard, MarketingSection, MarketingShell, ProofVisual } from '../../src/components/marketing';

const capabilities = [
  { title: 'Application frontend', description: 'User-facing screens, flows, state boundaries, and typed UI structure.', icon: <Code2 className="h-5 w-5" /> },
  { title: 'Backend services', description: 'API routes, service logic, validation paths, and integration-ready contracts.', icon: <Server className="h-5 w-5" /> },
  { title: 'Database layer', description: 'Schema, seed data, migrations, and persistence models that match the application.', icon: <Database className="h-5 w-5" /> },
  { title: 'Preview validation', description: 'Run the application and inspect runtime readiness before source export.', icon: <Eye className="h-5 w-5" /> },
  { title: 'Stack selection', description: 'Select technical foundations before generation so output fits your engineering standards.', icon: <Layers3 className="h-5 w-5" /> },
  { title: 'Source ownership', description: 'Export the generated application and continue development in your own repository.', icon: <FileCode2 className="h-5 w-5" /> },
];

export default function ProductPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Product"
        title="An AI production system for full-stack application code."
        description="DEVteam coordinates product definition, stack selection, generation, preview validation, diagnostics, and export into one serious software workflow."
      >
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1fr]">
          <div className="grid gap-4 sm:grid-cols-2">
            {capabilities.map((item) => <FeatureCard key={item.title} {...item} />)}
          </div>
          <ProofVisual />
        </div>
      </MarketingSection>
      <MarketingSection eyebrow="Output" title="Designed for code review and continued engineering." className="border-y border-border bg-surface-base">
        <div className="grid gap-4 md:grid-cols-3">
          {['Generated source', 'Runtime evidence', 'Export path'].map((item) => (
            <div key={item} className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-5 shadow-card">
              <h3 className="text-title-s text-text-primary">{item}</h3>
              <p className="mt-2 text-body-s text-text-secondary">Review the artifact, validate it, and move it into your own development process.</p>
            </div>
          ))}
        </div>
      </MarketingSection>
      <section className="mx-auto w-full max-w-[1180px] px-4 pb-20 sm:px-6 lg:px-8">
        <CTAButton href="/request-demo">See the product workflow</CTAButton>
      </section>
    </MarketingShell>
  );
}
