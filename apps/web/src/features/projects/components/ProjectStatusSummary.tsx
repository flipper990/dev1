import { Badge, Card, StatusDot } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../model/project-status';

interface ProjectStatusSummaryProps {
  status: UnifiedProjectStatus;
  buildHealthy: boolean;
  previewHealthy: boolean;
  verificationHealthy: boolean;
  stale?: boolean;
}

export function ProjectStatusSummary({
  status,
  buildHealthy,
  previewHealthy,
  verificationHealthy,
  stale = false,
}: ProjectStatusSummaryProps) {
  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-title-s text-ink">Unified project status</h3>
            <p className="mt-1 text-body-s text-secondary">One state model for build, preview, and verification.</p>
          </div>
          <Badge statusKey={status.key} variant={status.healthy ? 'success' : stale ? 'warning' : 'error'}>
            {status.label}
          </Badge>
        </div>

        <dl className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
            <dt className="text-label-s text-secondary">Build</dt>
            <dd className="mt-1"><StatusDot tone={buildHealthy ? 'success' : 'warning'} label={buildHealthy ? 'Healthy' : 'Attention needed'} /></dd>
          </div>
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
            <dt className="text-label-s text-secondary">Preview</dt>
            <dd className="mt-1"><StatusDot tone={previewHealthy ? 'success' : 'warning'} label={previewHealthy ? 'Ready' : 'Not ready'} /></dd>
          </div>
          <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
            <dt className="text-label-s text-secondary">Verification</dt>
            <dd className="mt-1"><StatusDot tone={verificationHealthy ? 'success' : 'neutral'} label={verificationHealthy ? 'Passed' : 'Pending'} /></dd>
          </div>
        </dl>
      </div>
    </Card>
  );
}
