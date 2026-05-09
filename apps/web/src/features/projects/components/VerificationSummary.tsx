import { Card, StatusDot } from '../../../../components/ui';

interface VerificationSummaryProps {
  runtimeStatus?: 'pending' | 'passed' | 'failed';
  qaStatus?: 'pending' | 'passed' | 'failed';
  securityStatus?: 'pending' | 'passed' | 'failed';
}

function tone(status: 'pending' | 'passed' | 'failed'): 'neutral' | 'success' | 'error' {
  if (status === 'passed') return 'success';
  if (status === 'failed') return 'error';
  return 'neutral';
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
      <div className="mt-4 space-y-2">
        <StatusDot tone={tone(runtimeStatus)} label={`Runtime checks: ${runtimeStatus}`} />
        <StatusDot tone={tone(qaStatus)} label={`Quality checks: ${qaStatus}`} />
        <StatusDot tone={tone(securityStatus)} label={`Security checks: ${securityStatus}`} />
      </div>
    </Card>
  );
}
