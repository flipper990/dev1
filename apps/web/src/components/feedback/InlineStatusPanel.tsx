import type { ReactNode } from 'react';
import { Badge, Card } from '../../../components/ui';

type PanelTone = 'neutral' | 'success' | 'warning' | 'error';

interface InlineStatusPanelProps {
  tone?: PanelTone;
  title: string;
  where?: string;
  whatWorked?: string;
  whatFailed?: string;
  nextAction?: string;
  actions?: ReactNode;
}

const toneVariant: Record<PanelTone, 'neutral' | 'success' | 'warning' | 'error'> = {
  neutral: 'neutral',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

export function InlineStatusPanel({
  tone = 'neutral',
  title,
  where,
  whatWorked,
  whatFailed,
  nextAction,
  actions,
}: InlineStatusPanelProps) {
  return (
    <Card>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-title-s text-text-primary">{title}</h3>
          <Badge variant={toneVariant[tone]}>{tone}</Badge>
        </div>
        <dl className="grid gap-2 text-body-s text-text-secondary sm:grid-cols-2">
          {where ? (
            <div>
              <dt className="text-label-s text-text-secondary">Where</dt>
              <dd className="mt-1 text-text-primary">{where}</dd>
            </div>
          ) : null}
          {whatFailed ? (
            <div>
              <dt className="text-label-s text-text-secondary">What failed</dt>
              <dd className="mt-1 text-text-primary">{whatFailed}</dd>
            </div>
          ) : null}
          {whatWorked ? (
            <div>
              <dt className="text-label-s text-text-secondary">What still worked</dt>
              <dd className="mt-1 text-text-primary">{whatWorked}</dd>
            </div>
          ) : null}
          {nextAction ? (
            <div>
              <dt className="text-label-s text-text-secondary">Next action</dt>
              <dd className="mt-1 text-text-primary">{nextAction}</dd>
            </div>
          ) : null}
        </dl>
        {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
      </div>
    </Card>
  );
}
