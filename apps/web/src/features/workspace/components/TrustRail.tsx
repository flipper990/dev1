import type { GeneratedProject } from '../../../../types/dashboard';
import { Card, StatusDot } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../../projects/model';
import { derivePreviewTruth, previewToneToStatusDot } from '../../preview/model';

interface TrustRailProps {
  project: GeneratedProject | null;
  selectedProjectId: string | null;
  status: UnifiedProjectStatus;
}

function formatDate(value: string | undefined | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function TrustRail({ project, selectedProjectId, status }: TrustRailProps) {
  const syncedAt = project?.preview?.previewReadyAt ?? project?.completedAt ?? project?.createdAt;
  const previewTruth = derivePreviewTruth(project);
  const exportReady = project?.status === 'completed';

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-label-s uppercase tracking-[0.16em] text-text-muted">Trust and ownership</p>
        <h3 className="mt-2 text-title-s text-text-primary">You own the generated source.</h3>
        <div className="mt-4 space-y-2">
          <StatusDot tone={exportReady ? 'success' : project ? 'warning' : 'neutral'} label={exportReady ? 'Exportable source package' : 'Export waits for completed source'} />
          <StatusDot tone="success" label="No proprietary runtime lock-in" />
          <StatusDot tone={previewToneToStatusDot(previewTruth.tone)} label={`Preview evidence: ${previewTruth.label}`} />
          <StatusDot tone={status.healthy ? 'success' : 'warning'} label={`Unified status: ${status.label}`} />
        </div>
      </Card>

      <Card>
        <h3 className="text-title-s text-text-primary">Artifact identity</h3>
        <dl className="mt-4 space-y-3 text-body-s text-text-secondary">
          <div>
            <dt className="text-label-s text-text-muted">projectId</dt>
            <dd className="mt-1 break-all font-mono text-mono-s text-text-primary">{selectedProjectId ?? 'No project selected'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Stack mode</dt>
            <dd className="text-text-primary">{project?.stackSelectionMode ?? 'auto'}</dd>
          </div>
          <div className="flex items-center justify-between gap-3">
            <dt>Last evidence sync</dt>
            <dd className="text-text-primary">{formatDate(syncedAt)}</dd>
          </div>
        </dl>
      </Card>
    </div>
  );
}
