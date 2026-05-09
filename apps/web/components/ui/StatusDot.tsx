import type { HTMLAttributes } from 'react';
import { Check, CircleDashed, Info, Minus, X } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  getStatusPresentation,
  mapProductToneToDotTone,
  type DotTone,
  type ProductStatusKey,
} from './statusPresentation';

export type StatusTone = DotTone;

interface StatusDotProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: StatusTone;
  statusKey?: ProductStatusKey;
  label?: string;
}

const statusMeta: Record<StatusTone, { cls: string; Icon: typeof Check; defaultLabel: string }> = {
  neutral: { cls: 'bg-surface-tint text-secondary', Icon: Minus, defaultLabel: 'Idle' },
  info: { cls: 'bg-feedback-info-subtle text-info', Icon: Info, defaultLabel: 'Info' },
  active: { cls: 'bg-feedback-info-subtle text-primary', Icon: CircleDashed, defaultLabel: 'Active' },
  success: { cls: 'bg-feedback-success-subtle text-success', Icon: Check, defaultLabel: 'Success' },
  warning: { cls: 'bg-feedback-warning-subtle text-warning', Icon: Minus, defaultLabel: 'Warning' },
  error: { cls: 'bg-feedback-error-subtle text-error', Icon: X, defaultLabel: 'Error' },
};

export function StatusDot({ tone = 'neutral', statusKey, label, className, ...props }: StatusDotProps) {
  const mappedTone = statusKey
    ? mapProductToneToDotTone(getStatusPresentation(statusKey).tone)
    : tone;
  const { cls, Icon, defaultLabel } = statusMeta[mappedTone];
  const text = label ?? (statusKey ? getStatusPresentation(statusKey).label : defaultLabel);

  return (
    <span className={cn('inline-flex items-center gap-2 text-label-s text-secondary', className)} {...props}>
      <span
        aria-hidden="true"
        className={cn(
          'inline-grid h-5 w-5 place-items-center rounded-full border border-current/30',
          cls,
        )}
      >
        <Icon className="h-3 w-3" />
      </span>
      <span>{text}</span>
    </span>
  );
}
