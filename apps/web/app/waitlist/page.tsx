import { Button, Input, Select } from '../../components/ui';
import { MarketingSection, MarketingShell } from '../../src/components/marketing';

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
            <div className="space-y-4">
              <Input aria-label="Work email" placeholder="Work email" type="email" />
              <Input aria-label="Company or project" placeholder="Company or project" />
              <Select aria-label="Primary use case" defaultValue="">
                <option value="" disabled>Primary use case</option>
                <option>SaaS platform</option>
                <option>Marketplace</option>
                <option>Internal tool</option>
                <option>Dashboard</option>
                <option>Booking system</option>
                <option>Social or community platform</option>
              </Select>
            </div>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-label-s text-text-muted">Waitlist submission is disabled because no early-access intake endpoint is connected.</p>
              <Button type="button" disabled title="No waitlist backend endpoint exists">Join waitlist unavailable</Button>
            </div>
          </div>
        </div>
      </MarketingSection>
    </MarketingShell>
  );
}
