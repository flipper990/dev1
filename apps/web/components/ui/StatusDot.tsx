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
  neutral: { cls: 'border-border bg-surface-tint text-text-muted', Icon: Minus, defaultLabel: 'Idle' },
  info: { cls: 'border-status-info bg-status-info-subtle text-status-info', Icon: Info, defaultLabel: 'Info' },
  active: { cls: 'border-brand-primary bg-brand-primary-subtle text-brand-primary', Icon: CircleDashed, defaultLabel: 'Active' },
  success: { cls: 'border-status-success bg-status-success-subtle text-status-success', Icon: Check, defaultLabel: 'Success' },
  warning: { cls: 'border-status-warning bg-status-warning-subtle text-status-warning', Icon: Minus, defaultLabel: 'Warning' },
  error: { cls: 'border-status-error bg-status-error-subtle text-status-error', Icon: X, defaultLabel: 'Error' },
};

export function StatusDot({ tone = 'neutral', statusKey, label, className, ...props }: StatusDotProps) {
  const mappedTone = statusKey ? mapProductToneToDotTone(getStatusPresentation(statusKey).tone) : tone;
  const { cls, Icon, defaultLabel } = statusMeta[mappedTone];
  const text = label ?? (statusKey ? getStatusPresentation(statusKey).label : defaultLabel);

  return (
    <span className={cn('inline-flex items-center gap-2 text-label-s text-text-secondary', className)} {...props}>
      <span aria-hidden="true" className={cn('inline-grid h-5 w-5 place-items-center rounded-full border', cls)}>
        <Icon className="h-3 w-3" />
      </span>
      <span>{text}</span>
    </span>
  );
}
