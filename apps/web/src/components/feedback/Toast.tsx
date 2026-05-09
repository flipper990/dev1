import { AlertCircle, AlertTriangle, CheckCircle2, Info, Loader2 } from 'lucide-react';
import { cn } from '../../../lib/cn';

export type ToastTone = 'info' | 'success' | 'warning' | 'error' | 'retrying';

interface ToastProps {
  tone?: ToastTone;
  title: string;
  message?: string;
  reducedMotion?: boolean;
}

const toneMeta: Record<ToastTone, { cls: string; Icon: typeof Info }> = {
  info: { cls: 'border-status-info bg-status-info-subtle text-status-info', Icon: Info },
  success: { cls: 'border-status-success bg-status-success-subtle text-status-success', Icon: CheckCircle2 },
  warning: { cls: 'border-status-warning bg-status-warning-subtle text-status-warning', Icon: AlertTriangle },
  error: { cls: 'border-status-error bg-status-error-subtle text-status-error', Icon: AlertCircle },
  retrying: { cls: 'border-brand-primary bg-brand-primary-subtle text-brand-primary', Icon: Loader2 },
};

export function Toast({ tone = 'info', title, message, reducedMotion = false }: ToastProps) {
  const { cls, Icon } = toneMeta[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn('w-full max-w-[360px] rounded-[var(--radius-panel)] border p-3 shadow-md', tone === 'retrying' && !reducedMotion ? 'animate-pulse' : '', cls)}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'retrying' && !reducedMotion ? 'animate-spin motion-reduce:animate-none' : '')}
          aria-hidden="true"
        />
        <div>
          <p className="text-label-m text-text-primary">{title}</p>
          {message ? <p className="mt-1 text-body-s text-text-secondary">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}
