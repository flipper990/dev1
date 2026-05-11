import { Code2, Database, Eye, FileCode2, Layers3, Server } from 'lucide-react';
import {
  ComparisonTable,
  CTAButton,
  LifecycleDiagram,
  MarketingSection,
  MarketingShell,
  OwnershipCallout,
  ProofStrip,
  StackedProductScreenshots,
} from '../../src/components/marketing';

const capabilities = [
  { title: 'Application frontend', description: 'User-facing screens, flows, state boundaries, and typed UI structure.', icon: <Code2 className="h-5 w-5" /> },
  { title: 'Backend services', description: 'API routes, service logic, validation paths, and integration-ready contracts.', icon: <Server className="h-5 w-5" /> },
  { title: 'Database layer', description: 'Schema, seed data, migrations, and persistence models that match the application.', icon: <Database className="h-5 w-5" /> },
  { title: 'Preview validation', description: 'Run the application and inspect runtime readiness before source export.', icon: <Eye className="h-5 w-5" /> },
  { title: 'Stack selection', description: 'Select technical foundations before generation so output fits your engineering standards.', icon: <Layers3 className="h-5 w-5" /> },
  { title: 'Source ownership', description: 'Export the generated application and continue development in your own repository.', icon: <FileCode2 className="h-5 w-5" /> },
];

const lifecycle = [
  { label: 'Brief', detail: 'Turn product requirements into a concrete build target.' },
  { label: 'Stack', detail: 'Select implementation foundations before generation.' },
  { label: 'Generate', detail: 'Produce UI, API, data, and project structure.' },
  { label: 'Preview', detail: 'Inspect the running application output.' },
  { label: 'Diagnose', detail: 'Review logs, health, and verification state.' },
  { label: 'Export', detail: 'Move source into your own repository.' },
];

const outputRows = [
  { capability: 'Code artifact', devteam: 'Source files and project structure', typical: 'Hosted mockup or partial UI' },
  { capability: 'Validation artifact', devteam: 'Preview, logs, health, and diagnostics', typical: 'Visual inspection only' },
  { capability: 'Ownership artifact', devteam: 'Export path into your codebase', typical: 'Platform runtime dependency' },
];

export default function ProductPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Product"
        title="An AI production system for full-stack application code."
        description="DEVteam coordinates product definition, stack selection, generation, preview validation, diagnostics, and export into one serious software workflow."
      >
        <div className="grid gap-8 lg:grid-cols-[0.82fr_1.18fr] lg:items-center">
          <div className="space-y-4">
            {capabilities.map((item) => (
              <div key={item.title} className="flex gap-4 border-l border-border-strong pl-4">
                <span className="mt-1 inline-grid h-9 w-9 shrink-0 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-brand-primary">
                  {item.icon}
                </span>
                <div>
                  <h3 className="text-title-s text-text-primary">{item.title}</h3>
                  <p className="mt-1 text-body-s text-text-secondary">{item.description}</p>
                </div>
              </div>
            ))}
          </div>
          <StackedProductScreenshots />
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="Workflow" title="One product flow from brief to export." className="border-y border-border bg-surface-base">
        <LifecycleDiagram steps={lifecycle} />
      </MarketingSection>

      <MarketingSection eyebrow="Output" title="Designed for code review and continued engineering.">
        <div className="space-y-6">
          <ProofStrip
            items={[
              { value: 'Source', label: 'Generated application code', detail: 'Frontend, backend, database, and project files are treated as the main deliverable.' },
              { value: 'Runtime', label: 'Preview evidence', detail: 'The preview area validates generated output before export decisions.' },
              { value: 'Handoff', label: 'Owned continuation path', detail: 'Output is meant to continue inside your own repository and engineering process.' },
            ]}
          />
          <ComparisonTable rows={outputRows} />
        </div>
      </MarketingSection>

      <MarketingSection eyebrow="Export" title="The generated project is meant to become yours." className="border-y border-border bg-surface-base">
        <OwnershipCallout
          title="DEVteam is not positioned as a permanent runtime."
          description="The product workflow centers the generated source, preview evidence, and export handoff so teams can evaluate and continue the work outside the tool."
          points={[
            'Review implementation files before handoff.',
            'Use preview and diagnostics to judge readiness.',
            'Continue development in your own repository.',
          ]}
          action={<CTAButton href="/request-demo">See the product workflow</CTAButton>}
        />
      </MarketingSection>

    </MarketingShell>
  );
}
