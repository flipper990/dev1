import type { ReactNode } from 'react';
import { Badge, type BadgeVariant } from '../../../components/ui';
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

const lifecycleToneVariant: Record<LifecycleTone, BadgeVariant> = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  error: 'error',
  active: 'active',
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
    <header className={cn('space-y-5 border-b border-border-muted pb-7 sm:pb-8', className)}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-2.5">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className="text-title-l font-semibold text-text-primary">{title}</h1>
            {lifecycle ? <Badge variant={lifecycleToneVariant[lifecycle.tone ?? 'neutral']}>{lifecycle.label}</Badge> : null}
          </div>
          {subtitle ? <p className="max-w-[88ch] text-body-s leading-6 text-text-secondary">{subtitle}</p> : null}
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
