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
  compact?: boolean;
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
  compact = false,
  className,
}: PageHeaderProps) {
  return (
    <header className={cn(compact ? 'space-y-3 border-b border-border-muted pb-4' : 'space-y-5 border-b border-border-muted pb-7 sm:pb-8', className)}>
      {breadcrumbs ? <Breadcrumbs items={breadcrumbs} /> : null}

      <div className={cn('flex flex-col xl:flex-row xl:items-start xl:justify-between', compact ? 'gap-3' : 'gap-5')}>
        <div className={cn('min-w-0', compact ? 'space-y-1.5' : 'space-y-2.5')}>
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 className={cn('font-semibold text-text-primary', compact ? 'text-title-s' : 'text-title-l')}>{title}</h1>
            {lifecycle ? <Badge variant={lifecycleToneVariant[lifecycle.tone ?? 'neutral']}>{lifecycle.label}</Badge> : null}
          </div>
          {subtitle ? <p className={cn('max-w-[88ch] text-body-s text-text-secondary', compact ? 'leading-5' : 'leading-6')}>{subtitle}</p> : null}
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
