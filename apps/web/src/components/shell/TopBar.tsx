'use client';

import { Bell, Menu, Moon, PanelRightOpen, Search, Sun } from 'lucide-react';
import { cn } from '../../../lib/cn';
import { GlobalSearch } from './GlobalSearch';

interface TopBarProps {
  workspaceName?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
  onOpenNav?: () => void;
  onToggleContext?: () => void;
  onToggleTheme?: () => void;
  isDark?: boolean;
  showThemeToggle?: boolean;
  className?: string;
}

export function TopBar({
  workspaceName = 'Main workspace',
  searchValue = '',
  onSearchChange,
  onSearchSubmit,
  onOpenNav,
  onToggleContext,
  onToggleTheme,
  isDark = false,
  showThemeToggle = true,
  className,
}: TopBarProps) {
  return (
    <header className={cn('sticky top-0 z-40 border-b border-border bg-surface-raised/95 backdrop-blur', className)}>
      <div className="mx-auto flex h-16 w-full max-w-[1760px] items-center gap-3 px-4 sm:px-6">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={onOpenNav}
          className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex items-center gap-2 pr-1">
          <span className="inline-grid h-8 w-8 place-items-center rounded-[var(--radius-control)] bg-primary-subtle text-primary">
            <Search className="h-4 w-4" aria-hidden="true" />
          </span>
          <div>
            <p className="text-label-m text-ink">DEVteam</p>
            <p className="hidden text-label-s text-secondary sm:block">Software production studio</p>
          </div>
        </div>

        <div className="hidden flex-1 md:block">
          <GlobalSearch
            value={searchValue}
            onChange={onSearchChange}
            onSubmit={onSearchSubmit}
          />
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          <div className="hidden rounded-[var(--radius-control)] border border-border bg-surface-tint px-3 py-2 text-label-s text-secondary lg:block">
            Workspace: <span className="text-ink">{workspaceName}</span>
          </div>

          <button
            type="button"
            aria-label="Toggle context panel"
            onClick={onToggleContext}
            className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label="Notifications"
            className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <Bell className="h-4 w-4" />
          </button>

          {showThemeToggle ? (
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={onToggleTheme}
              className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          ) : null}

          <button
            type="button"
            aria-label="Open account menu"
            className="inline-flex h-10 min-w-[44px] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 text-label-m text-ink hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            AJ
          </button>
        </div>
      </div>

      <div className="px-4 pb-3 md:hidden">
        <GlobalSearch
          value={searchValue}
          onChange={onSearchChange}
          onSubmit={onSearchSubmit}
          className="max-w-none"
        />
      </div>
    </header>
  );
}
