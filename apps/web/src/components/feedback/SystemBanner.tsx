import type { ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../../../lib/cn';

export type BannerTone = 'info' | 'success' | 'warning' | 'error';

interface SystemBannerProps {
  tone?: BannerTone;
  title: string;
  description?: string;
  actions?: ReactNode;
  className?: string;
}

const toneStyles: Record<BannerTone, { wrapper: string; Icon: typeof Info; liveRole: 'status' | 'alert' }> = {
  info: {
    wrapper: 'border-status-info bg-status-info-subtle text-status-info',
    Icon: Info,
    liveRole: 'status',
  },
  success: {
    wrapper: 'border-status-success bg-status-success-subtle text-status-success',
    Icon: CheckCircle2,
    liveRole: 'status',
  },
  warning: {
    wrapper: 'border-status-warning bg-status-warning-subtle text-status-warning',
    Icon: AlertTriangle,
    liveRole: 'status',
  },
  error: {
    wrapper: 'border-status-error bg-status-error-subtle text-status-error',
    Icon: AlertCircle,
    liveRole: 'alert',
  },
};

export function SystemBanner({
  tone = 'info',
  title,
  description,
  actions,
  className,
}: SystemBannerProps) {
  const { wrapper, Icon, liveRole } = toneStyles[tone];

  return (
    <section
      role={liveRole}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn('rounded-[var(--radius-panel)] border p-4', wrapper, className)}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-start gap-2">
          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <div>
            <h3 className="text-label-m text-text-primary">{title}</h3>
            {description ? <p className="mt-1 text-body-s text-text-secondary">{description}</p> : null}
          </div>
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </div>
    </section>
  );
}
