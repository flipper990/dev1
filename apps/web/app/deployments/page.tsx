import Link from 'next/link';
import { AppShell } from '../../src/components/shell';
import { Badge, Button, EmptyState, StatusDot } from '../../components/ui';
import { InlineStatusPanel } from '../../src/components/feedback';

export default function DeploymentsPage() {
  return (
    <AppShell
      title="Deployments"
      subtitle="Release readiness and production rollout history."
      lifecycle={{ label: 'Deployment backend missing', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Deployments' }]}
      actions={<Link href="/workspace"><Button variant="secondary">Export from workspace</Button></Link>}
      contextTitle="Trust details"
      contextContent={
        <div className="space-y-2">
          <StatusDot tone="warning" label="Deployment API missing" />
          <StatusDot tone="neutral" label="Use export source for handoff" />
        </div>
      }
      workspaceName="DEVteam Studio"
    >
      <div className="space-y-4">
        <InlineStatusPanel
          tone="warning"
          title="Deployment actions require a release backend"
          where="New deployment creation, deployment history, rollout status, and environment promotion"
          whatWorked="Generated source can still be exported from the workspace for deployment through your own delivery system."
          whatFailed="No deployment endpoint or release history contract exists in this repository."
          nextAction="Connect deployment orchestration before enabling release controls."
          actions={
            <>
              <Link href="/workspace"><Button variant="secondary" size="sm">Open workspace</Button></Link>
              <Link href="/docs/export-ownership"><Button variant="secondary" size="sm">Read launch flow</Button></Link>
            </>
          }
        />

        <EmptyState
          title="Deployments coming soon"
          description="Release tracking is intentionally hidden behind backend availability. This page will show deployment history after a real release API is connected."
          action={<Badge variant="warning">Requires deployment endpoint</Badge>}
        />
      </div>
    </AppShell>
  );
}
