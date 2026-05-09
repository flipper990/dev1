import type { TextareaHTMLAttributes } from 'react';
import { cn } from '../../lib/cn';

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export function Textarea({ className, invalid = false, ...props }: TextareaProps) {
  return (
    <textarea
      {...props}
      className={cn(
        'w-full rounded-[var(--radius-control)] border bg-surface-raised px-3 py-2.5 text-body-s text-ink',
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
