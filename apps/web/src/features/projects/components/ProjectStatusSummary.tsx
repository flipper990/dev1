import { AlertTriangle, CheckCircle2, Clock3, Loader2, Rocket, Wrench } from 'lucide-react';
import { Button, Card } from '../../../../components/ui';
import type { UnifiedProjectStatus, WorkflowTimelineViewModel } from '../model/project-status';

interface ProjectStatusSummaryProps {
  status: UnifiedProjectStatus;
  timeline?: WorkflowTimelineViewModel;
  onPrimaryAction?: () => void;
}

function getPrimaryActionLabel(status: UnifiedProjectStatus): string {
  if (status.key === 'launch-ready') return 'Open deploy flow';
  if (status.key === 'preview-failed') return 'Retry preview';
  if (status.key === 'verification-pending') return 'Run verification';
  if (status.key === 'stale') return 'Refresh state';
  return status.nextActionLabel;
}

function getPrimaryActionIcon(status: UnifiedProjectStatus) {
  if (status.key === 'launch-ready') return Rocket;
  if (status.key === 'preview-failed') return Wrench;
  if (status.key === 'verification-pending') return CheckCircle2;
  if (status.key === 'stale') return AlertTriangle;
  if (status.key === 'generating' || status.key === 'preview-starting') return Loader2;
  return Clock3;
}

export function ProjectStatusSummary({
  status,
  timeline,
  onPrimaryAction,
}: ProjectStatusSummaryProps) {
  const currentStep = timeline?.steps.find((s) => s.id === timeline.currentStepId);
  const ActionIcon = getPrimaryActionIcon(status);
  const isLoading = status.key === 'generating' || status.key === 'preview-starting';

  return (
    <Card>
      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-title-s text-text-primary">Lifecycle progress</h3>
            <p className="mt-1 text-body-s text-text-secondary">{status.description}</p>
          </div>
        </div>

        <div className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
          <p className="text-label-s text-text-secondary">Current activity</p>
          <p className="mt-1 text-body-s text-text-primary">
            {currentStep ? `${currentStep.label}: ${currentStep.description}` : 'Awaiting next action.'}
          </p>
          {currentStep?.metadata?.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {currentStep.metadata.map((item) => (
                <li key={item} className="rounded-[var(--radius-control)] border border-border bg-surface-raised px-2 py-1 text-label-s text-text-secondary">
                  {item}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="flex flex-col items-start gap-2 sm:items-end">
          <Button
            onClick={onPrimaryAction}
            disabled={!onPrimaryAction}
            title={onPrimaryAction ? undefined : 'Open this project in the workspace to run the next action.'}
          >
            <ActionIcon className={isLoading ? 'h-4 w-4 animate-spin motion-reduce:animate-none' : 'h-4 w-4'} />
            {onPrimaryAction ? getPrimaryActionLabel(status) : 'Action unavailable'}
          </Button>
          {!onPrimaryAction ? <p className="text-label-s text-text-muted">Open the workspace to run project actions.</p> : null}
        </div>
      </div>
    </Card>
  );
}
