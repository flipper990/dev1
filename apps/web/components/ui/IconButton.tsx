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
  primary: 'bg-primary text-white border border-primary hover:bg-primary-hover',
  secondary: 'bg-surface-raised text-ink border border-border hover:bg-surface-tint',
  ghost: 'bg-transparent text-ink border border-transparent hover:bg-surface-tint',
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
        'inline-grid h-11 w-11 min-h-[44px] min-w-[44px] place-items-center rounded-[var(--radius-control)] transition-all duration-100 ease-out active:duration-80',
        'focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50',
        variantClasses[variant],
        className,
      )}
      aria-label={label}
      title={label}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />
      ) : (
        icon
      )}
    </button>
  );
}
