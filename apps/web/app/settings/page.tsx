import { AppShell } from '../../src/components/shell';
import { Button, Card, Input, Panel, Textarea } from '../../components/ui';
import { SetupStepper } from '../../src/features/settings/components';
import { SystemBanner } from '../../src/components/feedback';

export default function SettingsPage() {
  return (
    <AppShell
      title="Settings"
      subtitle="Configure workspace-wide defaults and operating policies."
      lifecycle={{ label: 'Setup in progress', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/' }, { label: 'Settings' }]}
      actions={<Button>Save changes</Button>}
      secondaryActions={<Button variant="secondary">Discard</Button>}
      contextTitle="Diagnostics"
      contextDescription="Secondary context and operational metadata"
      contextContent={
        <Panel title="Change log" subtitle="Recent administrative actions">
          <ul className="space-y-2 text-body-s text-secondary">
            <li>Updated deployment policy - 2h ago</li>
            <li>Rotated API key - yesterday</li>
            <li>Added workspace member - 3 days ago</li>
          </ul>
        </Panel>
      }
      workspaceName="DEVteam Studio"
    >
      <div className="space-y-4">
        <SystemBanner
          tone="info"
          title="Workspace onboarding"
          description="Learn lifecycle stages, ownership, and how to interpret preview and health states."
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <h2 className="text-title-s text-ink">Workspace identity</h2>
            <div className="mt-4 space-y-3">
              <Input defaultValue="DEVteam Studio" aria-label="Workspace name" />
              <Textarea rows={4} defaultValue="Software production studio for multi-agent delivery" aria-label="Workspace description" />
            </div>
          </Card>

          <Card>
            <h2 className="text-title-s text-ink">Defaults</h2>
            <div className="mt-4 space-y-3 text-body-s text-secondary">
              <p>Default stack: Next.js + Fastify + PostgreSQL</p>
              <p>Region: eu-north-1</p>
              <p>Approval policy: required for production deploys</p>
            </div>
          </Card>
        </div>

        <SetupStepper />
      </div>
    </AppShell>
  );
}
