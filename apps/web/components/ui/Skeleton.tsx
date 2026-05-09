import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function Skeleton({ className, lines = 1, ...props }: SkeletonProps) {
  if (lines <= 1) {
    return <div {...props} className={cn('h-4 w-full rounded-[var(--radius-control)] bg-surface-tint motion-safe:animate-pulse', className)} />;
  }

  return (
    <div className={cn('space-y-2', className)} {...props}>
      {Array.from({ length: lines }).map((_, idx) => (
        <div
          key={idx}
          className={cn(
            'h-4 rounded-[var(--radius-control)] bg-surface-tint motion-safe:animate-pulse',
            idx === lines - 1 ? 'w-4/5' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}
