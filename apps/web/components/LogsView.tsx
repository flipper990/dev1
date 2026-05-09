import { useState } from 'react';
import { ChevronDown, ChevronUp, TerminalSquare } from 'lucide-react';
import type { DashboardLog } from '../types/dashboard';
import { cn } from '../lib/cn';

interface LogsViewProps {
  logs: DashboardLog[];
  defaultExpanded?: boolean;
}

export function LogsView({ logs, defaultExpanded = false }: LogsViewProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  return (
    <section className="rounded-[var(--radius-panel)] border border-border bg-surface-raised">
      <div className="flex items-center justify-between gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="inline-grid h-8 w-8 place-items-center rounded-[var(--radius-control)] bg-surface-tint text-secondary">
            <TerminalSquare className="h-4 w-4" />
          </span>
          <div>
            <h2 className="text-label-m text-ink">Technical logs</h2>
            <p className="text-[12px] text-secondary">Secondary diagnostics</p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="inline-flex items-center gap-1.5 rounded-[var(--radius-control)] border border-border bg-surface-tint px-2.5 py-1.5 text-label-s text-secondary hover:text-ink"
          aria-expanded={expanded}
        >
          {expanded ? 'Collapse' : 'Expand'}
          {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </button>
      </div>

      {expanded ? (
        <div className="border-t border-border">
          <div className="max-h-[22rem] overflow-auto">
            {logs.length === 0 ? (
              <div className="px-4 py-6 text-body-s text-secondary">No logs yet.</div>
            ) : (
              <ul className="divide-y divide-border/70">
                {logs.map((log) => (
                  <li key={log.id} className="grid grid-cols-[86px_72px_120px_1fr] gap-2 px-4 py-2.5 text-[12px]">
                    <span className="font-mono text-secondary">{log.ts}</span>
                    <span
                      className={cn(
                        'font-semibold uppercase tracking-[0.06em]',
                        log.level === 'error' ? 'text-error' : log.level === 'warn' ? 'text-warning' : 'text-secondary',
                      )}
                    >
                      {log.level}
                    </span>
                    <span className="truncate font-mono text-secondary" title={log.source}>
                      {log.source}
                    </span>
                    <span className="truncate text-ink" title={log.message}>
                      {log.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : null}
    </section>
  );
}
