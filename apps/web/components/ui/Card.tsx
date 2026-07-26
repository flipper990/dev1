import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  interactive?: boolean;
  highlight?: boolean;
  padded?: boolean;
}

export function Card({ children, interactive, highlight, padded = true, className, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={cn(
        'rounded-[var(--radius-card)] border border-border-muted bg-surface-base text-text-primary',
        'transition-[background-color,border-color,box-shadow,transform] duration-160 ease-ledger',
        interactive && 'cursor-pointer hover:-translate-y-px hover:border-border-strong hover:bg-surface-raised hover:shadow-md',
        highlight && 'border-brand-primary/55 bg-brand-primary-subtle',
        padded ? 'p-4 sm:p-5' : 'p-0',
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
      <div className="inline-flex min-w-0 items-center gap-2 text-label-m font-semibold text-text-primary">
        {icon}
        <span className="truncate">{children}</span>
      </div>
      {action}
    </div>
  );
}
