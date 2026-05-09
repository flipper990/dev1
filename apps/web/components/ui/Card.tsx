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
        'transition-[background-color,border-color,box-shadow,transform] duration-200 ease-out',
        interactive &&
          'cursor-pointer hover:-translate-y-px hover:border-border-strong hover:bg-surface-tint hover:shadow-[0_14px_34px_rgba(2,6,23,0.12)]',
        highlight &&
          'border-primary bg-[color:color-mix(in_srgb,var(--color-primary)_8%,var(--color-surface-raised))] shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-primary)_24%,transparent),0_10px_28px_rgba(15,23,42,0.12)]',
        padded ? 'p-5 sm:p-6' : 'p-0',
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
    <div className={cn('mb-4 flex items-start justify-between gap-3', className)}>
      <div className="inline-flex min-w-0 items-center gap-2 text-label-m font-semibold text-ink">
        {icon}
        <span className="truncate">{children}</span>
      </div>
      {action}
    </div>
  );
}
