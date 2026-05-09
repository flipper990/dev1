'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  Activity,
  CreditCard,
  FolderKanban,
  House,
  Rocket,
  Settings,
  Sidebar,
} from 'lucide-react';
import { cn } from '../../../lib/cn';

export interface LeftNavItem {
  label: string;
  href: string;
  icon: ComponentType<{ className?: string }>;
}

interface LeftNavProps {
  currentPath: string;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  className?: string;
  items?: LeftNavItem[];
}

export const DEFAULT_NAV_ITEMS: LeftNavItem[] = [
  { label: 'Home', href: '/', icon: House },
  { label: 'Projects', href: '/projects', icon: FolderKanban },
  { label: 'Agents', href: '/agents', icon: Activity },
  { label: 'Deployments', href: '/deployments', icon: Rocket },
  { label: 'Billing', href: '/billing', icon: CreditCard },
  { label: 'Settings', href: '/settings', icon: Settings },
];

function isActive(currentPath: string, href: string) {
  return href === '/' ? currentPath === '/' : currentPath.startsWith(href);
}

export function LeftNav({
  currentPath,
  collapsed = false,
  onToggleCollapsed,
  onNavigate,
  className,
  items = DEFAULT_NAV_ITEMS,
}: LeftNavProps) {
  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col border-r border-border bg-surface-raised px-2 py-3',
        collapsed ? 'w-[84px]' : 'w-[248px]',
        className,
      )}
    >
      <div className="mb-3 flex items-center justify-between px-2">
        <span className={cn('text-label-s uppercase tracking-wide text-secondary', collapsed && 'sr-only')}>
          Navigation
        </span>
        <button
          type="button"
          aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          onClick={onToggleCollapsed}
          className="inline-grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
        >
          <Sidebar className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>

      <div className="mb-2 h-px bg-border/70" />

      <div className={cn('px-3 pb-2 text-[11px] font-medium uppercase tracking-[0.08em] text-secondary', collapsed && 'sr-only')}>
        Studio
      </div>

      <nav aria-label="Primary" className="min-h-0 flex-1 space-y-1 overflow-auto pr-1">
        {items.map((item) => {
          const active = isActive(currentPath, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'group flex min-h-11 items-center gap-3 rounded-[var(--radius-control)] border px-3 text-body-s transition-[background-color,border-color,color] duration-150 focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                active
                  ? 'border-primary/30 bg-primary-subtle text-primary shadow-[inset_0_0_0_1px_color-mix(in_srgb,var(--color-primary)_18%,transparent)]'
                  : 'border-transparent text-secondary hover:border-border/80 hover:bg-surface-tint hover:text-ink',
                collapsed ? 'justify-center px-0' : '',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className={cn(collapsed && 'sr-only')}>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className={cn('mt-3 border-t border-border/70 pt-3 px-2', collapsed && 'px-0')}>
        <div className={cn(
          'rounded-[var(--radius-control)] border border-border/70 bg-surface-tint/60 px-3 py-2 text-[11px] text-secondary',
          collapsed && 'hidden',
        )}>
          Studio navigation
        </div>
      </div>
    </aside>
  );
}
