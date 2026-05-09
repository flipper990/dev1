import type { InputHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

export function Input({ className, invalid = false, ...props }: InputProps) {
  return (
    <input
      {...props}
      className={cn(
        'h-11 w-full rounded-[var(--radius-control)] border bg-surface-raised px-3 text-body-s text-ink',
        'placeholder:text-secondary transition-colors duration-100 ease-out',
        'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        invalid
          ? 'border-error text-error placeholder:text-error/70'
          : 'border-border hover:border-secondary/60 focus-visible:border-primary',
        'disabled:cursor-not-allowed disabled:bg-surface-tint disabled:text-secondary',
        className,
      )}
      aria-invalid={invalid || undefined}
    />
  );
}
