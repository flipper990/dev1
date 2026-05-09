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

export function EmptyState({ title, description, action, icon, className }: EmptyStateProps) {
  return (
    <div
      className={cn(
        'rounded-[var(--radius-panel)] border border-dashed border-border bg-surface-base px-6 py-10 text-center sm:px-8',
        className,
      )}
    >
      <div className="mx-auto inline-grid h-12 w-12 place-items-center rounded-full border border-border-muted bg-surface-raised text-text-muted shadow-hairline">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <h3 className="mt-4 text-title-s font-semibold text-text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-[52ch] text-body-s leading-6 text-text-secondary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
