import type { ReactNode } from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '../../lib/cn';

interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
  icon?: ReactNode;
  className?: string;
}

export function EmptyState({
  title,
  description,
  action,
  icon,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-panel)] border border-dashed border-border bg-surface-tint px-6 py-8 text-center',
        className,
      )}
    >
      <div className="mx-auto inline-grid h-11 w-11 place-items-center rounded-full bg-surface-raised text-secondary">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <h3 className="mt-3 text-title-s text-ink">{title}</h3>
      <p className="mx-auto mt-2 max-w-[46ch] text-body-s text-secondary">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
