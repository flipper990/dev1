import { CheckCircle2, CircleDashed, Clock3, TriangleAlert, XCircle } from 'lucide-react';
import { Card, StatusDot } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';

export type AgentStepState = 'pending' | 'running' | 'success' | 'warning' | 'failed';

export interface TimelineEvent {
  id: string;
  title: string;
  detail: string;
  owner: string;
  tone?: 'neutral' | 'success' | 'warning' | 'error';
  state?: AgentStepState;
  runtime?: string;
  cost?: string;
  evidence?: string[];
}

interface AgentStepCardProps {
  event: TimelineEvent;
  index: number;
}

interface ProductionTimelineProps {
  events: TimelineEvent[];
  heading?: string;
  summary?: string;
}

const stateTone: Record<AgentStepState, 'neutral' | 'active' | 'success' | 'warning' | 'error'> = {
  pending: 'neutral',
  running: 'active',
  success: 'success',
  warning: 'warning',
  failed: 'error',
};

const stateIcon = {
  pending: Clock3,
  running: CircleDashed,
  success: CheckCircle2,
  warning: TriangleAlert,
  failed: XCircle,
};

function getState(event: TimelineEvent): AgentStepState {
  if (event.state) return event.state;
  if (event.tone === 'success') return 'success';
  if (event.tone === 'warning') return 'warning';
  if (event.tone === 'error') return 'failed';
  return 'pending';
}

export function AgentStepCard({ event, index }: AgentStepCardProps) {
  const state = getState(event);
  const Icon = stateIcon[state];
  const evidence = event.evidence ?? [event.runtime ? `Runtime ${event.runtime}` : '', event.cost ? `Cost ${event.cost}` : ''].filter(Boolean);

  return (
    <li className="relative pl-10">
      <span className="absolute left-0 top-3 inline-grid h-7 w-7 place-items-center rounded-full border border-border bg-surface-raised text-text-secondary shadow-hairline">
        <Icon className={cn('h-4 w-4', state === 'running' && 'animate-spin motion-reduce:animate-none')} />
      </span>
      <div className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-label-s text-text-muted">Stage {index + 1}</p>
            <h4 className="mt-1 text-label-m text-text-primary">{event.title}</h4>
            <p className="mt-1 text-body-s text-text-secondary">{event.detail}</p>
          </div>
          <StatusDot tone={stateTone[state]} label={event.owner} />
        </div>
        {evidence.length ? (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {evidence.map((item) => (
              <li key={item} className="rounded-[var(--radius-control)] border border-border-muted bg-surface-raised px-2 py-1 text-[11px] text-text-secondary">
                {item}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </li>
  );
}

export function ProductionTimeline({ events, heading = 'Agent pipeline timeline', summary = 'Production stages are shown as evidence-bearing pipeline work, not roleplay agents.' }: ProductionTimelineProps) {
  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-title-s text-text-primary">{heading}</h3>
          <p className="mt-1 text-body-s text-text-secondary">{summary}</p>
        </div>
        <StatusDot tone={events.some((event) => getState(event) === 'failed') ? 'error' : events.some((event) => getState(event) === 'running') ? 'active' : 'success'} label="Pipeline" />
      </div>
      <ol className="relative mt-5 space-y-3 before:absolute before:left-3.5 before:top-4 before:h-[calc(100%-1rem)] before:w-px before:bg-border-muted">
        {events.map((event, index) => (
          <AgentStepCard key={event.id} event={event} index={index} />
        ))}
      </ol>
    </Card>
  );
}
