'use client';

import { useRef, useEffect } from 'react';

interface LogEntry {
  id: number;
  level: 'info' | 'warn' | 'error';
  message: string;
  timestamp: string;
}

interface Props {
  logs: LogEntry[];
}

export function LogsView({ logs }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  return (
    <div className="panel" style={{ gridColumn: '1 / 2', gridRow: '2 / 3', overflow: 'hidden' }}>
      <div className="panel-header">
        <span>Logs</span>
        <span style={{ color: 'var(--text-2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
          {logs.length} entries
        </span>
      </div>
      <div className="panel-body" style={{ height: 'calc(100% - 40px)' }}>
        {logs.length === 0 ? (
          <div className="empty-state">
            <span>Waiting for activity…</span>
          </div>
        ) : (
          <div className="log-list">
            {logs.map((entry) => (
              <div key={entry.id} className={`log-entry ${entry.level}`}>
                <span className="ts">{entry.timestamp.slice(11, 23)}</span>
                {entry.message}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
