'use client';

import { Search } from 'lucide-react';
import { cn } from '../../../lib/cn';

interface GlobalSearchProps {
  value?: string;
  placeholder?: string;
  onChange?: (value: string) => void;
  onSubmit?: (value: string) => void;
  className?: string;
}

export function GlobalSearch({
  value = '',
  placeholder = 'Search projects, runs, and agents',
  onChange,
  onSubmit,
  className,
}: GlobalSearchProps) {
  return (
    <form
      role="search"
      aria-label="Global search"
      className={cn('relative w-full max-w-[560px]', className)}
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit?.(value);
      }}
    >
      <Search
        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary"
        aria-hidden="true"
      />
      <input
        value={value}
        onChange={(event) => onChange?.(event.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-[var(--radius-control)] border border-border bg-surface-raised pl-9 pr-14 text-body-s text-ink placeholder:text-secondary focus-visible:border-primary focus-visible:outline-none"
      />
      <span
        className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 rounded-md border border-border bg-surface-tint px-2 py-0.5 text-label-s text-secondary sm:inline"
        aria-hidden="true"
      >
        /
      </span>
    </form>
  );
}
