'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Bell, Building2, Command, Factory, Menu, Moon, PanelRightOpen, Sparkles, Sun } from 'lucide-react';
import { Badge } from '../../../components/ui/Badge';
import { IconButton } from '../../../components/ui/IconButton';
import { cn } from '../../../lib/cn';
import { ApiError, checkBackendReachable } from '../../../lib/api';
import { API_BASE } from '../../../lib/api-base';
import { useAuthSession } from '../../../hooks/useAuthSession';
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
  const [devAuthMode, setDevAuthMode] = useState(false);
  const [signOutPending, setSignOutPending] = useState(false);
  const { user, authenticated, loading: authLoading, logout } = useAuthSession();
  const router = useRouter();
  const pathname = usePathname();

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

  useEffect(() => {
    if (process.env.NODE_ENV === 'production') {
      setDevAuthMode(false);
      return;
    }
    let cancelled = false;
    fetch(`${API_BASE}/health`, { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return null;
        return await response.json() as { auth?: { devBypassEnabled?: boolean } };
      })
      .then((payload) => {
        if (cancelled) return;
        setDevAuthMode(Boolean(payload?.auth?.devBypassEnabled));
      })
      .catch(() => {
        if (cancelled) return;
        setDevAuthMode(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (authLoading || authenticated) return;
    const next = pathname && pathname.startsWith('/') ? pathname : '/overview';
    router.replace(`/login?next=${encodeURIComponent(next)}`);
  }, [authLoading, authenticated, pathname, router]);

  const platformBadge = platformHealthToBadge(platformHealth ?? detectedPlatformHealth);
  const userInitials = user?.fullName
    ?.split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
    || user?.email.slice(0, 2).toUpperCase()
    || 'U';

  async function handleSignOut() {
    setSignOutPending(true);
    try {
      await logout();
      window.location.href = '/login';
    } finally {
      setSignOutPending(false);
    }
  }

  return (
    <header
      className={cn(
        'sticky top-0 z-40 border-b border-border-muted bg-surface-canvas/72 supports-[backdrop-filter]:backdrop-blur-xl',
        className,
      )}
    >
      <div className="mx-auto flex h-14 w-full max-w-[1760px] items-center gap-3 px-4 sm:px-6 lg:px-8">
        <IconButton
          icon={<Menu className="h-4 w-4" />}
          label={onOpenNav ? 'Open navigation' : 'Navigation unavailable'}
          onClick={onOpenNav}
          disabled={!onOpenNav}
          className="lg:hidden"
        />

        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <span className="inline-grid h-9 w-9 place-items-center rounded-[14px] border border-border bg-brand-primary-subtle text-brand-primary shadow-hairline">
            <Factory className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="hidden min-w-0 sm:block">
            <p className="truncate text-label-m font-semibold text-text-primary">DEVteam OS</p>
            <p className="truncate text-label-s text-text-muted">Agent runtime</p>
          </div>
        </div>

        <div className="hidden min-w-0 max-w-[420px] items-center gap-2 rounded-full border border-border-muted bg-surface-base/80 px-3 py-1.5 text-label-s text-text-secondary md:flex">
          <Building2 className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
          <span className="truncate text-text-primary">{workspaceName}</span>
          {projectName ? (
            <>
              <span className="text-text-muted">/</span>
              <span className="max-w-[180px] truncate">{projectName}</span>
            </>
          ) : null}
        </div>

        <div className="hidden min-w-[220px] flex-1 items-center justify-center gap-2 md:flex">
          <div className="inline-flex items-center gap-2 rounded-full border border-border-muted bg-surface-base/75 px-3 py-1 text-label-s text-text-muted">
            <Sparkles className="h-3.5 w-3.5 text-brand-primary" />
            <span>Runtime telemetry live</span>
          </div>
          <div className="hidden 2xl:block">
            <GlobalCommandBar value={searchValue} onChange={onSearchChange} onSubmit={onSearchSubmit} className="max-w-[380px]" />
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <div className="hidden xl:block">
            <Badge variant={platformBadge.variant} title={platformBadge.title}>{platformBadge.label}</Badge>
          </div>
          {devAuthMode ? (
            <div className="hidden lg:block">
              <Badge variant="warning" title="Development-only authentication bypass is enabled">
                Dev auth mode
              </Badge>
            </div>
          ) : null}

          {showContextToggle ? (
            <IconButton
              icon={<PanelRightOpen className="h-4 w-4" />}
              label={onToggleContext ? 'Toggle context drawer' : 'Context drawer unavailable'}
              onClick={onToggleContext}
              disabled={!onToggleContext}
            />
          ) : null}

          <IconButton icon={<Bell className="h-4 w-4" />} label="Notifications unavailable: no notifications endpoint is connected" disabled className="hidden sm:inline-flex" />

          {showThemeToggle ? (
            <IconButton
              icon={isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              label={onToggleTheme ? 'Toggle theme' : 'Theme toggle unavailable'}
              onClick={onToggleTheme}
              disabled={!onToggleTheme}
            />
          ) : null}

          <span className="hidden rounded-full border border-border-muted bg-surface-base/80 px-2 py-1 text-label-s text-text-muted sm:inline-flex">
            <Command className="mr-1 h-3 w-3" />
            K
          </span>

          {authLoading ? (
            <button
              type="button"
              disabled
              className="inline-flex h-10 min-w-11 cursor-not-allowed items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 text-label-m text-text-muted opacity-55 shadow-hairline"
            >
              ...
            </button>
          ) : authenticated ? (
            <button
              type="button"
              onClick={() => { void handleSignOut(); }}
              disabled={signOutPending}
              className="inline-flex h-10 min-w-11 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 text-label-m text-text-primary shadow-hairline transition-colors duration-120 ease-ledger hover:border-border-strong hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-60"
              title={user?.email}
            >
              {signOutPending ? '...' : userInitials}
            </button>
          ) : (
            <Link
              href="/login"
              className="inline-flex h-10 min-w-11 items-center justify-center rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 text-label-m text-text-primary shadow-hairline transition-colors duration-120 ease-ledger hover:border-border-strong hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
            >
              Sign in
            </Link>
          )}
        </div>
      </div>

      <div className="border-t border-border-muted px-4 pb-3 pt-2 2xl:hidden">
        <GlobalCommandBar value={searchValue} onChange={onSearchChange} onSubmit={onSearchSubmit} className="max-w-none" />
      </div>
    </header>
  );
}
