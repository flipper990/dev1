import Link from 'next/link';
import { AppShell } from '../../src/components/shell';
import { Badge, Button, Card, Panel, StatusDot } from '../../components/ui';
import { InlineStatusPanel } from '../../src/components/feedback';

export default function BillingPage() {
  return (
    <AppShell
      title="Billing"
      subtitle="Usage and billing controls for production work."
      lifecycle={{ label: 'Billing backend not connected', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Billing' }]}
      actions={<Link href="/docs/billing"><Button variant="secondary">Open billing docs</Button></Link>}
      contextTitle="Billing status"
      contextContent={
        <Panel title="Backend contract" subtitle="No billing portal endpoint is present">
          <div className="space-y-3">
            <StatusDot tone="warning" label="Billing API missing" />
            <p className="text-body-s text-text-secondary">
              Plan management is disabled until a billing provider or backend billing route is added.
            </p>
          </div>
        </Panel>
      }
      workspaceName="DEVteam Studio"
    >
      <div className="space-y-4">
        <InlineStatusPanel
          tone="warning"
          title="Billing management requires a backend endpoint"
          where="Plan changes, invoices, and payment portal handoff"
          whatWorked="Project usage and cost summaries are still available from backend project records on Overview and Projects."
          whatFailed="No billing provider route or customer portal endpoint is connected in this repository."
          nextAction="Connect a billing provider endpoint before enabling plan management."
          actions={
            <>
              <Link href="/overview"><Button variant="secondary" size="sm">View usage</Button></Link>
              <Link href="/request-demo"><Button variant="secondary" size="sm">Contact sales</Button></Link>
            </>
          }
        />

        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <p className="text-label-s text-text-muted">Billing portal</p>
            <p className="mt-2 text-title-s text-text-primary">Coming soon</p>
            <p className="mt-2 text-body-s text-text-secondary">Plan management stays unavailable until a real billing portal endpoint exists.</p>
          </Card>
          <Card>
            <p className="text-label-s text-text-muted">Usage source</p>
            <p className="mt-2 text-title-s text-text-primary">Project records</p>
            <p className="mt-2 text-body-s text-text-secondary">Token and cost summaries are shown from real project data on Overview and Projects.</p>
          </Card>
          <Card>
            <p className="text-label-s text-text-muted">Feature availability</p>
            <div className="mt-2"><Badge variant="warning">Requires billing endpoint</Badge></div>
            <p className="mt-2 text-body-s text-text-secondary">No invoices, subscriptions, or checkout actions are exposed as functional controls.</p>
          </Card>
        </div>
      </div>
    </AppShell>
  );
}
