import Link from 'next/link';
import { AppShell } from '../../src/components/shell';
import { Button, Card, Input, Panel, Textarea } from '../../components/ui';
import { SetupStepper } from '../../src/features/settings/components';
import { InlineStatusPanel, SystemBanner } from '../../src/components/feedback';

export default function SettingsPage() {
  return (
    <AppShell
      title="Settings"
      subtitle="Workspace-wide defaults and operating policies."
      lifecycle={{ label: 'Settings API missing', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Settings' }]}
      actions={<Link href="/docs/getting-started"><Button variant="secondary">Open setup docs</Button></Link>}
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
          description="Workspace settings require a backend persistence contract. The form is shown as a planned shape only, and save/discard actions are intentionally unavailable."
        />

        <InlineStatusPanel
          tone="warning"
          title="Save and discard require settings persistence"
          where="Workspace identity, defaults, approval policy, and region preferences"
          whatWorked="The onboarding checklist and documentation links remain available without pretending changes are saved."
          whatFailed="No workspace settings read/write endpoint is connected."
          nextAction="Add a settings API contract before enabling mutable workspace policy controls."
          actions={<Link href="/overview"><Button variant="secondary" size="sm">Return to overview</Button></Link>}
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
