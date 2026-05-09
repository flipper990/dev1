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
      <Button loading={retrying} onClick={onPrimary}>
        {retrying ? 'Retrying' : primaryLabel}
      </Button>
      <Button variant="secondary" onClick={onSecondary}>
        {secondaryLabel}
      </Button>
      <Button variant="ghost" onClick={onTertiary}>
        {tertiaryLabel}
      </Button>
    </div>
  );
}
