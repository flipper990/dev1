'use client';

import { useRef } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../../lib/cn';

export interface TabItem {
  id: string;
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
}

interface TabsProps {
  items: TabItem[];
  value: string;
  onChange: (id: string) => void;
  ariaLabel?: string;
  autoFocusSelected?: boolean;
}

export function Tabs({ items, value, onChange, ariaLabel = 'Tabs', autoFocusSelected = false }: TabsProps) {
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusAndSelect = (nextIndex: number) => {
    const target = items[nextIndex];
    if (!target || target.disabled) return;
    onChange(target.id);
    tabRefs.current[nextIndex]?.focus();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      event.preventDefault();
      for (let offset = 1; offset <= items.length; offset += 1) {
        const next = (index + offset) % items.length;
        if (!items[next]?.disabled) {
          focusAndSelect(next);
          break;
        }
      }
      return;
    }

    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      event.preventDefault();
      for (let offset = 1; offset <= items.length; offset += 1) {
        const next = (index - offset + items.length) % items.length;
        if (!items[next]?.disabled) {
          focusAndSelect(next);
          break;
        }
      }
      return;
    }

    if (event.key === 'Home') {
      event.preventDefault();
      const firstEnabled = items.findIndex((item) => !item.disabled);
      if (firstEnabled >= 0) focusAndSelect(firstEnabled);
      return;
    }

    if (event.key === 'End') {
      event.preventDefault();
      const lastEnabled = [...items].reverse().findIndex((item) => !item.disabled);
      if (lastEnabled >= 0) focusAndSelect(items.length - 1 - lastEnabled);
    }
  };

  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className="flex min-h-11 w-full max-w-full items-center gap-1.5 overflow-x-auto rounded-[var(--radius-panel)] border border-border-muted bg-surface-tint/80 p-1.5 [scrollbar-width:thin]"
    >
      {items.map((item, index) => {
        const selected = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={`${item.id}-panel`}
            id={`${item.id}-tab`}
            tabIndex={selected ? 0 : -1}
            autoFocus={selected && autoFocusSelected}
            disabled={item.disabled}
            onClick={() => onChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              'inline-flex min-h-9 min-w-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--radius-control)] border px-3.5 text-label-m',
              'transition-[background-color,border-color,color,box-shadow] duration-120 ease-ledger',
              'focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50',
              selected
                ? 'border-border bg-surface-raised text-text-primary shadow-hairline'
                : 'border-transparent text-text-secondary hover:bg-surface-raised hover:text-text-primary',
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
