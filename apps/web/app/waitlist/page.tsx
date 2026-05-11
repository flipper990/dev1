import { Badge, Input, Select } from '../../components/ui';
import { SystemBanner } from '../../src/components/feedback';
import { CTAButton, MarketingSection, MarketingShell } from '../../src/components/marketing';

export default function WaitlistPage() {
  return (
    <MarketingShell>
      <MarketingSection
        eyebrow="Early access"
        title="Join the DEVteam early access list."
        description="Early access is for teams that want to evaluate full-stack generation, preview validation, diagnostics, and source export before broad availability."
      >
        <div className="grid gap-8 lg:grid-cols-[1fr_1fr]">
          <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-6 shadow-card">
            <h2 className="text-title-s text-text-primary">Good fit for early access</h2>
            <ul className="mt-4 space-y-3 text-body-s text-text-secondary">
              <li>- You build SaaS, internal tools, marketplaces, dashboards, or workflow products.</li>
              <li>- Your team wants source code ownership and no runtime lock-in.</li>
              <li>- You care about validation and diagnostics, not just generated screens.</li>
            </ul>
          </div>
          <div className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-6 shadow-card">
            <SystemBanner
              tone="warning"
              title="Early-access intake coming soon"
              description="The waitlist form is visible as the planned intake shape. It does not submit until an early-access backend endpoint is connected."
            />
            <div className="mt-5 space-y-4">
              <label className="block text-label-m text-text-primary" htmlFor="waitlist-email">
                Work email
                <Input id="waitlist-email" className="mt-1.5" placeholder="name@company.com" type="email" disabled />
              </label>
              <label className="block text-label-m text-text-primary" htmlFor="waitlist-company">
                Company or project
                <Input id="waitlist-company" className="mt-1.5" placeholder="Company or project" disabled />
              </label>
              <label className="block text-label-m text-text-primary" htmlFor="waitlist-use-case">
                <span>Primary use case</span>
                <div className="mt-1.5">
                  <Select id="waitlist-use-case" defaultValue="" disabled>
                    <option value="" disabled>Primary use case</option>
                    <option>SaaS platform</option>
                    <option>Marketplace</option>
                    <option>Internal tool</option>
                    <option>Dashboard</option>
                    <option>Booking system</option>
                    <option>Social or community platform</option>
                  </Select>
                </div>
              </label>
            </div>
            <div className="mt-5 flex flex-col gap-3 rounded-[var(--radius-panel)] border border-border bg-surface-base p-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <Badge variant="warning">Requires waitlist endpoint</Badge>
                <p className="mt-2 text-body-s text-text-secondary">
                  No waitlist record is created from this page yet. Explore the current product workflow while intake is added.
                </p>
              </div>
              <CTAButton href="/product" variant="secondary">Review product</CTAButton>
            </div>
          </div>
        </div>
      </MarketingSection>
    </MarketingShell>
  );
}
