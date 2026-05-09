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
    <header className={cn('flex flex-col gap-4 border-b border-border/80 pb-5 sm:pb-6', className)}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-title-l font-semibold tracking-[-0.01em] text-ink">{title}</h1>
            {lifecycle ? (
              <span
                className={cn(
                  'inline-flex items-center rounded-[var(--radius-control)] border px-2 py-1 text-label-s',
                  lifecycleToneClass[lifecycle.tone ?? 'neutral'],
                )}
              >
                {lifecycle.label}
              </span>
            ) : null}
          </div>
          {subtitle ? <p className="max-w-[76ch] text-body-s leading-6 text-secondary">{subtitle}</p> : null}
        </div>

        <div className="flex flex-wrap items-center gap-2.5 lg:justify-end">
          {secondaryActions}
          {actions}
        </div>
      </div>
    </header>
  );
}
