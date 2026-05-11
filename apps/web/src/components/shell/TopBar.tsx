'use client';

import { useEffect, useState } from 'react';
import { Bell, Building2, Factory, Menu, Moon, PanelRightOpen, Sun } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { IconButton } from '../../../components/ui/IconButton';
import { cn } from '../../../lib/cn';
import { ApiError, checkBackendReachable } from '../../../lib/api';
import { GlobalCommandBar } from './GlobalCommandBar';
import { platformHealthToBadge, type PlatformHealthState } from './platformStatus';

interface TopBarProps {
  workspaceName?: string;
  projectName?: string;
  searchValue?: string;
  onSearchChange?: (value: string) => void;
  onSearchSubmit?: (value: string) => void;
  onOpenNav?: () => void;
  onToggleContext?: () => void;
  onToggleTheme?: () => void;
  isDark?: boolean;
  showThemeToggle?: boolean;
  showContextToggle?: boolean;
  platformHealth?: PlatformHealthState;
  className?: string;
}

export function TopBar({
  workspaceName = 'DEVteam Studio',
  projectName,
  searchValue = '',
  onSearchChange,
  onSearchSubmit,
  onOpenNav,
  onToggleContext,
  onToggleTheme,
  isDark = false,
  showThemeToggle = true,
  showContextToggle = false,
  platformHealth,
  className,
}: TopBarProps) {
  const [detectedPlatformHealth, setDetectedPlatformHealth] = useState<PlatformHealthState>('checking');

  useEffect(() => {
    if (platformHealth) return;

    let cancelled = false;
    setDetectedPlatformHealth('checking');

    checkBackendReachable()
      .then(() => {
        if (!cancelled) setDetectedPlatformHealth('online');
      })
      .catch((err) => {
        if (cancelled) return;
        if (err instanceof ApiError && err.kind === 'http') {
          setDetectedPlatformHealth('reachable-degraded');
          return;
        }
        setDetectedPlatformHealth('offline');
      });

    return () => {
      cancelled = true;
    };
  }, [platformHealth]);

  const platformBadge = platformHealthToBadge(platformHealth ?? detectedPlatformHealth);

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-border bg-surface-raised supports-[backdrop-filter]:bg-surface-raised/95 supports-[backdrop-filter]:backdrop-blur-xl',
        className,
      )}
    >
      <div className="mx-auto flex h-16 w-full max-w-[1600px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <IconButton
          icon={<Menu className="h-4 w-4" />}
          label={onOpenNav ? 'Open navigation' : 'Navigation unavailable'}
          onClick={onOpenNav}
          disabled={!onOpenNav}
          className="lg:hidden"
        />

        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <span className="inline-grid h-9 w-9 place-items-center rounded-[var(--radius-control)] border border-border bg-brand-primary-subtle text-brand-primary shadow-hairline">
            <Factory className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-label-m font-semibold text-text-primary">DEVteam</p>
            <p className="truncate text-label-s text-text-muted">Production studio</p>
          </div>
        </div>

        <div className="hidden min-w-0 items-center gap-2 rounded-[var(--radius-control)] border border-border-muted bg-surface-base px-3 py-2 text-label-s text-text-secondary md:flex">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
          <span className="truncate text-text-primary">{workspaceName}</span>
          {projectName ? (
            <>
              <span className="text-text-muted">/</span>
              <span className="max-w-[180px] truncate">{projectName}</span>
            </>
          ) : null}
        </div>

        <div className="hidden min-w-[220px] flex-1 justify-center md:flex">
          <GlobalCommandBar value={searchValue} onChange={onSearchChange} onSubmit={onSearchSubmit} />
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden xl:block">
            <Badge variant={platformBadge.variant} title={platformBadge.title}>{platformBadge.label}</Badge>
          </div>

          {showContextToggle ? (
            <IconButton
              icon={<PanelRightOpen className="h-4 w-4" />}
              label={onToggleContext ? 'Toggle context drawer' : 'Context drawer unavailable'}
              onClick={onToggleContext}
              disabled={!onToggleContext}
            />
          ) : null}

          <IconButton icon={<Bell className="h-4 w-4" />} label="Notifications unavailable: no notifications endpoint is connected" disabled />

          {showThemeToggle ? (
            <IconButton
              icon={isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              label={onToggleTheme ? 'Toggle theme' : 'Theme toggle unavailable'}
              onClick={onToggleTheme}
              disabled={!onToggleTheme}
            />
          ) : null}

          <button
            type="button"
            aria-label="Open account menu"
            title="Account menu unavailable: authentication backend is not connected"
            disabled
            className="inline-flex h-10 min-w-11 cursor-not-allowed items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 text-label-m text-text-muted opacity-55 shadow-hairline transition-colors duration-120 ease-ledger focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
          >
            AJ
          </button>
        </div>
      </div>

      <div className="border-t border-border-muted px-4 pb-3 pt-2 md:hidden">
        <GlobalCommandBar value={searchValue} onChange={onSearchChange} onSubmit={onSearchSubmit} className="max-w-none" />
      </div>
    </header>
  );
}
