import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  lines?: number;
}

export function Skeleton({ className, lines = 1, ...props }: SkeletonProps) {
  if (lines <= 1) {
    return <div {...props} aria-hidden="true" className={cn('h-4 w-full overflow-hidden rounded-md bg-surface-tint motion-safe:animate-pulse', className)} />;
  }

  return (
    <div aria-hidden="true" className={cn('space-y-2.5', className)} {...props}>
      {Array.from({ length: lines }).map((_, idx) => (
        <div
          key={idx}
          className={cn(
            'h-4 rounded-md bg-surface-tint motion-safe:animate-pulse',
            idx === lines - 1 ? 'w-4/5' : 'w-full',
          )}
        />
      ))}
    </div>
  );
}
