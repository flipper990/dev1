import type { GeneratedProject } from '../../../../types/dashboard';
import { Card } from '../../../../components/ui';

interface TrustRailProps {
  project: GeneratedProject | null;
  selectedProjectId: string | null;
}

function formatDate(value: string | undefined | null) {
  if (!value) return 'Not available';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not available';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

export function TrustRail({ project, selectedProjectId }: TrustRailProps) {
  const syncedAt = project?.preview?.previewReadyAt ?? project?.completedAt ?? project?.createdAt;
  const exportReady = project?.status === 'generated';
  const productionReady = project?.verificationStatus === 'passed';

  return (
    <div className="space-y-4">
      <Card>
        <p className="text-label-s uppercase tracking-[0.16em] text-text-muted">Trust and ownership</p>
        <h3 className="mt-2 text-title-s text-text-primary">You own the generated source.</h3>
        <ul className="mt-4 space-y-2 text-body-s text-text-secondary">
          <li>{exportReady ? 'Source package can be exported from this project.' : 'Source export becomes available after code generation finishes.'}</li>
          <li>{productionReady ? 'Verification passed: readiness evidence is green.' : 'Verification has not fully passed yet; do not treat as production-ready.'}</li>
          <li>No proprietary runtime lock-in.</li>
          <li>Preview and lifecycle statuses are summarized in the workspace header and preview frame.</li>
        </ul>
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
