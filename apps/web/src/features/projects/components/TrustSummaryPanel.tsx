import { Card, StatusDot } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../model/project-status';

interface TrustSummaryPanelProps {
  status: UnifiedProjectStatus;
  stale?: boolean;
  buildVersion?: string;
  syncedAt?: string;
}

export function TrustSummaryPanel({
  status,
  stale = false,
  buildVersion = 'v1.0.0',
  syncedAt,
}: TrustSummaryPanelProps) {
  return (
    <Card>
      <h3 className="text-title-s text-text-primary">Trust summary</h3>
      <div className="mt-3 space-y-2">
        <StatusDot tone={status.healthy ? 'success' : 'warning'} label={`Status: ${status.label}`} />
        <StatusDot tone={stale ? 'warning' : 'neutral'} label={stale ? 'Out-of-sync detected' : 'Evidence in sync'} />
      </div>
      <dl className="mt-4 space-y-2 text-body-s text-text-secondary">
        <div className="flex items-center justify-between gap-3"><dt>Build version</dt><dd className="text-text-primary">{buildVersion}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt>Last sync</dt><dd className="text-text-primary">{syncedAt ?? 'Just now'}</dd></div>
      </dl>
    </Card>
  );
}
