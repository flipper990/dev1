import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';

type IconButtonVariant = 'primary' | 'secondary' | 'ghost';

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
  variant?: IconButtonVariant;
  loading?: boolean;
}

const variantClasses: Record<IconButtonVariant, string> = {
  primary: 'border-brand-primary bg-brand-primary text-brand-primary-contrast shadow-hairline hover:bg-brand-primary-hover',
  secondary: 'border-border bg-surface-raised text-text-secondary shadow-hairline hover:border-border-strong hover:bg-surface-tint hover:text-text-primary',
  ghost: 'border-transparent bg-transparent text-text-secondary hover:bg-surface-tint hover:text-text-primary',
};

export function IconButton({
  icon,
  label,
  variant = 'secondary',
  loading = false,
  className,
  disabled,
  ...props
}: IconButtonProps) {
  return (
    <button
      type="button"
      {...props}
      className={cn(
        'inline-grid h-11 w-11 min-h-11 min-w-11 place-items-center rounded-[var(--radius-control)] border',
        'transition-[background-color,border-color,color,box-shadow,filter] duration-120 ease-ledger active:duration-80',
        'focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-55',
        variantClasses[variant],
        className,
      )}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : icon}
    </button>
  );
}
