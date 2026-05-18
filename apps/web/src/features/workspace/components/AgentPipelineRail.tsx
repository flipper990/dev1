import { AlertTriangle, CheckCircle2, CircleDashed, RotateCw, ShieldCheck, XCircle } from 'lucide-react';
import { StatusDot } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../../projects/model';
import type { TimelineEvent } from '../../agents/components/ProductionTimeline';
import { cn } from '../../../../lib/cn';

interface AgentPipelineRailProps {
  events: TimelineEvent[];
  status: UnifiedProjectStatus;
}

function stateForEvent(event: TimelineEvent): 'pending' | 'running' | 'success' | 'warning' | 'failed' {
  if (event.state) return event.state;
  if (event.tone === 'success') return 'success';
  if (event.tone === 'warning') return 'warning';
  if (event.tone === 'error') return 'failed';
  return 'pending';
}

function stateIcon(state: ReturnType<typeof stateForEvent>) {
  if (state === 'running') return CircleDashed;
  if (state === 'success') return CheckCircle2;
  if (state === 'warning') return AlertTriangle;
  if (state === 'failed') return XCircle;
  return RotateCw;
}

export function AgentPipelineRail({ events, status }: AgentPipelineRailProps) {
  const running = events.filter((event) => stateForEvent(event) === 'running').length;
  const failed = events.filter((event) => stateForEvent(event) === 'failed').length;
  const warnings = events.filter((event) => stateForEvent(event) === 'warning').length;
  const successful = events.filter((event) => stateForEvent(event) === 'success').length;

  return (
    <section aria-label="Agent pipeline rail" className="space-y-3.5">
      <div className="rounded-[var(--radius-panel)] border border-border-muted bg-surface-base p-3.5">
        <p className="text-label-s uppercase tracking-[0.14em] text-text-muted">Live orchestration</p>
        <h3 className="mt-1 text-title-s text-text-primary">Agent pipeline</h3>
        <p className="mt-1 text-body-s text-text-secondary">Runtime graph for active workers, checks, retries, and verification gates.</p>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className="rounded-full border border-border-muted bg-surface-tint px-2 py-1 text-label-s text-text-secondary">Running {running}</span>
          <span className="rounded-full border border-border-muted bg-surface-tint px-2 py-1 text-label-s text-text-secondary">Passed {successful}</span>
          <span className="rounded-full border border-border-muted bg-surface-tint px-2 py-1 text-label-s text-text-secondary">Warnings {warnings}</span>
          <span className="rounded-full border border-border-muted bg-surface-tint px-2 py-1 text-label-s text-text-secondary">Failures {failed}</span>
        </div>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-border-muted bg-surface-base p-3.5">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h4 className="text-label-m text-text-primary">Execution stream</h4>
          <StatusDot tone={status.healthy ? 'success' : 'warning'} label={status.label} />
        </div>

        <div className="relative">
          <span aria-hidden="true" className="absolute bottom-2 left-2 top-2 w-px bg-border-muted" />
          <ol className="space-y-1.5 pl-4">
          {events.slice(-7).map((event, index) => {
            const stepState = stateForEvent(event);
            const Icon = stateIcon(stepState);
            return (
              <li key={event.id} className="relative rounded-[12px] border border-border-muted/70 bg-surface-tint/72 p-2.5">
                <span aria-hidden="true" className="absolute -left-[14px] top-4 h-2 w-2 rounded-full bg-border-strong" />
                <div className="flex items-start gap-2.5">
                  <span
                    className={cn(
                      'mt-0.5 inline-grid h-5 w-5 shrink-0 place-items-center rounded-full border border-border bg-surface-raised',
                      stepState === 'running' && 'animate-pulse',
                    )}
                  >
                    <Icon className={cn('h-3.5 w-3.5 text-text-secondary', stepState === 'running' && 'animate-spin motion-reduce:animate-none')} />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-label-s text-text-muted">Step {Math.max(events.length - 6, 1) + index} - {event.owner}</p>
                    <p className="truncate text-body-s text-text-primary">{event.title}</p>
                    <p className="mt-0.5 line-clamp-2 text-label-s text-text-secondary">{event.detail}</p>
                    {event.evidence?.length ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {event.evidence.slice(0, 2).map((item) => (
                          <span key={item} className="rounded-full border border-border-muted bg-surface-raised px-2 py-0.5 text-[11px] leading-4 text-text-secondary">
                            {item}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              </li>
            );
          })}
          </ol>
        </div>
      </div>

      <div className="rounded-[var(--radius-panel)] border border-border-muted bg-surface-base p-3.5">
        <p className="inline-flex items-center gap-1.5 text-label-s text-text-muted"><ShieldCheck className="h-3.5 w-3.5 text-brand-primary" /> Trust channel</p>
        <p className="mt-1 text-body-s text-text-secondary">Pipeline state is evidence-backed from runtime status, verification checks, and preview health.</p>
      </div>
    </section>
  );
}
