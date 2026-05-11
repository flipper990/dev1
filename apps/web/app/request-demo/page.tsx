import { Badge, Input, Select, Textarea } from '../../components/ui';
import { SystemBanner } from '../../src/components/feedback';
import { CTAButton, MarketingSection, MarketingShell } from '../../src/components/marketing';

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
            <SystemBanner
              tone="warning"
              title="Demo intake endpoint coming soon"
              description="The request form is shown as a planned sales intake flow. Submission is intentionally disabled until a real marketing endpoint is connected."
            />
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <label className="block text-label-m text-text-primary" htmlFor="demo-email">
                Work email
                <Input id="demo-email" className="mt-1.5" placeholder="name@company.com" type="email" disabled />
              </label>
              <label className="block text-label-m text-text-primary" htmlFor="demo-name">
                Name
                <Input id="demo-name" className="mt-1.5" placeholder="Your name" disabled />
              </label>
              <label className="block text-label-m text-text-primary" htmlFor="demo-company">
                Company
                <Input id="demo-company" className="mt-1.5" placeholder="Company" disabled />
              </label>
              <label className="block text-label-m text-text-primary" htmlFor="demo-team-size">
                <span>Team size</span>
                <div className="mt-1.5">
                  <Select id="demo-team-size" defaultValue="" disabled>
                    <option value="" disabled>Team size</option>
                    <option>1-10</option>
                    <option>11-50</option>
                    <option>51-200</option>
                    <option>201+</option>
                  </Select>
                </div>
              </label>
            </div>
            <label className="mt-4 block text-label-m text-text-primary" htmlFor="demo-brief">
              What do you want to build?
              <Textarea id="demo-brief" className="mt-1.5" rows={5} placeholder="What type of application do you want to evaluate?" disabled />
            </label>
            <div className="mt-5 flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-surface-base p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Badge variant="warning">Requires marketing intake endpoint</Badge>
                <p className="mt-2 text-body-s text-text-secondary">
                  No demo request is sent from this page. Review the product workflow while the intake backend is added.
                </p>
              </div>
              <CTAButton href="/docs" variant="secondary">Open workflow docs</CTAButton>
            </div>
          </div>
        </div>
      </MarketingSection>
    </MarketingShell>
  );
}
