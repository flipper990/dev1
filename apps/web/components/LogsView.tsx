import type { DashboardLog } from '../types/dashboard';

interface LogsViewProps {
  logs: DashboardLog[];
}

export function LogsView({ logs }: LogsViewProps) {
  return (
    <section className="panel panel--logs">
      <div className="panel__header panel__header--split">
        <h2>Logs</h2>
        <span className="count-chip">{logs.length}</span>
      </div>

      <div className="log-list">
        {logs.length === 0 ? (
          <div className="empty-state">No logs yet.</div>
        ) : (
          logs.map((log) => (
            <div className="log-item" key={log.id}>
              <span className="mono log-item__time">{log.ts}</span>
              <span className={`log-item__level log-item__level--${log.level}`}>{log.level}</span>
              <span className="mono log-item__source">{log.source}</span>
              <span className="log-item__message">{log.message}</span>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
