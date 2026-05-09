import { AlertTriangle, CheckCircle2, Clock3, Loader2, RotateCcw, XCircle } from 'lucide-react';
import { Button } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';
import type { WorkflowTimelineViewModel, WorkflowStepState } from '../model/project-status';

interface ProjectStageTimelineProps {
  timeline: WorkflowTimelineViewModel;
  onRetryStep?: (stepId: string) => void;
}

const stateMeta: Record<
  WorkflowStepState,
  {
    dotClass: string;
    titleClass: string;
    Icon: typeof CheckCircle2;
    label: string;
  }
> = {
  pending: {
    dotClass: 'border-border bg-surface-tint text-text-secondary',
    titleClass: 'text-text-secondary',
    Icon: Clock3,
    label: 'Pending',
  },
  running: {
    dotClass: 'border-brand-primary bg-brand-primary-subtle text-brand-primary',
    titleClass: 'text-text-primary',
    Icon: Loader2,
    label: 'In progress',
  },
  success: {
    dotClass: 'border-status-success bg-status-success-subtle text-status-success',
    titleClass: 'text-text-primary',
    Icon: CheckCircle2,
    label: 'Completed',
  },
  warning: {
    dotClass: 'border-status-warning bg-status-warning-subtle text-status-warning',
    titleClass: 'text-text-primary',
    Icon: AlertTriangle,
    label: 'Needs attention',
  },
  failed: {
    dotClass: 'border-status-error bg-status-error-subtle text-status-error',
    titleClass: 'text-text-primary',
    Icon: XCircle,
    label: 'Failed',
  },
};

export function ProjectStageTimeline({ timeline, onRetryStep }: ProjectStageTimelineProps) {
  return (
    <section aria-label={timeline.heading} className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-title-s text-text-primary">{timeline.heading}</h3>
          <p className="mt-1 text-body-s text-text-secondary">{timeline.summary}</p>
        </div>
        <span className="rounded-[var(--radius-control)] border border-border bg-surface-tint px-2.5 py-1 text-label-s text-text-secondary">
          Current: {timeline.steps.find((s) => s.id === timeline.currentStepId)?.label}
        </span>
      </div>

      <ol className="mt-5 space-y-3">
        {timeline.steps.map((step, index) => {
          const meta = stateMeta[step.state];
          const Icon = meta.Icon;
          const isRunning = step.state === 'running';

          return (
            <li key={step.id} className="relative rounded-[var(--radius-control)] border border-border bg-surface-tint/70 p-3 sm:p-4">
              {index < timeline.steps.length - 1 ? (
                <span aria-hidden="true" className="absolute left-[1.03rem] top-[3rem] h-[calc(100%-1.5rem)] w-px bg-border sm:left-[1.12rem]" />
              ) : null}

              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn('z-[1] inline-grid h-8 w-8 shrink-0 place-items-center rounded-full border', meta.dotClass)}
                >
                  <Icon className={cn('h-4 w-4', isRunning && 'animate-spin motion-reduce:animate-none')} />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className={cn('text-label-m font-semibold', meta.titleClass)}>{step.label}</h4>
                    <span className="rounded-[var(--radius-control)] border border-border bg-surface-raised px-2 py-0.5 text-label-s text-text-secondary">
                      {meta.label}
                    </span>
                    {step.timestampLabel ? (
                      <span className="text-label-s text-text-secondary">Updated {step.timestampLabel}</span>
                    ) : null}
                  </div>
                  <p className="mt-1 text-body-s text-text-secondary">{step.description}</p>

                  {step.metadata?.length ? (
                    <ul className="mt-2 flex flex-wrap gap-1.5">
                      {step.metadata.map((m) => (
                        <li key={m} className="rounded-[var(--radius-control)] border border-border bg-surface-raised px-2 py-1 text-label-s text-text-secondary">
                          {m}
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {step.canRetry ? (
                    <div className="mt-3">
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={!onRetryStep}
                        title={onRetryStep ? undefined : 'Retry is unavailable on this surface. Open the workspace to retry preview or refresh project evidence.'}
                        onClick={() => onRetryStep?.(step.id)}
                      >
                        <RotateCcw className="h-4 w-4" />
                        {onRetryStep ? 'Retry step' : 'Retry unavailable'}
                      </Button>
                      {!onRetryStep ? (
                        <p className="mt-2 text-label-s text-text-muted">Open the workspace to retry preview or refresh project evidence.</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
