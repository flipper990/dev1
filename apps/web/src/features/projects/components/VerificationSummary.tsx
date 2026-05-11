import { Card } from '../../../../components/ui';

interface VerificationSummaryProps {
  runtimeStatus?: 'pending' | 'passed' | 'failed';
  qaStatus?: 'pending' | 'passed' | 'failed';
  securityStatus?: 'pending' | 'passed' | 'failed';
}

export function VerificationSummary({
  runtimeStatus = 'pending',
  qaStatus = 'pending',
  securityStatus = 'pending',
}: VerificationSummaryProps) {
  return (
    <Card>
      <h3 className="text-title-s text-text-primary">Verification summary</h3>
      <p className="mt-1 text-body-s text-text-secondary">Evidence checks required before launch.</p>
      <dl className="mt-4 grid gap-2 text-body-s text-text-secondary sm:grid-cols-3">
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3"><dt>Runtime checks</dt><dd className="mt-1 text-text-primary">{runtimeStatus}</dd></div>
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3"><dt>Quality checks</dt><dd className="mt-1 text-text-primary">{qaStatus}</dd></div>
        <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3"><dt>Security checks</dt><dd className="mt-1 text-text-primary">{securityStatus}</dd></div>
      </dl>
    </Card>
  );
}
