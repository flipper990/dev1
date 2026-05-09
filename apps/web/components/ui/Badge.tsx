import type { HTMLAttributes, ReactNode } from 'react';
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react';
import { cn } from '../../lib/cn';
import {
  mapProductToneToBadgeTone,
  type BadgeTone,
  type ProductStatusKey,
  getStatusPresentation,
} from './statusPresentation';

export type BadgeVariant = BadgeTone;

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  statusKey?: ProductStatusKey;
}

const variantClasses: Record<BadgeVariant, { cls: string; icon: ReactNode }> = {
  neutral: {
    cls: 'border-outline-subtle bg-surface-tint text-ink',
    icon: <Info className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  info: {
    cls: 'border-primary/35 bg-feedback-info-subtle text-info',
    icon: <Info className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  active: {
    cls: 'border-primary/35 bg-feedback-info-subtle text-primary',
    icon: <Info className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  success: {
    cls: 'border-success/35 bg-feedback-success-subtle text-success',
    icon: <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  warning: {
    cls: 'border-warning/35 bg-feedback-warning-subtle text-warning',
    icon: <AlertTriangle className="h-3.5 w-3.5" aria-hidden="true" />,
  },
  error: {
    cls: 'border-error/35 bg-feedback-error-subtle text-error',
    icon: <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />,
  },
};

export function Badge({ variant = 'neutral', statusKey, className, children, ...props }: BadgeProps) {
  const computedVariant = statusKey
    ? mapProductToneToBadgeTone(getStatusPresentation(statusKey).tone)
    : variant;
  const meta = variantClasses[computedVariant];
  const text = statusKey ? getStatusPresentation(statusKey).label : children;

  return (
    <span
      {...props}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border px-2 py-1 text-label-s font-semibold',
        meta.cls,
        className,
      )}
    >
      {meta.icon}
      {text}
    </span>
  );
}
