import type { ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import { Breadcrumbs, type BreadcrumbItem } from './Breadcrumbs';

export type LifecycleTone = 'neutral' | 'success' | 'warning' | 'error' | 'active';

interface LifecycleState {
  label: string;
  tone?: LifecycleTone;
}

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  lifecycle?: LifecycleState;
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  className?: string;
}

const lifecycleToneClass: Record<LifecycleTone, string> = {
  neutral: 'border-border bg-surface-tint text-secondary',
  success: 'border-success/35 bg-feedback-success-subtle text-success',
  warning: 'border-warning/35 bg-feedback-warning-subtle text-warning',
  error: 'border-error/35 bg-feedback-error-subtle text-error',
  active: 'border-primary/35 bg-primary-subtle text-primary',
};

export function PageHeader({
  title,
  subtitle,
  lifecycle,
  actions,
  secondaryActions,
  breadcrumbs,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn('space-y-5 border-b border-border/70 pb-7 sm:pb-8', className)}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-title-l font-semibold tracking-[-0.015em] text-ink">{title}</h1>
            {lifecycle ? (
              <span
                className={cn(
                  'inline-flex items-center rounded-[var(--radius-control)] border px-2.5 py-1 text-label-s',
                  lifecycleToneClass[lifecycle.tone ?? 'neutral'],
                )}
              >
                {lifecycle.label}
              </span>
            ) : null}
          </div>
          {subtitle ? (
            <p className="max-w-[88ch] text-body-s leading-6 text-secondary">{subtitle}</p>
          ) : null}
        </div>

        {(secondaryActions || actions) ? (
          <div className="flex flex-wrap items-center gap-2.5 xl:justify-end">
            {secondaryActions ? <div className="flex flex-wrap items-center gap-2">{secondaryActions}</div> : null}
            {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
          </div>
        ) : null}
      </div>
    </header>
  );
}
