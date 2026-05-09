import { Button, Card } from '../../../../components/ui';
import { RecoveryActions } from '../../../components/feedback/RecoveryActions';

interface SyncWarningPanelProps {
  onRefresh?: () => void;
  onInspect?: () => void;
  retrying?: boolean;
}

export function SyncWarningPanel({ onRefresh, onInspect, retrying = false }: SyncWarningPanelProps) {
  return (
    <Card>
      <h3 className="text-title-s text-text-primary">State out of sync</h3>
      <p className="mt-1 text-body-s text-text-secondary">
        We detected conflicting state signals. Build evidence remains intact, but status needs reconciliation.
      </p>
      <div className="mt-4 rounded-[var(--radius-control)] border border-status-warning bg-status-warning-subtle p-3 text-body-s text-status-warning">
        Refresh status to align project, preview, and verification outcomes.
      </div>
      <div className="mt-4">
        <RecoveryActions
          retrying={retrying}
          primaryLabel="Refresh state"
          secondaryLabel="View evidence"
          tertiaryLabel="Open diagnostics"
          onPrimary={onRefresh}
          onSecondary={onInspect}
          onTertiary={onInspect}
        />
      </div>
      <div className="mt-3">
        <Button
          variant="ghost"
          onClick={onInspect}
          disabled={!onInspect}
          title={!onInspect ? 'Diagnostics are unavailable on this surface. Open the workspace logs for details.' : undefined}
        >
          {onInspect ? 'What is out of sync?' : 'Diagnostics unavailable'}
        </Button>
      </div>
    </Card>
  );
}
