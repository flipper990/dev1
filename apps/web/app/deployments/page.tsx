import { AppShell } from '../../src/components/shell';
import { Badge, Button, Card, StatusDot } from '../../components/ui';

export default function DeploymentsPage() {
  return (
    <AppShell
      title="Deployments"
      subtitle="Release readiness and production rollout history."
      lifecycle={{ label: 'Deployment backend missing', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Deployments' }]}
      actions={<Button disabled title="No deployment creation endpoint exists">New deployment unavailable</Button>}
      contextTitle="Trust details"
      contextContent={
        <div className="space-y-2">
          <StatusDot tone="warning" label="Deployment API missing" />
          <StatusDot tone="neutral" label="Use export source for handoff" />
        </div>
      }
      workspaceName="DEVteam Studio"
    >
      <Card>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-title-s text-text-primary">Deployment tracking unavailable</h2>
            <p className="mt-1 text-body-s text-text-secondary">
              No deployment endpoint or release history contract exists in this repository. Export source from the workspace and deploy through your own delivery system.
            </p>
          </div>
          <Badge variant="warning">Not connected</Badge>
        </div>
      </Card>
    </AppShell>
  );
}
