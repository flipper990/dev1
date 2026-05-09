import { Badge, Card } from '../../../../components/ui';

export interface LogEntry {
  id: string;
  timestamp: string;
  severity: 'info' | 'warning' | 'error';
  step: string;
  message: string;
  explanation?: string;
}

interface LogEvidenceViewProps {
  entries: LogEntry[];
}

const severityVariant: Record<LogEntry['severity'], 'neutral' | 'warning' | 'error'> = {
  info: 'neutral',
  warning: 'warning',
  error: 'error',
};

export function LogEvidenceView({ entries }: LogEvidenceViewProps) {
  if (entries.length === 0) {
    return (
      <Card>
        <h3 className="text-title-s text-text-primary">Log evidence</h3>
        <p className="mt-2 text-body-s text-text-secondary">No logs yet. Activity will appear here with step context and severity.</p>
      </Card>
    );
  }

  const grouped = entries.reduce<Record<string, LogEntry[]>>((acc, entry) => {
    acc[entry.step] = acc[entry.step] ? [...acc[entry.step], entry] : [entry];
    return acc;
  }, {});

  return (
    <Card>
      <h3 className="text-title-s text-text-primary">Log evidence</h3>
      <div className="mt-4 space-y-3">
        {Object.entries(grouped).map(([step, stepEntries]) => (
          <section key={step} className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
            <h4 className="text-label-m text-text-primary">{step}</h4>
            <ul className="mt-2 space-y-2">
              {stepEntries.map((entry) => (
                <li key={entry.id} className="rounded-[var(--radius-control)] border border-border bg-surface-raised p-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-label-s text-text-secondary">{new Date(entry.timestamp).toLocaleString()}</span>
                    <Badge variant={severityVariant[entry.severity]}>{entry.severity}</Badge>
                  </div>
                  <p className="mt-1 text-body-s text-text-primary">{entry.message}</p>
                  {entry.explanation ? <p className="mt-1 text-label-s text-text-secondary">Next: {entry.explanation}</p> : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Card>
  );
}
