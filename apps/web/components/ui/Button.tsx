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
    'bg-primary text-white border border-primary hover:bg-primary-hover active:bg-primary-hover',
  secondary:
    'bg-surface-raised text-ink border border-border hover:bg-surface-tint active:bg-surface-tint',
  ghost:
    'bg-transparent text-ink border border-transparent hover:bg-surface-tint active:bg-surface-tint',
  success:
    'bg-success text-white border border-success hover:brightness-95 active:brightness-95',
  warning:
    'bg-warning text-white border border-warning hover:brightness-95 active:brightness-95',
  danger:
    'bg-error text-white border border-error hover:brightness-95 active:brightness-95',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'h-9 px-3 text-label-s',
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
        'inline-flex min-w-[44px] items-center justify-center gap-2 rounded-[var(--radius-control)] transition-all duration-100 ease-out active:duration-80',
        'focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      disabled={isDisabled}
      aria-busy={loading || undefined}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {children}
    </button>
  );
}
