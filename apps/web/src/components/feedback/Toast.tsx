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
  info: { cls: 'border-primary/35 bg-primary-subtle text-primary', Icon: Info },
  success: { cls: 'border-success/35 bg-feedback-success-subtle text-success', Icon: CheckCircle2 },
  warning: { cls: 'border-warning/35 bg-feedback-warning-subtle text-warning', Icon: AlertTriangle },
  error: { cls: 'border-error/35 bg-feedback-error-subtle text-error', Icon: AlertCircle },
  retrying: { cls: 'border-primary/35 bg-primary-subtle text-primary', Icon: Loader2 },
};

export function Toast({ tone = 'info', title, message, reducedMotion = false }: ToastProps) {
  const { cls, Icon } = toneMeta[tone];

  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      aria-live={tone === 'error' ? 'assertive' : 'polite'}
      className={cn(
        'w-full max-w-[360px] rounded-[var(--radius-panel)] border p-3 shadow-md',
        tone === 'retrying' && !reducedMotion ? 'animate-pulse' : '',
        cls,
      )}
    >
      <div className="flex items-start gap-2">
        <Icon
          className={cn(
            'mt-0.5 h-4 w-4 shrink-0',
            tone === 'retrying' && !reducedMotion ? 'animate-spin motion-reduce:animate-none' : '',
          )}
          aria-hidden="true"
        />
        <div>
          <p className="text-label-m text-ink">{title}</p>
          {message ? <p className="mt-1 text-body-s text-secondary">{message}</p> : null}
        </div>
      </div>
    </div>
  );
}
