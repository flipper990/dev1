import { Card } from '../../../../components/ui';

interface BuildEvidencePanelProps {
  pipelineStep?: string;
  checksPassed?: number;
  checksTotal?: number;
  runtimeMs?: number;
  costUsd?: number;
}

export function BuildEvidencePanel({
  pipelineStep = 'Compile and static checks',
  checksPassed = 0,
  checksTotal = 0,
  runtimeMs = 0,
  costUsd = 0,
}: BuildEvidencePanelProps) {
  const checksHealthy = checksTotal > 0 && checksPassed === checksTotal;

  return (
    <Card>
      <h3 className="text-title-s text-text-primary">Build evidence</h3>
      <p className="mt-1 text-body-s text-text-secondary">Concrete proof of build quality and runtime behavior.</p>
      <dl className="mt-4 grid gap-2 text-body-s text-text-secondary sm:grid-cols-2">
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
          <dt>Checks</dt>
          <dd className="mt-1 text-text-primary">{checksPassed}/{checksTotal} passed{checksHealthy ? '' : ' so far'}</dd>
        </div>
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
          <dt>Current step</dt>
          <dd className="mt-1 text-text-primary">{pipelineStep}</dd>
        </div>
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
          <dt>Runtime</dt>
          <dd className="mt-1 text-text-primary">{Math.round(runtimeMs / 1000)}s</dd>
        </div>
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
          <dt>Cost</dt>
          <dd className="mt-1 text-text-primary">${costUsd.toFixed(2)}</dd>
        </div>
      </dl>
    </Card>
  );
}
