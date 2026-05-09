'use client';

import { useMemo, useState } from 'react';
import {
  Monitor,
  Tablet,
  Smartphone,
  Share2,
  Download,
  Rocket,
  RefreshCw,
  ChevronDown,
  Activity,
  TerminalSquare,
  ExternalLink,
} from 'lucide-react';
import { cn } from '../lib/cn';
import { Button, Card } from './ui';

type Viewport = 'desktop' | 'tablet' | 'mobile';
type SecondaryTab = 'activity' | 'logs';

const VIEWPORTS: Array<{ id: Viewport; label: string; icon: typeof Monitor; maxWidth: string }> = [
  { id: 'desktop', label: 'Desktop', icon: Monitor, maxWidth: '100%' },
  { id: 'tablet', label: 'Tablet', icon: Tablet, maxWidth: '900px' },
  { id: 'mobile', label: 'Mobile', icon: Smartphone, maxWidth: '430px' },
];

interface LivePreviewProps {
  title?: string;
  previewUrl?: string | null;
  status?: 'idle' | 'starting' | 'ready' | 'failed';
  stackLabel?: string;
  updatedAtLabel?: string;
  onRefresh?: () => void;
  onShare?: () => void;
  onExport?: () => void;
  onDeploy?: () => void;
  className?: string;
}

export function LivePreview({
  title = 'Application preview',
  previewUrl,
  status = 'idle',
  stackLabel = 'Web app',
  updatedAtLabel,
  onRefresh,
  onShare,
  onExport,
  onDeploy,
  className,
}: LivePreviewProps) {
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [secondaryTab, setSecondaryTab] = useState<SecondaryTab>('activity');
  const [detailsOpen, setDetailsOpen] = useState(false);

  const viewportDef = useMemo(() => VIEWPORTS.find((v) => v.id === viewport) ?? VIEWPORTS[0], [viewport]);

  const statusPillClass =
    status === 'ready'
      ? 'bg-feedback-success-subtle text-success border-success/35'
      : status === 'failed'
        ? 'bg-feedback-error-subtle text-error border-error/35'
        : status === 'starting'
          ? 'bg-primary-subtle text-primary border-primary/35'
          : 'bg-surface-tint text-secondary border-border';

  const statusText =
    status === 'ready' ? 'Live preview ready' : status === 'failed' ? 'Preview unavailable' : status === 'starting' ? 'Preview starting' : 'No preview yet';

  return (
    <section className={cn('space-y-4', className)} aria-label="Project workspace preview">
      <Card className="p-0 overflow-hidden">
        <div className="border-b border-border/70 bg-surface-raised">
          <div className="flex flex-col gap-3 p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-label-s uppercase tracking-[0.08em] text-secondary">Preview</p>
                <h3 className="mt-1 text-title-m text-ink">{title}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-body-s">
                  <span className={cn('inline-flex items-center rounded-[var(--radius-control)] border px-2.5 py-1 text-label-s', statusPillClass)}>
                    {statusText}
                  </span>
                  <span className="text-secondary">Stack: {stackLabel}</span>
                  {updatedAtLabel ? <span className="text-secondary">Updated: {updatedAtLabel}</span> : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button variant="secondary" size="sm" onClick={onShare}>
                  <Share2 className="h-4 w-4" />
                  Share
                </Button>
                <Button variant="secondary" size="sm" onClick={onExport}>
                  <Download className="h-4 w-4" />
                  Export
                </Button>
                <Button size="sm" onClick={onDeploy}>
                  <Rocket className="h-4 w-4" />
                  Deploy
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="inline-flex items-center rounded-[var(--radius-control)] border border-border bg-surface-tint p-1">
                {VIEWPORTS.map((item) => {
                  const Icon = item.icon;
                  const active = item.id === viewport;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setViewport(item.id)}
                      className={cn(
                        'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-label-s transition-colors',
                        active ? 'bg-surface-raised text-ink shadow-card' : 'text-secondary hover:text-ink',
                      )}
                      aria-pressed={active}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </div>

              <div className="flex items-center gap-2">
                {previewUrl ? (
                  <a
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface-raised px-3 text-label-s text-secondary hover:text-ink"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open in new tab
                  </a>
                ) : null}
                <Button variant="ghost" size="sm" onClick={onRefresh}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-surface-tint/60 p-3 sm:p-4">
          <div
            className="mx-auto overflow-hidden rounded-[18px] border border-border bg-surface-raised shadow-[0_24px_56px_rgba(15,23,42,0.18)]"
            style={{ maxWidth: viewportDef.maxWidth }}
          >
            <div className="flex items-center gap-2 border-b border-border bg-surface-tint px-3 py-2">
              <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
              <div className="ml-2 flex-1 truncate rounded bg-surface-raised px-2 py-1 text-[11px] text-secondary">
                {previewUrl ?? 'Preview URL will appear here'}
              </div>
            </div>

            <div className="min-h-[560px] bg-white">
              {previewUrl && status !== 'failed' ? (
                <iframe title="Generated application preview" src={previewUrl} className="h-[560px] w-full border-0" />
              ) : (
                <div className="flex h-[560px] items-center justify-center px-6 text-center text-body-s text-secondary">
                  {status === 'failed'
                    ? 'Preview could not be loaded. Try refreshing or review diagnostics.'
                    : 'Run or resume generation to render the live application preview.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex items-center rounded-[var(--radius-control)] border border-border bg-surface-tint p-1">
              <button
                type="button"
                onClick={() => setSecondaryTab('activity')}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-label-s',
                  secondaryTab === 'activity' ? 'bg-surface-raised text-ink shadow-card' : 'text-secondary hover:text-ink',
                )}
              >
                <Activity className="h-4 w-4" />
                Activity
              </button>
              <button
                type="button"
                onClick={() => setSecondaryTab('logs')}
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-label-s',
                  secondaryTab === 'logs' ? 'bg-surface-raised text-ink shadow-card' : 'text-secondary hover:text-ink',
                )}
              >
                <TerminalSquare className="h-4 w-4" />
                Logs
              </button>
            </div>

            <button
              type="button"
              onClick={() => setDetailsOpen((v) => !v)}
              className="inline-flex items-center gap-1.5 text-label-s text-secondary hover:text-ink"
              aria-expanded={detailsOpen}
            >
              {detailsOpen ? 'Hide details' : 'Show details'}
              <ChevronDown className={cn('h-4 w-4 transition-transform', detailsOpen && 'rotate-180')} />
            </button>
          </div>

          {detailsOpen ? (
            <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3 text-body-s text-secondary">
              {secondaryTab === 'activity'
                ? 'Recent workspace activity and milestones appear here in a compact timeline.'
                : 'Technical logs remain available here when needed, but are intentionally secondary to product preview.'}
            </div>
          ) : null}
        </div>
      </Card>
    </section>
  );
}
