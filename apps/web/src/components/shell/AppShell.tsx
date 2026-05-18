'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { X } from 'lucide-react';
import { IconButton } from '../../../components/ui/IconButton';
import { cn } from '../../../lib/cn';
import { getExperimentAssignments, getUiRedesignFlags } from '../../lib/flags/uiRedesignFlags';
import { useRouteMetrics } from '../../lib/telemetry/routeMetrics';
import { useTrackEvent } from '../../lib/telemetry/useTrackEvent';
import { LeftNav } from './LeftNav';
import { PageHeader, type LifecycleTone } from './PageHeader';
import { TopBar } from './TopBar';
import { ContextDrawer } from './ContextDrawer';
import type { BreadcrumbItem } from './Breadcrumbs';

interface AppShellProps {
  title: string;
  subtitle?: string;
  lifecycle?: { label: string; tone?: LifecycleTone };
  actions?: ReactNode;
  secondaryActions?: ReactNode;
  breadcrumbs?: BreadcrumbItem[];
  children: ReactNode;
  contextTitle?: string;
  contextDescription?: string;
  contextContent?: ReactNode;
  defaultContextOpen?: boolean;
  workspaceName?: string;
  projectName?: string;
  compactHeader?: boolean;
  className?: string;
}

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function AppShell({
  title,
  subtitle,
  lifecycle,
  actions,
  secondaryActions,
  breadcrumbs,
  children,
  contextTitle = 'Context',
  contextDescription,
  contextContent,
  defaultContextOpen = false,
  workspaceName,
  projectName,
  compactHeader = false,
  className,
}: AppShellProps) {
  const pathname = usePathname() ?? '/';
  const router = useRouter();
  const trackEvent = useTrackEvent();
  const [commandValue, setCommandValue] = useState('');
  const [leftNavOpen, setLeftNavOpen] = useState(false);
  const [leftNavCollapsed, setLeftNavCollapsed] = useState(false);
  const [contextOpen, setContextOpen] = useState(defaultContextOpen);
  const [themeDark, setThemeDark] = useState(true);
  const [currentRoute, setCurrentRoute] = useState(pathname);
  const keyboardTrackedRef = useRef(false);
  const variantTrackedRef = useRef(false);
  const mobileNavRef = useRef<HTMLDivElement | null>(null);

  const hasContext = useMemo(() => Boolean(contextContent), [contextContent]);
  const flags = useMemo(() => getUiRedesignFlags(), []);
  const experiments = useMemo(() => getExperimentAssignments(), []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setCurrentRoute(pathname);
      return;
    }
    const query = window.location.search;
    setCurrentRoute(query ? `${pathname}${query}` : pathname);
  }, [pathname]);

  useEffect(() => {
    if (experiments.light_default_variant === 'dark-first' && flags.ui_redesign_dark_mode) {
      setThemeDark(true);
    }
  }, [experiments.light_default_variant, flags.ui_redesign_dark_mode]);

  useEffect(() => {
    variantTrackedRef.current = false;
    keyboardTrackedRef.current = false;
    setLeftNavOpen(false);
  }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeDark ? 'dark' : 'light';
    root.classList.toggle('theme-dark', themeDark);
    try {
      window.localStorage.setItem('devteam-theme', themeDark ? 'dark' : 'light');
    } catch {
      // Ignore persistence failures in restricted environments.
    }
  }, [themeDark]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('devteam-theme');
      if (saved === 'light') setThemeDark(false);
      if (saved === 'dark') setThemeDark(true);
    } catch {
      // Use default theme when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!leftNavOpen) return;
    const panel = mobileNavRef.current;
    if (!panel) return;

    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    first?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setLeftNavOpen(false);
        return;
      }

      if (event.key !== 'Tab' || focusables.length === 0) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [leftNavOpen]);

  useEffect(() => {
    if (!leftNavOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [leftNavOpen]);

  useEffect(() => {
    if (variantTrackedRef.current) return;
    variantTrackedRef.current = true;
    trackEvent('ui_variant_exposed', {
      route: pathname,
      theme: themeDark ? 'dark' : 'light',
      variant: [
        `shell:${flags.ui_redesign_shell ? 'new' : 'legacy'}`,
        `workspace:${flags.ui_redesign_workspace ? 'new' : 'legacy'}`,
        `status:${flags.ui_redesign_status_system ? 'unified' : 'legacy'}`,
        `theme-default:${experiments.light_default_variant}`,
        `status-summary:${experiments.status_summary_variant}`,
        `command-dock:${experiments.command_dock_variant}`,
        `activity-timeline:${experiments.activity_timeline_variant}`,
      ].join('|'),
    });
  }, [
    experiments.activity_timeline_variant,
    experiments.command_dock_variant,
    experiments.light_default_variant,
    experiments.status_summary_variant,
    flags.ui_redesign_shell,
    flags.ui_redesign_status_system,
    flags.ui_redesign_workspace,
    pathname,
    themeDark,
    trackEvent,
  ]);

  useRouteMetrics({
    onMetrics: (metrics) => {
      trackEvent('shell_loaded', {
        route: pathname,
        theme: themeDark ? 'dark' : 'light',
        variant: flags.ui_redesign_shell ? 'studio-ledger-shell' : 'legacy-shell',
        lcp_ms: metrics.lcp_ms,
        inp_ms: metrics.inp_ms,
        cls: metrics.cls,
      });
    },
  });

  const handleGlobalCommandSubmit = (rawValue: string) => {
    const value = rawValue.trim();
    if (!value) return;

    const normalized = value.toLowerCase();
    const routes: Array<{ match: RegExp; href: string }> = [
      { match: /^(overview|home|dashboard)$/, href: '/overview' },
      { match: /^(projects|portfolio)$/, href: '/projects' },
      { match: /^(workspace|builder|build|new project|create project)$/, href: '/workspace' },
      { match: /^(activity|agents|pipeline)$/, href: '/agents' },
      { match: /^(diagnostics|logs)$/, href: '/workspace?tab=logs' },
      { match: /^(docs|documentation|how it works)$/, href: '/docs' },
      { match: /^(billing|usage|costs?)$/, href: '/billing' },
      { match: /^(settings|preferences)$/, href: '/settings' },
      { match: /^(security|admin|trust)$/, href: '/security' },
    ];

    const directRoute = routes.find((route) => route.match.test(normalized));
    const isProjectId = /^[a-z0-9_-]{8,}$/i.test(value);
    const href = directRoute?.href
      ?? (isProjectId ? `/workspace?projectId=${encodeURIComponent(value)}` : `/projects?search=${encodeURIComponent(value)}`);

    setCommandValue('');
    router.push(href);
    if (!directRoute && !isProjectId && pathname === '/projects') {
      window.dispatchEvent(new CustomEvent('devteam:project-search', { detail: value }));
    }
  };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>('[aria-label="Global command bar"] input');
        input?.focus();
      }

      if (keyboardTrackedRef.current) return;
      if (event.key === 'Tab' || event.key.startsWith('Arrow')) {
        keyboardTrackedRef.current = true;
        trackEvent('keyboard_navigation_detected', {
          route: pathname,
          theme: themeDark ? 'dark' : 'light',
          action_source: 'app-shell',
        });
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pathname, themeDark, trackEvent]);

  return (
    <div className={cn('studio-canvas min-h-screen overflow-x-hidden bg-surface-canvas text-text-primary', className)}>
      <TopBar
        workspaceName={workspaceName}
        projectName={projectName}
        searchValue={commandValue}
        onSearchChange={setCommandValue}
        onSearchSubmit={handleGlobalCommandSubmit}
        onOpenNav={() => setLeftNavOpen(true)}
        onToggleContext={hasContext ? () => setContextOpen((prev) => !prev) : undefined}
        onToggleTheme={flags.ui_redesign_dark_mode ? () => setThemeDark((prev) => !prev) : undefined}
        isDark={themeDark}
        showThemeToggle={flags.ui_redesign_dark_mode}
        showContextToggle={hasContext}
      />

      <div className="mx-auto w-full max-w-[1780px] px-3 py-3 sm:px-4 sm:py-4 lg:px-6">
        <div className={cn('grid min-w-0 gap-3 xl:grid-cols-[auto_minmax(0,1fr)_minmax(292px,344px)]', hasContext ? '' : 'xl:grid-cols-[auto_minmax(0,1fr)]')}>
          <div className="hidden min-h-[var(--shell-content-min-height)] shrink-0 lg:block">
            <div className="sticky top-[calc(var(--shell-header-offset)+10px)] h-[calc(var(--shell-content-min-height)-12px)]">
              <LeftNav
                currentPath={currentRoute}
                collapsed={leftNavCollapsed}
                onToggleCollapsed={() => setLeftNavCollapsed((prev) => !prev)}
              />
            </div>
          </div>

          {leftNavOpen ? (
            <div className="fixed inset-0 z-[65] lg:hidden" role="dialog" aria-label="Navigation menu" aria-modal="true">
              <button
                type="button"
                className="absolute inset-0 bg-text-primary/45 backdrop-blur-[2px]"
                aria-label="Close navigation menu"
                onClick={() => setLeftNavOpen(false)}
              />
              <div ref={mobileNavRef} className="studio-glass absolute bottom-2 left-2 top-[calc(var(--shell-header-offset)+8px)] flex w-[304px] max-w-[88vw] flex-col rounded-[var(--radius-modal)] pb-[max(var(--safe-bottom),0px)]">
                <div className="flex items-center justify-between border-b border-border-muted px-4 py-3">
                  <span className="text-label-m text-text-primary">Navigation</span>
                  <IconButton icon={<X className="h-4 w-4" />} label="Close navigation menu" onClick={() => setLeftNavOpen(false)} />
                </div>
                <LeftNav currentPath={currentRoute} onNavigate={() => setLeftNavOpen(false)} className="w-full flex-1 border-r-0 shadow-none" />
              </div>
            </div>
          ) : null}

          <main className="studio-surface min-w-0 overflow-hidden rounded-[var(--radius-modal)]">
            <section className="studio-scroll mx-auto min-h-[var(--shell-content-min-height)] w-full max-w-[1400px] overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+var(--space-6))] pt-5 sm:px-6 sm:pt-6 lg:px-8 lg:pt-8 xl:px-10">
              <PageHeader
                title={title}
                subtitle={subtitle}
                lifecycle={lifecycle}
                actions={actions}
                secondaryActions={secondaryActions}
                breadcrumbs={breadcrumbs}
                compact={compactHeader}
                className="border-border px-0 pb-5"
              />
              <div className={cn('min-w-0', compactHeader ? 'pt-4' : 'pt-6 sm:pt-7')}>{children}</div>
            </section>
          </main>

          {hasContext ? (
            <aside className="studio-surface-soft studio-scroll hidden min-h-[var(--shell-content-min-height)] overflow-y-auto rounded-[var(--radius-modal)] p-3.5 xl:block">
              <div className="mb-3.5 border-b border-border-muted pb-2.5">
                <h2 className="text-label-m text-text-primary">{contextTitle}</h2>
                {contextDescription ? <p className="mt-1 text-body-s text-text-secondary">{contextDescription}</p> : null}
              </div>
              {contextContent}
            </aside>
          ) : null}
        </div>
      </div>

      {hasContext ? (
        <ContextDrawer
          open={contextOpen}
          onClose={() => setContextOpen(false)}
          title={contextTitle}
          description={contextDescription}
        >
          {contextContent}
        </ContextDrawer>
      ) : null}
    </div>
  );
}
