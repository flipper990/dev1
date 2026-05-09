import { AppShell } from '../../src/components/shell';
import { Badge, Button, Card } from '../../components/ui';

export default function BillingPage() {
  return (
    <AppShell
      title="Billing"
      subtitle="Understand spend and manage billing controls with clear operational context."
      lifecycle={{ label: 'Current plan: Team', tone: 'active' }}
      breadcrumbs={[{ label: 'Workspace', href: '/' }, { label: 'Billing' }]}
      actions={<Button>Manage plan</Button>}
      workspaceName="DEVteam Studio"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-label-s text-secondary">This month</p>
          <p className="mt-1 text-title-l text-ink">$1,284</p>
        </Card>
        <Card>
          <p className="text-label-s text-secondary">Forecast</p>
          <p className="mt-1 text-title-l text-ink">$1,510</p>
        </Card>
        <Card>
          <p className="text-label-s text-secondary">Status</p>
          <div className="mt-2"><Badge variant="success">In good standing</Badge></div>
        </Card>
      </div>
    </AppShell>
  );
}
