'use client';

import { Bell, Menu, Moon, PanelRightOpen, Search, Sparkles, Sun } from 'lucide-react';
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
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-border/70 bg-surface-raised/95 supports-[backdrop-filter]:backdrop-blur-xl',
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1680px] items-center gap-3 px-4 sm:px-6 lg:px-10">
        <button
          type="button"
          aria-label="Open navigation"
          onClick={onOpenNav}
          className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary transition-colors hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] md:hidden"
        >
          <Menu className="h-4 w-4" />
        </button>

        <div className="flex min-w-0 items-center gap-2.5 pr-1 shrink-0">
          <span className="inline-grid h-8 w-8 place-items-center rounded-[var(--radius-control)] bg-primary-subtle text-primary">
            <Sparkles className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-label-m font-semibold text-ink">DEVteam Studio</p>
            <p className="hidden text-[12px] text-secondary sm:block">Product Studio Platform</p>
          </div>
        </div>

        <div className="hidden min-w-0 flex-1 md:block">
          <GlobalSearch
            value={searchValue}
            onChange={onSearchChange}
            onSubmit={onSearchSubmit}
          />
        </div>

        <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
          <div className="hidden items-center rounded-[var(--radius-control)] border border-border/80 bg-surface-tint/70 px-3 py-2 text-label-s text-secondary md:inline-flex">
            <span className="mr-1.5 text-secondary">Workspace</span>
            <span className="max-w-[200px] truncate text-ink">{workspaceName}</span>
          </div>

          <button
            type="button"
            aria-label="Toggle context panel"
            onClick={onToggleContext}
            className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary transition-colors hover:bg-surface-tint hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <PanelRightOpen className="h-4 w-4" />
          </button>

          <button
            type="button"
            aria-label="Notifications"
            className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary transition-colors hover:bg-surface-tint hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            <Bell className="h-4 w-4" />
          </button>

          {showThemeToggle ? (
            <button
              type="button"
              aria-label="Toggle theme"
              onClick={onToggleTheme}
              className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary transition-colors hover:bg-surface-tint hover:text-ink focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
          ) : null}

          <button
            type="button"
            aria-label="Open account menu"
            className="inline-flex h-10 min-w-[44px] items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 text-label-m text-ink transition-colors hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            AJ
          </button>
        </div>
      </div>

      <div className="border-t border-border/60 px-4 pb-3 pt-2 md:hidden">
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
