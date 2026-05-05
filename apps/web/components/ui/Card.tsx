import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** Adds a hover gold-glow treatment. */
  interactive?: boolean;
  /** Forces the gold-bordered "active" treatment. */
  highlight?: boolean;
  padded?: boolean;
}

/**
 * Editorial card primitive — rounded-2xl, subtle inner highlight, hairline border
 * that warms to gold on hover when `interactive`.
 */
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
        'cn-card',
        interactive && 'cn-card--hover',
        highlight && 'cn-card--gold',
        padded && 'p-5',
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
    <div className={cn('flex items-center justify-between mb-4', className)}>
      <div className="cn-card__title-eyebrow">
        {icon}
        <span>{children}</span>
      </div>
      {action}
    </div>
  );
}
