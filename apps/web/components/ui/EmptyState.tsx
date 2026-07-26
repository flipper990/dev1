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
        'studio-enter rounded-[var(--radius-panel)] border border-dashed border-border-muted bg-surface-base px-6 py-12 text-center sm:px-8',
        className,
      )}
    >
      <div aria-hidden="true" className="mx-auto inline-grid h-11 w-11 place-items-center rounded-[var(--radius-card)] border border-border-muted bg-surface-raised text-text-muted">
        {icon ?? <Inbox className="h-5 w-5" aria-hidden="true" />}
      </div>
      <h3 className="mt-4 text-title-s font-semibold text-text-primary">{title}</h3>
      <p className="mx-auto mt-2 max-w-[52ch] text-body-s leading-6 text-text-secondary">{description}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  );
}
