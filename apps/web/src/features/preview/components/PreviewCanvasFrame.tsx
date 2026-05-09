interface PreviewCanvasFrameProps {
  title?: string;
  url?: string | null;
  ready?: boolean;
  failed?: boolean;
  loading?: boolean;
  message?: string;
}

export function PreviewCanvasFrame({
  title = 'Preview canvas',
  url,
  ready = false,
  failed = false,
  loading = false,
  message,
}: PreviewCanvasFrameProps) {
  return (
    <section aria-label={title} className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-title-s text-ink">{title}</h3>
        <span className="text-label-s text-secondary">
          {ready ? 'Ready' : failed ? 'Failed' : loading ? 'Starting' : 'Idle'}
        </span>
      </div>
      <div className="min-h-[360px] overflow-hidden rounded-[var(--radius-panel)] border border-border bg-surface-tint">
        {ready && url ? (
          <iframe title="Project preview" src={url} className="h-[420px] w-full bg-white" />
        ) : (
          <div className="flex h-[420px] items-center justify-center px-6 text-center text-body-s text-secondary">
            {message ?? (failed ? 'Preview failed. Review build evidence and runtime logs.' : 'Preview output will appear here.')}
          </div>
        )}
      </div>
    </section>
  );
}
