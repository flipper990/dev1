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
        'w-full rounded-[var(--radius-control)] border bg-surface-raised px-3 py-2.5 text-body-s text-text-primary shadow-hairline',
        'placeholder:text-text-muted transition-colors duration-120 ease-ledger',
        'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        invalid
          ? 'border-status-error text-status-error placeholder:text-status-error'
          : 'border-border hover:border-border-strong focus-visible:border-brand-primary',
        'disabled:cursor-not-allowed disabled:bg-surface-tint disabled:text-text-muted',
        className,
      )}
      aria-invalid={invalid || undefined}
    />
  );
}
