import { Button, Input, Select, Textarea } from '../../components/ui';
import { MarketingSection, MarketingShell } from '../../src/components/marketing';

export default function RequestDemoPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Request demo"
        title="See DEVteam generate and validate a full-stack application."
        description="Tell us what your team wants to evaluate. The demo focuses on product workflow, generated artifacts, preview validation, diagnostics, and source ownership."
      >
        <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
          <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-6 shadow-card">
            <h2 className="text-title-s text-text-primary">What the demo covers</h2>
            <ul className="mt-4 space-y-3 text-body-s text-text-secondary">
              <li>- Defining an application brief</li>
              <li>- Selecting a full-stack target</li>
              <li>- Reviewing generated source structure</li>
              <li>- Inspecting preview and diagnostics</li>
              <li>- Understanding export and ownership</li>
            </ul>
          </div>
          <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-6 shadow-card">
            <div className="grid gap-4 sm:grid-cols-2">
              <Input aria-label="Work email" placeholder="Work email" type="email" />
              <Input aria-label="Name" placeholder="Name" />
              <Input aria-label="Company" placeholder="Company" />
              <Select aria-label="Team size" defaultValue="">
                <option value="" disabled>Team size</option>
                <option>1-10</option>
                <option>11-50</option>
                <option>51-200</option>
                <option>201+</option>
              </Select>
            </div>
            <Textarea className="mt-4" rows={5} aria-label="What do you want to build?" placeholder="What type of application do you want to evaluate?" />
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-label-s text-text-muted">Demo request submission is disabled because no marketing intake endpoint is connected.</p>
              <Button type="button" disabled title="No request-demo backend endpoint exists">Request demo unavailable</Button>
            </div>
          </div>
        </div>
      </MarketingSection>
    </MarketingShell>
  );
}
