import { cn } from '../../../../lib/cn';
import { PROJECT_STAGES } from '../model/project-status';
import type { ProjectStageKey } from '../model/project-status';

interface ProjectStageTimelineProps {
  currentStage: ProjectStageKey;
}

export function ProjectStageTimeline({ currentStage }: ProjectStageTimelineProps) {
  const activeIndex = PROJECT_STAGES.findIndex((stage) => stage.key === currentStage);

  return (
    <section aria-label="Project lifecycle" className="rounded-[var(--radius-panel)] border border-border bg-surface-raised p-4">
      <h3 className="text-title-s text-ink">Lifecycle</h3>
      <ol className="mt-4 grid gap-2 sm:grid-cols-4">
        {PROJECT_STAGES.map((stage, index) => {
          const complete = index < activeIndex;
          const active = index === activeIndex;
          return (
            <li key={stage.key} className="flex items-center gap-2">
              <span
                aria-hidden="true"
                className={cn(
                  'inline-grid h-7 w-7 place-items-center rounded-full border text-label-s',
                  complete && 'border-success bg-feedback-success-subtle text-success',
                  active && 'border-primary bg-primary-subtle text-primary',
                  !complete && !active && 'border-border bg-surface-tint text-secondary',
                )}
              >
                {index + 1}
              </span>
              <span className={cn('text-body-s', active ? 'text-ink' : 'text-secondary')}>
                {stage.label}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
