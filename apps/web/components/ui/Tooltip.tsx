'use client';

import { useId, useState, type HTMLAttributes, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface TooltipProps extends HTMLAttributes<HTMLSpanElement> {
  tooltipContent: ReactNode;
  children: ReactNode;
}

export function Tooltip({ tooltipContent, children, className, ...props }: TooltipProps) {
  const id = useId();
  const [open, setOpen] = useState(false);

  return (
    <span
      {...props}
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      onFocus={() => setOpen(true)}
      onBlur={() => setOpen(false)}
    >
      <span aria-describedby={open ? id : undefined}>{children}</span>
      {open ? (
        <span
          id={id}
          role="tooltip"
          className="pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-30 w-max max-w-[240px] -translate-x-1/2 rounded-[var(--radius-control)] border border-border bg-surface-overlay px-2 py-1 text-label-s text-text-primary shadow-md"
        >
          {tooltipContent}
        </span>
      ) : null}
    </span>
  );
}
