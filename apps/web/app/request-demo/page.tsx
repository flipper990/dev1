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
