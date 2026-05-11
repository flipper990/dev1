import { Card } from '../../../../components/ui';
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
      <p className="mt-1 text-body-s text-text-secondary">Lifecycle status is owned by the page header. This panel keeps audit metadata only.</p>
      <dl className="mt-4 space-y-2 text-body-s text-text-secondary">
        <div className="flex items-center justify-between gap-3"><dt>Lifecycle</dt><dd className="text-text-primary">{status.label}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt>Evidence sync</dt><dd className="text-text-primary">{stale ? 'Review required' : 'In sync'}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt>Build version</dt><dd className="text-text-primary">{buildVersion}</dd></div>
        <div className="flex items-center justify-between gap-3"><dt>Last sync</dt><dd className="text-text-primary">{syncedAt ?? 'Just now'}</dd></div>
      </dl>
    </Card>
  );
}
