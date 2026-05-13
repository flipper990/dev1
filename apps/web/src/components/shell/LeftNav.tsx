'use client';

import Link from 'next/link';
import type { ComponentType } from 'react';
import {
  Activity,
  Bot,
  BookOpen,
  Boxes,
  CreditCard,
  FileWarning,
  FolderKanban,
  House,
  PanelLeft,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
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
  { label: 'Deployments', href: '/deployments', icon: Boxes, section: 'operations' },
  { label: 'Agent runtime', href: '/agents', icon: Bot, section: 'operations' },
  { label: 'Docs', href: '/docs', icon: BookOpen, section: 'operations' },
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
        'studio-surface-soft flex h-full min-h-0 flex-col rounded-[calc(var(--radius-modal)+2px)] px-2 py-3',
        collapsed ? 'w-[78px]' : 'w-[236px]',
        className,
      )}
    >
      <div className={cn('mb-3 flex items-center gap-2', collapsed ? 'justify-center' : 'justify-between')}>
        <div className={cn('min-w-0', collapsed && 'sr-only')}>
          <p className="text-label-s uppercase tracking-[0.15em] text-text-muted">Runtime</p>
          <p className="mt-1 truncate text-label-m text-text-primary">Mission control</p>
        </div>
        <IconButton
          icon={collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          label={onToggleCollapsed ? (collapsed ? 'Expand navigation' : 'Collapse navigation') : 'Navigation collapse unavailable'}
          onClick={onToggleCollapsed}
          disabled={!onToggleCollapsed}
          className="h-9 w-9 min-h-9 min-w-9 rounded-full border-border-muted bg-surface-tint"
        />
      </div>

      <div className={cn('mb-3', collapsed ? 'px-0.5' : 'px-1')}>
        <button
          type="button"
          className={cn(
            'flex min-h-10 w-full items-center gap-2 rounded-full border border-border-muted bg-surface-tint px-3 text-label-s text-text-secondary',
            'transition-colors duration-160 ease-ledger hover:border-border-strong hover:text-text-primary',
            collapsed && 'justify-center px-0',
          )}
          title="Create project"
        >
          <Plus className="h-4 w-4 shrink-0" />
          <span className={cn(collapsed && 'sr-only')}>New mission</span>
        </button>
      </div>

      <nav aria-label="Primary" className="studio-scroll min-h-0 flex-1 overflow-y-auto overflow-x-hidden pr-0.5">
        {groupedItems.map(({ section, items: sectionItems }) => {
          if (sectionItems.length === 0) return null;

          return (
            <div key={section} className="mb-5 last:mb-0">
              <div className={cn('mb-2 px-2 text-label-s uppercase tracking-[0.14em] text-text-muted', collapsed && 'sr-only')}>
                {SECTION_LABELS[section]}
              </div>
              <div className="space-y-1">
                {sectionItems.map((item) => {
                  const active = isActive(currentPath, item.href);
                  const Icon = item.icon;
                  const itemKey = `${section}:${item.href ?? 'no-href'}:${item.label}`;
                  const baseClass = cn(
                    'group flex min-h-11 w-full items-center gap-3 rounded-[14px] px-3 text-body-s',
                    'transition-[background-color,border-color,color,box-shadow] duration-160 ease-ledger focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]',
                    active
                      ? 'bg-brand-primary-subtle text-brand-primary shadow-hairline'
                      : 'text-text-secondary hover:bg-surface-tint hover:text-text-primary',
                    collapsed && 'justify-center px-0.5',
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
                      <span key={itemKey} className={baseClass} aria-disabled="true">
                        {content}
                      </span>
                    );
                  }

                  return (
                    <Link
                      key={itemKey}
                      href={item.href}
                      onClick={onNavigate}
                      aria-current={active ? 'page' : undefined}
                      className={baseClass}
                      title={collapsed ? item.label : undefined}
                    >
                      {content}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </nav>

      <div className={cn('mt-3 flex items-center rounded-[14px] bg-surface-tint px-2 py-1.5', collapsed ? 'justify-center' : 'justify-between')}>
        <PanelLeft className="h-4 w-4 text-text-muted" />
        <span className={cn('text-label-s text-text-muted', collapsed && 'sr-only')}>Dock mode</span>
      </div>
    </aside>
  );
}
