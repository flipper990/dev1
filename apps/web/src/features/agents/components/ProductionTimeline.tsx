import { Card, StatusDot } from '../../../../components/ui';

interface TimelineEvent {
  id: string;
  title: string;
  detail: string;
  owner: string;
  tone: 'neutral' | 'success' | 'warning' | 'error';
  runtime?: string;
  cost?: string;
}

interface ProductionTimelineProps {
  events: TimelineEvent[];
}

export function ProductionTimeline({ events }: ProductionTimelineProps) {
  return (
    <Card>
      <h3 className="text-title-s text-ink">Production timeline</h3>
      <ol className="mt-4 space-y-3">
        {events.map((event) => (
          <li key={event.id} className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h4 className="text-label-m text-ink">{event.title}</h4>
                <p className="mt-1 text-body-s text-secondary">{event.detail}</p>
              </div>
              <StatusDot tone={event.tone} label={event.owner} />
            </div>
            {(event.runtime || event.cost) ? (
              <p className="mt-2 text-label-s text-secondary">
                {event.runtime ? `Runtime: ${event.runtime}` : ''}
                {event.runtime && event.cost ? ' | ' : ''}
                {event.cost ? `Cost: ${event.cost}` : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </Card>
  );
}
