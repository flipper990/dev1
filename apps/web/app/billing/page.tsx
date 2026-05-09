import { AppShell } from '../../src/components/shell';
import { Badge, Button, Card, Panel, StatusDot } from '../../components/ui';

export default function BillingPage() {
  return (
    <AppShell
      title="Billing"
      subtitle="Usage and billing controls for production work."
      lifecycle={{ label: 'Billing backend not connected', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Billing' }]}
      actions={<Button disabled title="Billing portal endpoint is not available in this repository">Manage plan unavailable</Button>}
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
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-label-s text-text-muted">Billing portal</p>
          <p className="mt-2 text-title-s text-text-primary">Not connected</p>
          <p className="mt-2 text-body-s text-text-secondary">No backend endpoint exists for plan changes or invoices.</p>
        </Card>
        <Card>
          <p className="text-label-s text-text-muted">Usage source</p>
          <p className="mt-2 text-title-s text-text-primary">Project records</p>
          <p className="mt-2 text-body-s text-text-secondary">Token and cost summaries are shown from real project data on Overview and Projects.</p>
        </Card>
        <Card>
          <p className="text-label-s text-text-muted">Status</p>
          <div className="mt-2"><Badge variant="warning">Billing controls unavailable</Badge></div>
        </Card>
      </div>
    </AppShell>
  );
}
