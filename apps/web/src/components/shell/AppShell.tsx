'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { X } from 'lucide-react';
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
  className?: string;
}

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
  className,
}: AppShellProps) {
  const pathname = usePathname() ?? '/';
  const trackEvent = useTrackEvent();
  const [searchValue, setSearchValue] = useState('');
  const [leftNavOpen, setLeftNavOpen] = useState(false);
  const [leftNavCollapsed, setLeftNavCollapsed] = useState(false);
  const [contextOpen, setContextOpen] = useState(defaultContextOpen);
  const [themeDark, setThemeDark] = useState(false);
  const keyboardTrackedRef = useRef(false);
  const variantTrackedRef = useRef(false);

  const hasContext = useMemo(() => Boolean(contextContent), [contextContent]);
  const flags = useMemo(() => getUiRedesignFlags(), []);
  const experiments = useMemo(() => getExperimentAssignments(), []);

  useEffect(() => {
    if (experiments.light_default_variant === 'dark-first' && flags.ui_redesign_dark_mode) {
      setThemeDark(true);
    }
  }, [experiments.light_default_variant, flags.ui_redesign_dark_mode]);

  useEffect(() => {
    variantTrackedRef.current = false;
    keyboardTrackedRef.current = false;
  }, [pathname]);

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.theme = themeDark ? 'dark' : 'light';
    root.classList.toggle('theme-dark', themeDark);
  }, [themeDark]);

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
        variant: flags.ui_redesign_shell ? 'redesign-shell' : 'legacy-shell',
        lcp_ms: metrics.lcp_ms,
        inp_ms: metrics.inp_ms,
        cls: metrics.cls,
      });
    },
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
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
    <div className={cn('min-h-screen bg-surface-base text-ink', className)}>
      <TopBar
        workspaceName={workspaceName}
        searchValue={searchValue}
        onSearchChange={setSearchValue}
        onOpenNav={() => setLeftNavOpen(true)}
        onToggleContext={() => setContextOpen((prev) => !prev)}
        onToggleTheme={flags.ui_redesign_dark_mode ? () => setThemeDark((prev) => !prev) : undefined}
        isDark={themeDark}
        showThemeToggle={flags.ui_redesign_dark_mode}
      />

      <div className="mx-auto flex w-full max-w-[1680px]">
        <aside className="hidden min-h-[calc(100vh-4rem)] border-r border-border/70 bg-surface-raised/60 md:block">
          <div className="sticky top-16">
            <LeftNav
              currentPath={pathname}
              collapsed={leftNavCollapsed}
              onToggleCollapsed={() => setLeftNavCollapsed((prev) => !prev)}
            />
          </div>
        </aside>

        {leftNavOpen ? (
          <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-label="Navigation menu" aria-modal="true">
            <button
              type="button"
              className="absolute inset-0 bg-ink/25 backdrop-blur-[2px]"
              aria-label="Close navigation menu"
              onClick={() => setLeftNavOpen(false)}
            />
            <div className="absolute inset-y-0 left-0 flex w-[304px] max-w-[90vw] flex-col border-r border-border bg-surface-raised shadow-[0_28px_68px_rgba(15,23,42,0.25)]">
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span className="text-label-m text-ink">Navigation</span>
                <button
                  type="button"
                  aria-label="Close navigation menu"
                  onClick={() => setLeftNavOpen(false)}
                  className="inline-grid h-10 w-10 place-items-center rounded-[var(--radius-control)] border border-border bg-surface-raised text-secondary hover:bg-surface-tint focus-visible:outline-none focus-visible:shadow-[var(--focus-ring)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <LeftNav currentPath={pathname} onNavigate={() => setLeftNavOpen(false)} className="w-full border-r-0" />
            </div>
          </div>
        ) : null}

        <main className="min-w-0 flex-1">
          <div className="flex min-h-[calc(100vh-4rem)] w-full">
            <section className="min-w-0 flex-1 px-4 py-5 sm:px-6 sm:py-7 lg:px-10 lg:py-8 xl:px-12">
              <PageHeader
                title={title}
                subtitle={subtitle}
                lifecycle={lifecycle}
                actions={actions}
                secondaryActions={secondaryActions}
                breadcrumbs={breadcrumbs}
              />
              <div className="pt-6 sm:pt-7">{children}</div>
            </section>

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
        </main>
      </div>
    </div>
  );
}
