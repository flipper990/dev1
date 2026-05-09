import { AppShell } from '../../src/components/shell';
import { Button, Card, Input, Panel, Textarea } from '../../components/ui';
import { SetupStepper } from '../../src/features/settings/components';
import { SystemBanner } from '../../src/components/feedback';

export default function SettingsPage() {
  return (
    <AppShell
      title="Settings"
      subtitle="Workspace-wide defaults and operating policies."
      lifecycle={{ label: 'Settings API missing', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Settings' }]}
      actions={<Button disabled title="Settings cannot be saved because no workspace settings endpoint exists">Save unavailable</Button>}
      secondaryActions={<Button variant="secondary" disabled title="There is no persisted settings draft to discard">Discard unavailable</Button>}
      contextTitle="Settings contract"
      contextDescription="Administrative persistence is disabled until backend contracts exist."
      contextContent={
        <Panel title="Persistence unavailable" subtitle="No workspace settings endpoint was found">
          <p className="text-body-s text-text-secondary">
            The fields on this page are read-only examples of the settings shape. Saving is disabled to avoid pretending workspace policy changes are persisted.
          </p>
        </Panel>
      }
      workspaceName="DEVteam Studio"
    >
      <div className="space-y-4">
        <SystemBanner
          tone="warning"
          title="Settings are read-only"
          description="Workspace settings require a backend persistence contract. Actions are disabled until that endpoint exists."
        />

        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <h2 className="text-title-s text-text-primary">Workspace identity</h2>
            <div className="mt-4 space-y-3">
              <Input defaultValue="DEVteam Studio" aria-label="Workspace name" disabled />
              <Textarea rows={4} defaultValue="Software production studio for multi-agent delivery" aria-label="Workspace description" disabled />
            </div>
          </Card>

          <Card>
            <h2 className="text-title-s text-text-primary">Defaults</h2>
            <div className="mt-4 space-y-3 text-body-s text-text-secondary">
              <p>Default stack: requires settings API</p>
              <p>Region: requires settings API</p>
              <p>Approval policy: requires settings API</p>
            </div>
          </Card>
        </div>

        <SetupStepper />
      </div>
    </AppShell>
  );
}
