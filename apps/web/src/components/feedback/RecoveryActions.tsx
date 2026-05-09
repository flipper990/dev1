import { Button } from '../../../components/ui';

interface RecoveryActionsProps {
  primaryLabel?: string;
  secondaryLabel?: string;
  tertiaryLabel?: string;
  retrying?: boolean;
  onPrimary?: () => void;
  onSecondary?: () => void;
  onTertiary?: () => void;
}

export function RecoveryActions({
  primaryLabel = 'Retry',
  secondaryLabel = 'View logs',
  tertiaryLabel = 'Open diagnostics',
  retrying = false,
  onPrimary,
  onSecondary,
  onTertiary,
}: RecoveryActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Recovery actions">
      <Button loading={retrying} onClick={onPrimary} disabled={!onPrimary} title={!onPrimary ? 'Retry action is not available on this surface.' : undefined}>
        {retrying ? 'Retrying' : primaryLabel}
      </Button>
      <Button variant="secondary" onClick={onSecondary} disabled={!onSecondary} title={!onSecondary ? 'Logs action is not available on this surface.' : undefined}>
        {secondaryLabel}
      </Button>
      <Button variant="ghost" onClick={onTertiary} disabled={!onTertiary} title={!onTertiary ? 'Diagnostics action is not available on this surface.' : undefined}>
        {tertiaryLabel}
      </Button>
    </div>
  );
}
