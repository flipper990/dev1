import { CheckCircle2, Circle } from 'lucide-react';
import { Card } from '../../../../components/ui';
import { cn } from '../../../../lib/cn';

export interface LaunchItem {
  id: string;
  label: string;
  done: boolean;
  note?: string;
}

interface LaunchChecklistProps {
  items: LaunchItem[];
}

export function LaunchChecklist({ items }: LaunchChecklistProps) {
  return (
    <Card>
      <h3 className="text-title-s text-text-primary">Launch checklist</h3>
      <p className="mt-1 text-body-s text-text-secondary">Confirm readiness before shipping.</p>
      <ul className="mt-4 space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-[var(--radius-control)] border border-border bg-surface-tint p-3">
            <div className="flex items-start gap-2">
              {item.done ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 text-status-success" aria-hidden="true" />
              ) : (
                <Circle className="mt-0.5 h-4 w-4 text-text-secondary" aria-hidden="true" />
              )}
              <div>
                <p className={cn('text-body-s', item.done ? 'text-text-primary' : 'text-text-secondary')}>{item.label}</p>
                {item.note ? <p className="mt-1 text-label-s text-text-secondary">{item.note}</p> : null}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
