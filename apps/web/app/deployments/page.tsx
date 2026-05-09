import { AppShell } from '../../src/components/shell';
import { Badge, Button, Card, StatusDot } from '../../components/ui';

export default function DeploymentsPage() {
  return (
    <AppShell
      title="Deployments"
      subtitle="Track release readiness and production rollout history."
      lifecycle={{ label: '1 pending approval', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/' }, { label: 'Deployments' }]}
      actions={<Button>New deployment</Button>}
      contextTitle="Trust details"
      contextContent={
        <div className="space-y-2">
          <StatusDot tone="success" label="Rollback window active" />
          <StatusDot tone="warning" label="Pending change approval" />
        </div>
      }
      workspaceName="DEVteam Studio"
    >
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-title-s text-ink">Production - v1.42.0</h2>
            <p className="mt-1 text-body-s text-secondary">Released today at 10:42</p>
          </div>
          <Badge variant="success">Live</Badge>
        </div>
      </Card>
    </AppShell>
  );
}
