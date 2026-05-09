import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
  highlight?: boolean;
  padded?: boolean;
}

export function Card({
  children,
  interactive,
  highlight,
  padded = true,
  className,
  ...rest
}: CardProps) {
  return (
    <div
      {...rest}
      className={cn(
        'rounded-[var(--radius-panel)] border border-border bg-surface-raised text-ink shadow-card',
        interactive && 'transition-colors duration-160 hover:bg-surface-tint',
        highlight &&
          'border-primary bg-[color:color-mix(in_srgb,var(--color-primary)_6%,var(--color-surface-raised))]',
        padded && 'p-6',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function CardTitle({
  children,
  icon,
  action,
  className,
}: {
  children: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('mb-4 flex items-center justify-between', className)}>
      <div className="inline-flex items-center gap-2 text-label-m font-semibold text-ink">
        {icon}
        <span>{children}</span>
      </div>
      {action}
    </div>
  );
}
