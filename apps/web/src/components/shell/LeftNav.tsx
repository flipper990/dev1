'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  Activity,
  BookOpen,
  CreditCard,
  FileWarning,
  FolderKanban,
  House,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { IconButton } from '../../../components/ui/IconButton';
import { cn } from '../../../lib/cn';

export interface LeftNavItem {
  label: string;
  href?: string;
  icon: ComponentType<{ className?: string }>;
  section?: 'studio' | 'operations' | 'administration';
  disabled?: boolean;
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
  { label: 'Overview', href: '/overview', icon: House, section: 'studio' },
  { label: 'Projects', href: '/projects', icon: FolderKanban, section: 'studio' },
  { label: 'Workspace / Builder', href: '/workspace', icon: Wrench, section: 'studio' },
  { label: 'Activity', href: '/agents', icon: Activity, section: 'operations' },
  { label: 'Diagnostics', href: '/workspace?tab=logs', icon: FileWarning, section: 'operations' },
  { label: 'Docs', href: '/how-it-works', icon: BookOpen, section: 'operations' },
  { label: 'Billing', href: '/billing', icon: CreditCard, section: 'administration' },
  { label: 'Settings', href: '/settings', icon: Settings, section: 'administration' },
  { label: 'Security / Admin', href: '/security', icon: ShieldCheck, section: 'administration' },
];

const SECTION_LABELS: Record<NonNullable<LeftNavItem['section']>, string> = {
  studio: 'Studio',
  operations: 'Operations',
  administration: 'Administration',
};

function isActive(currentPath: string, href?: string) {
  if (!href) return false;
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
  const groupedItems = (Object.keys(SECTION_LABELS) as Array<NonNullable<LeftNavItem['section']>>).map((section) => ({
    section,
    items: items.filter((item) => (item.section ?? 'studio') === section),
  }));

  return (
    <aside
      className={cn(
        'flex h-full min-h-0 flex-col border-r border-border bg-surface-raised px-3 py-4',
        collapsed ? 'w-[76px]' : 'w-[264px]',
        className,
      )}
    >
      <div className="mb-4 flex items-center justify-between gap-2 px-1">
        <div className={cn('min-w-0', collapsed && 'sr-only')}>
          <p className="text-label-s uppercase tracking-[0.12em] text-text-muted">Navigation</p>
          <p className="mt-1 truncate text-label-m text-text-primary">Production studio</p>
        </div>
        <IconButton
          icon={collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          label={onToggleCollapsed ? (collapsed ? 'Expand navigation' : 'Collapse navigation') : 'Navigation collapse unavailable'}
          onClick={onToggleCollapsed}
          disabled={!onToggleCollapsed}
          className="h-9 w-9 min-h-9 min-w-9"
        />
      </div>

      <nav aria-label="Primary" className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
        {groupedItems.map(({ section, items: sectionItems }) => {
          if (sectionItems.length === 0) return null;

          return (
            <div key={section} className="mb-5 last:mb-0">
              <div className={cn('mb-2 px-2 text-label-s uppercase tracking-[0.12em] text-text-muted', collapsed && 'sr-only')}>
                {SECTION_LABELS[section]}
              </div>
              <div className="space-y-1">
                {sectionItems.map((item) => {
                  const active = isActive(currentPath, item.href);
                  const Icon = item.icon;
                  const baseClass = cn(
                    'group flex min-h-10 w-full items-center gap-3 rounded-[var(--radius-control)] border px-3 text-body-s',
                    'transition-[background-color,border-color,color,box-shadow] duration-160 ease-ledger focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                    active
                      ? 'border-brand-primary bg-brand-primary-subtle text-brand-primary shadow-hairline'
                      : 'border-transparent text-text-secondary hover:border-border hover:bg-surface-tint hover:text-text-primary',
                    collapsed && 'justify-center px-0',
                    item.disabled && 'cursor-not-allowed opacity-55 hover:border-transparent hover:bg-transparent hover:text-text-secondary',
                  );

                  const content = (
                    <>
                      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                      <span className={cn('min-w-0 truncate', collapsed && 'sr-only')}>{item.label}</span>
                      {item.disabled ? <span className={cn('ml-auto text-label-s uppercase tracking-[0.08em] text-text-muted', collapsed && 'sr-only')}>Soon</span> : null}
                    </>
                  );

                  if (!item.href || item.disabled) {
                    return (
                      <span key={item.label} className={baseClass} aria-disabled="true">
                        {content}
                      </span>
                    );
                  }

                  return (
                    <Link key={item.href} href={item.href} onClick={onNavigate} aria-current={active ? 'page' : undefined} className={baseClass}>
                      {content}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}
