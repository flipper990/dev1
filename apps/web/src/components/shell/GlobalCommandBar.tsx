'use client';

import { Command, Search } from 'lucide-react';
import { cn } from '../../../lib/cn';

interface GlobalCommandBarProps {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  className?: string;
}

export function GlobalCommandBar({
  value = '',
  placeholder = 'Search projects, open commands, inspect runs',
  onChange,
  onSubmit,
  className,
}: GlobalCommandBarProps) {
  return (
    <form
      role="search"
      aria-label="Global command bar"
      className={cn('relative w-full max-w-[640px]', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(value);
      }}
    >
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" aria-hidden="true" />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className={cn(
          'h-10 w-full rounded-[var(--radius-control)] border border-border bg-surface-base pl-9 pr-24 text-body-s text-text-primary shadow-hairline',
          'placeholder:text-text-muted transition-[background-color,border-color,box-shadow] duration-120 ease-ledger',
          'hover:border-border-strong focus-visible:border-brand-primary focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
        )}
      />
      <span
        className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 items-center gap-1 rounded-[var(--radius-control)] border border-border-muted bg-surface-tint px-2 py-1 text-label-s text-text-muted sm:inline-flex"
        aria-hidden="true"
      >
        <Command className="h-3 w-3" />
        K
      </span>
    </form>
  );
}
