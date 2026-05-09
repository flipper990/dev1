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
          'h-11 w-full appearance-none rounded-[var(--radius-control)] border bg-surface-raised px-3 pr-10 text-body-s text-ink',
          'min-h-[44px] transition-colors duration-100',
          invalid ? 'border-error focus-visible:border-error' : 'border-border focus-visible:border-primary',
          'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
          'disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        aria-invalid={invalid || undefined}
      >
        {children}
      </select>
      <ChevronDown
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
        aria-hidden="true"
      />
    </div>
  );
}

