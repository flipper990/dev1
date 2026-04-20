'use client';
import { Info, AlertTriangle, XOctagon, ChevronUp, ChevronDown, Download, Trash2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { DashboardLog } from '../types/dashboard';

type FilterValue = 'all' | 'info' | 'warn' | 'error';

const FILTERS: { value: FilterValue; label: string }[] = [
  { value: 'all',   label: 'All'   },
  { value: 'info',  label: 'Info'  },
  { value: 'warn',  label: 'Warn'  },
  { value: 'error', label: 'Error' },
];

const LEVEL_ICON = {
  info:  <Info      size={11} className="text-[#3B82F6] flex-shrink-0" />,
  warn:  <AlertTriangle size={11} className="text-[#F59E0B] flex-shrink-0" />,
  error: <XOctagon  size={11} className="text-[#EF4444] flex-shrink-0" />,
} as const;

const LEVEL_TEXT = {
  info:  'text-[#3B82F6]',
  warn:  'text-[#F59E0B]',
  error: 'text-[#EF4444]',
} as const;

function sourceClass(source: string): string {
  const s = source.toLowerCase();
  if (s.includes('planner') || s.includes('architect')) return 'log-src-planner';
  if (s.includes('coder')   || s.includes('developer')) return 'log-src-coder';
  if (s.includes('review'))                              return 'log-src-reviewer';
  if (s.includes('test')    || s.includes('qa'))         return 'log-src-tester';
  if (s.includes('devops')  || s.includes('deploy'))     return 'log-src-devops';
  return 'text-[#64748B]';
}

function exportLogs(logs: DashboardLog[]) {
  const lines = logs.map(
    (l) => `[${l.ts}] [${l.level.toUpperCase().padEnd(5)}] [${l.source}] ${l.message}`
  );
  const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `devteam-logs-${new Date().toISOString().slice(0, 10)}.log`;
  a.click();
  URL.revokeObjectURL(url);
}

export function LogsPanel() {
  const {
    logs, logsOpen, logFilter, logSearch,
    setLogsOpen, setLogFilter, setLogSearch, clearLogs,
  } = useStore();

  const errCount = logs.filter((l) => l.level === 'error').length;
  const visible  = logs.filter((l) => {
    if (logFilter !== 'all' && l.level !== logFilter) return false;
    if (logSearch && !l.message.toLowerCase().includes(logSearch.toLowerCase())
      && !l.source.toLowerCase().includes(logSearch.toLowerCase())) return false;
    return true;
  });

  return (
    <div
      className="flex-shrink-0 border-t border-white/[0.06] bg-[#07090f]/80 flex flex-col overflow-hidden transition-[height] duration-150"
      style={{ height: logsOpen ? 'var(--logs-h)' : 'var(--logs-bar-h)' }}
    >
      {/* Bar */}
      <div
        className="flex items-center gap-2 px-3 flex-shrink-0 cursor-pointer select-none hover:bg-white/[0.03] transition-colors"
        style={{ height: 'var(--logs-bar-h)' }}
        onClick={() => setLogsOpen(!logsOpen)}
      >
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">Logs</span>

        {/* Count badge */}
        <span className={cn(
          'flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] border',
          errCount > 0
            ? 'text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/[0.08]'
            : 'text-[#64748B] border-white/[0.06] bg-white/[0.04]',
        )}>
          {errCount > 0 && <XOctagon size={8} />}
          {errCount > 0 ? `${errCount} err` : visible.length}
        </span>

        {logsOpen && (
          <>
            <div className="flex-1" onClick={(e) => e.stopPropagation()} />

            {/* Filter pills */}
            <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
              {FILTERS.map((f) => (
                <button
                  key={f.value}
                  onClick={(e) => { e.stopPropagation(); setLogFilter(f.value); }}
                  className={cn(
                    'px-2.5 py-0.5 rounded-full text-[10px] font-semibold border transition-colors',
                    logFilter === f.value
                      ? f.value === 'all'   ? 'text-[#F1F5F9]  border-white/10    bg-white/[0.10]'
                      : f.value === 'info'  ? 'text-[#3B82F6]  border-[#3B82F6]/30  bg-[#3B82F6]/[0.08]'
                      : f.value === 'warn'  ? 'text-[#F59E0B]  border-[#F59E0B]/30  bg-[#F59E0B]/[0.08]'
                      :                      'text-[#EF4444]  border-[#EF4444]/30  bg-[#EF4444]/[0.08]'
                      : 'text-[#64748B] border-transparent hover:border-white/[0.06] hover:text-[#CBD5E1]',
                  )}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Search */}
            <input
              className="bg-white/[0.04] border border-white/[0.06] rounded px-2.5 py-1 text-[11px] text-[#F1F5F9] outline-none placeholder:text-[#475569] focus:border-white/10 w-32 transition-colors"
              placeholder="Search…"
              value={logSearch}
              onChange={(e) => setLogSearch(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />

            <button
              title="Export logs"
              className="flex items-center justify-center w-6 h-6 rounded text-[#64748B] hover:bg-white/[0.06] hover:text-[#F1F5F9] transition-colors"
              onClick={(e) => { e.stopPropagation(); exportLogs(visible); }}
            >
              <Download size={13} />
            </button>
            <button
              title="Clear logs"
              className="flex items-center justify-center w-6 h-6 rounded text-[#64748B] hover:bg-white/[0.06] hover:text-[#EF4444] transition-colors"
              onClick={(e) => { e.stopPropagation(); clearLogs(); }}
            >
              <Trash2 size={13} />
            </button>
          </>
        )}

        <span className="text-[#475569] flex-shrink-0 ml-auto pl-2">
          {logsOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
        </span>
      </div>

      {/* Entries */}
      {logsOpen && (
        <div className="flex-1 overflow-y-auto px-2 py-1 flex flex-col gap-0.5">
          {visible.length === 0 && (
            <div className="py-6 text-center text-[#64748B] text-[12px]">No log entries.</div>
          )}
          {visible.map((entry) => (
            <LogEntry key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function LogEntry({ entry }: { entry: DashboardLog }) {
  const level = (entry.level as keyof typeof LEVEL_ICON) in LEVEL_ICON
    ? (entry.level as keyof typeof LEVEL_ICON)
    : 'info';

  return (
    <div className="grid items-baseline gap-2 px-1.5 py-1 rounded hover:bg-white/[0.03] transition-colors font-mono text-[11px]"
      style={{ gridTemplateColumns: '52px 16px 60px 1fr' }}>
      <span className="text-[#475569] text-[10px]">{entry.ts}</span>
      {LEVEL_ICON[level]}
      <span className={cn('overflow-hidden text-ellipsis whitespace-nowrap text-[10px]', sourceClass(entry.source))}
        title={entry.source}>
        {entry.source.slice(0, 10)}
      </span>
      <span className="text-[#CBD5E1] overflow-hidden text-ellipsis whitespace-nowrap" title={entry.message}>
        {entry.message}
      </span>
    </div>
  );
}
