import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface PanelProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function Panel({ title, subtitle, actions, className, children, ...props }: PanelProps) {
  return (
    <section {...props} className={cn('rounded-[var(--radius-panel)] border border-border bg-surface-raised shadow-card', className)}>
      {(title || subtitle || actions) && (
        <header className="flex items-start justify-between gap-4 border-b border-border-muted px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="text-title-s text-text-primary">{title}</h3>}
            {subtitle && <p className="mt-1 text-body-s text-text-secondary">{subtitle}</p>}
          </div>
          {actions && <div className="shrink-0">{actions}</div>}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}
