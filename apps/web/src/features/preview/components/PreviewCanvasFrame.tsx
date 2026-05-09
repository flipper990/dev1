import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { cn } from '../../../../lib/cn';

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
}

const DEVICE_LAYOUT: Record<PreviewDevice, { maxWidth: string; viewportHeightClass: string; label: string; icon: typeof Monitor }> = {
  desktop: { maxWidth: '100%', viewportHeightClass: 'h-[min(68vh,760px)] min-h-[340px]', label: 'Desktop', icon: Monitor },
  tablet: { maxWidth: '900px', viewportHeightClass: 'h-[min(72vh,840px)] min-h-[420px]', label: 'Tablet', icon: Tablet },
  mobile: { maxWidth: '430px', viewportHeightClass: 'h-[min(78vh,900px)] min-h-[520px]', label: 'Mobile', icon: Smartphone },
};

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
}: PreviewCanvasFrameProps) {
  const status = ready ? 'Ready' : failed ? 'Failed' : loading ? 'Starting' : 'Idle';

  return (
    <section
      aria-label={title}
      className={cn('rounded-[var(--radius-modal)] border border-border bg-surface-raised p-4 sm:p-5', className)}
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-title-s text-ink">{title}</h3>
          <p className="mt-1 text-body-s text-secondary">Primary product output for review and QA.</p>
        </div>
        <span className="rounded-[var(--radius-control)] border border-border bg-surface-tint px-2.5 py-1 text-label-s text-secondary">
          {status}
        </span>
      </div>

      <div role="tablist" aria-label="Preview viewport" className="mb-3 inline-flex items-center rounded-[var(--radius-control)] border border-border bg-surface-tint p-1">
        {(Object.keys(DEVICE_LAYOUT) as PreviewDevice[]).map((key) => {
          const Icon = DEVICE_LAYOUT[key].icon;
          const active = key === device;
          return (
            <button
              key={key}
              type="button"
              onClick={() => onDeviceChange?.(key)}
              role="tab"
              id={`preview-device-${key}-tab`}
              aria-controls={`preview-device-${key}-panel`}
              aria-selected={active}
              className={cn(
                'inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] px-3 text-label-s transition-colors',
                active ? 'bg-surface-raised text-ink shadow-card' : 'text-secondary hover:text-ink',
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
          className="mx-auto overflow-hidden rounded-[16px] border border-border bg-surface-raised shadow-[0_20px_40px_rgba(15,23,42,0.16)]"
          style={{ maxWidth: DEVICE_LAYOUT[device].maxWidth }}
        >
          <div className="flex items-center gap-2 border-b border-border bg-surface-tint px-3 py-2">
            <span className="h-2.5 w-2.5 rounded-full bg-[#ff5f57]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#ffbd2e]" />
            <span className="h-2.5 w-2.5 rounded-full bg-[#28c840]" />
            <div className="ml-2 flex-1 truncate rounded bg-surface-raised px-2 py-1 text-[11px] text-secondary">
              {url ?? 'Preview URL'}
            </div>
          </div>

          <div
            role="tabpanel"
            id={`preview-device-${device}-panel`}
            aria-labelledby={`preview-device-${device}-tab`}
            className={cn('bg-white', DEVICE_LAYOUT[device].viewportHeightClass)}
          >
            {ready && url ? (
              <iframe title="Project preview" src={url} className="h-full w-full border-0 bg-white" />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center text-body-s text-secondary">
                {message ?? (failed ? 'Preview failed. Review evidence from the diagnostics panel.' : 'Preview output will appear here.')}
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
