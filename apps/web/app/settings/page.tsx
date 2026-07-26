import { AppShell } from '../../src/components/shell';
import { Badge } from '../../components/ui';
import { EnterpriseControlCenter } from '../../src/features/settings/components/EnterpriseControlCenter';

export default function SettingsPage() {
  return (
    <AppShell
      title="Enterprise controls"
      subtitle="Design organization access, protected delivery, approvals, and environment policy."
      lifecycle={{ label: 'Architecture mode', tone: 'warning' }}
      breadcrumbs={[{ label: 'Workspace', href: '/overview' }, { label: 'Enterprise controls' }]}
      actions={<Badge variant="warning">UI policy draft</Badge>}
      contextTitle="Enforcement boundary"
      contextDescription="Identity providers and server-side policy enforcement are intentionally out of scope."
      contextContent={
        <div className="space-y-3 text-body-s text-text-secondary">
          <p>Current API authorization remains the existing owner, admin, member, and viewer hierarchy.</p>
          <p>These controls define the normalized organization, team, RBAC, approval, protection, environment, and audit architecture that a future policy service will persist and enforce.</p>
        </div>
      }
      workspaceName="DEVteam Studio"
    >
      <EnterpriseControlCenter />
    </AppShell>
  );
}
