import type { ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'success' | 'warning' | 'danger';
type ButtonSize = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'border-brand-primary bg-brand-primary text-brand-primary-contrast shadow-hairline hover:bg-brand-primary-hover active:bg-brand-primary-hover',
  secondary:
    'border-border bg-surface-base text-text-primary hover:border-border-strong hover:bg-surface-raised active:bg-surface-tint',
  ghost:
    'border-transparent bg-transparent text-text-primary hover:bg-surface-tint active:bg-surface-tint',
  success:
    'border-status-success bg-status-success text-text-inverse shadow-hairline hover:brightness-95 active:brightness-95',
  warning:
    'border-status-warning bg-status-warning text-text-inverse shadow-hairline hover:brightness-95 active:brightness-95',
  danger:
    'border-status-error bg-status-error text-text-inverse shadow-hairline hover:brightness-95 active:brightness-95',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3.5 text-label-s',
  md: 'h-11 px-4 text-label-m',
  lg: 'h-12 px-5 text-body-s font-semibold',
};

export function Button({
  className,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const isDisabled = disabled || loading;

  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-flex min-w-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border',
        'font-semibold transition-[background-color,border-color,color,box-shadow,transform,filter] duration-120 ease-ledger hover:-translate-y-px active:translate-y-0 active:scale-[0.985]',
        'focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
      {children}
    </button>
  );
}
