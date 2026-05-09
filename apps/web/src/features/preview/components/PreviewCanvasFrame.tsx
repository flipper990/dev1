'use client';

import { useState } from 'react';
import { AlertTriangle, Copy, ExternalLink, Loader2, Monitor, RefreshCw, Smartphone, Tablet } from 'lucide-react';
import { Badge, Button, IconButton, StatusDot } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import { previewToneToBadge, previewToneToStatusDot, type PreviewTruthModel } from '../model';

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

interface PreviewCanvasFrameProps {
  title?: string;
  url?: string | null;
  ready?: boolean;
  failed?: boolean;
  loading?: boolean;
  message?: string;
  device?: PreviewDevice;
  onDeviceChange?: (device: PreviewDevice) => void;
  className?: string;
  previewTruth?: PreviewTruthModel;
  runtimeType?: string | null;
  onRetry?: () => void;
  retrying?: boolean;
}

const DEVICE_LAYOUT: Record<PreviewDevice, { maxWidth: string; viewportHeightClass: string; label: string; icon: typeof Monitor }> = {
  desktop: { maxWidth: '100%', viewportHeightClass: 'h-[min(68vh,760px)] min-h-[340px]', label: 'Desktop', icon: Monitor },
  tablet: { maxWidth: '900px', viewportHeightClass: 'h-[min(72vh,840px)] min-h-[420px]', label: 'Tablet', icon: Tablet },
  mobile: { maxWidth: '430px', viewportHeightClass: 'h-[min(78vh,900px)] min-h-[520px]', label: 'Mobile', icon: Smartphone },
};

function fallbackTruth(ready: boolean, failed: boolean, loading: boolean, url?: string | null): PreviewTruthModel {
  return {
    projectStatus: loading ? 'generating' : failed ? 'failed' : 'completed',
    previewTransportStatus: ready ? 'reachable' : failed ? 'failed' : loading ? 'starting' : 'idle',
    previewHealthStatus: ready ? 'healthy' : 'unknown',
    label: ready ? 'Preview Ready' : failed ? 'Preview Failed' : loading ? 'Preview Starting' : 'Preview Idle',
    description: ready ? 'Transport is reachable and content health is healthy.' : failed ? 'Preview failed before becoming reachable.' : loading ? 'Runtime is starting.' : 'No preview runtime has been started.',
    tone: ready ? 'success' : failed ? 'error' : loading ? 'active' : 'neutral',
    canRenderIframe: ready && Boolean(url),
    canOpenUrl: ready && Boolean(url),
    isLoading: loading,
    isFailure: failed,
    isBroken: false,
    isPlaceholder: false,
    isHealthy: ready,
    exactReason: null,
    runtimeType: null,
    previewUrl: url ?? null,
    reproduceCommand: '',
    contradictions: [],
  };
}

function PreviewStateCard({ truth, message, onRetry, retrying }: { truth: PreviewTruthModel; message?: string; onRetry?: () => void; retrying?: boolean }) {
  const isActive = truth.isLoading;
  const isProblem = truth.isFailure || truth.isBroken || truth.isPlaceholder;

  return (
    <div className="flex h-full items-center justify-center px-5 py-8 text-center">
      <div className="max-w-xl rounded-[var(--radius-panel)] border border-border-muted bg-surface-raised p-5 shadow-card">
        <div className="mx-auto inline-grid h-11 w-11 place-items-center rounded-full border border-border bg-surface-tint text-text-secondary">
          {isActive ? <Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" /> : <AlertTriangle className="h-5 w-5" />}
        </div>
        <h4 className="mt-4 text-title-s text-text-primary">{truth.label}</h4>
        <p className="mt-2 text-body-s text-text-secondary">{truth.description || message}</p>
        {truth.exactReason ? (
          <p className="mt-3 rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3 text-left font-mono text-mono-s text-text-secondary">
            {truth.exactReason}
          </p>
        ) : null}
        {truth.contradictions.length ? (
          <ul className="mt-3 space-y-2 text-left text-body-s text-status-warning">
            {truth.contradictions.map((item) => <li key={item}>{item}</li>)}
          </ul>
        ) : null}
        {isProblem && onRetry ? (
          <div className="mt-4 flex justify-center">
            <Button variant="secondary" loading={retrying} onClick={onRetry}>
              <RefreshCw className="h-4 w-4" /> Retry preview
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export function PreviewCanvasFrame({
  title = 'Preview canvas',
  url,
  ready = false,
  failed = false,
  loading = false,
  message,
  device = 'desktop',
  onDeviceChange,
  className,
  previewTruth,
  runtimeType,
  onRetry,
  retrying = false,
}: PreviewCanvasFrameProps) {
  const [copied, setCopied] = useState(false);
  const truth = previewTruth ?? fallbackTruth(ready, failed, loading, url);
  const effectiveUrl = truth.previewUrl ?? url ?? null;
  const canOpen = truth.canOpenUrl && Boolean(effectiveUrl);

  const copyPreviewUrl = async () => {
    if (!effectiveUrl) return;
    try {
      await navigator.clipboard.writeText(effectiveUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section
      aria-label={title}
      className={cn('rounded-[var(--radius-modal)] border border-border bg-surface-raised p-4 sm:p-5', className)}
    >
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-title-s text-text-primary">{title}</h3>
          <p className="mt-1 text-body-s text-text-secondary">Primary product output for review and QA.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={previewToneToBadge(truth.tone)}>{truth.label}</Badge>
            <StatusDot tone={previewToneToStatusDot(truth.tone)} label={`Transport: ${truth.previewTransportStatus}`} />
            <StatusDot tone={truth.previewHealthStatus === 'healthy' ? 'success' : truth.previewHealthStatus === 'broken' ? 'error' : truth.previewHealthStatus === 'placeholder' ? 'warning' : 'neutral'} label={`Health: ${truth.previewHealthStatus}`} />
            {runtimeType || truth.runtimeType ? <Badge variant="neutral">Runtime: {runtimeType ?? truth.runtimeType}</Badge> : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <IconButton
            icon={<Copy className="h-4 w-4" />}
            label={copied ? 'Preview URL copied' : 'Copy preview URL'}
            disabled={!effectiveUrl}
            onClick={copyPreviewUrl}
          />
          {effectiveUrl ? (
            <a href={effectiveUrl} target="_blank" rel="noreferrer" aria-disabled={!canOpen} className={cn(!canOpen && 'pointer-events-none opacity-55')}>
              <IconButton icon={<ExternalLink className="h-4 w-4" />} label="Open preview in new tab" disabled={!canOpen} />
            </a>
          ) : (
            <IconButton icon={<ExternalLink className="h-4 w-4" />} label="Open preview in new tab" disabled />
          )}
          {onRetry ? <Button variant="secondary" size="sm" loading={retrying} onClick={onRetry}>Retry</Button> : null}
        </div>
      </div>

      <div role="tablist" aria-label="Preview viewport" className="mb-3 inline-flex max-w-full items-center overflow-x-auto rounded-[var(--radius-control)] border border-border bg-surface-tint p-1">
        {(Object.keys(DEVICE_LAYOUT) as PreviewDevice[]).map((key) => {
          const Icon = DEVICE_LAYOUT[key].icon;
          const active = key === device;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDeviceChange?.(key)}
              disabled={!onDeviceChange}
              role="tab"
              id={`preview-device-${key}-tab`}
              aria-controls={`preview-device-${key}-panel`}
              aria-selected={active}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-label-s transition-colors',
                active ? 'bg-surface-raised text-text-primary shadow-card' : 'text-text-secondary hover:text-text-primary',
                !onDeviceChange && 'cursor-not-allowed opacity-55 hover:text-text-secondary',
              )}
            >
              <Icon className="h-4 w-4" />
              {DEVICE_LAYOUT[key].label}
            </button>
          );
        })}
      </div>

      <div className="rounded-[var(--radius-panel)] border border-border bg-surface-tint p-2 sm:p-3">
        <div
          className="mx-auto overflow-hidden rounded-[var(--radius-preview)] border border-border bg-surface-raised shadow-lg"
          style={{ maxWidth: DEVICE_LAYOUT[device].maxWidth }}
        >
          <div className="flex items-center gap-2 border-b border-border bg-surface-tint px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-status-error" />
            <span className="h-2.5 w-2.5 rounded-full bg-status-warning" />
            <span className="h-2.5 w-2.5 rounded-full bg-status-success" />
            <div className="ml-2 min-w-0 flex-1 truncate rounded bg-surface-raised px-2 py-1 font-mono text-mono-s text-text-secondary">
              {effectiveUrl ?? 'Preview URL unavailable'}
            </div>
          </div>

          <div
            role="tabpanel"
            id={`preview-device-${device}-panel`}
            aria-labelledby={`preview-device-${device}-tab`}
            className={cn('bg-surface-base', DEVICE_LAYOUT[device].viewportHeightClass)}
          >
            {truth.canRenderIframe && effectiveUrl ? (
              <iframe title="Project preview" src={effectiveUrl} className="h-full w-full border-0 bg-surface-base" />
            ) : (
              <PreviewStateCard truth={truth} message={message} onRetry={onRetry} retrying={retrying} />
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
