import type { SelectHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export function Select({ className, invalid = false, children, ...props }: SelectProps) {
  return (
    <div className="relative">
      <select
        {...props}
        className={cn(
          'h-11 min-h-11 w-full appearance-none rounded-[var(--radius-control)] border bg-surface-raised px-3 pr-10 text-body-s text-text-primary shadow-hairline',
          'transition-colors duration-120 ease-ledger',
          invalid ? 'border-status-error focus-visible:border-status-error' : 'border-border hover:border-border-strong focus-visible:border-brand-primary',
          'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
          'disabled:cursor-not-allowed disabled:bg-surface-tint disabled:text-text-muted',
          className,
        )}
        aria-invalid={invalid || undefined}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
        aria-hidden="true"
      />
    </div>
  );
}
