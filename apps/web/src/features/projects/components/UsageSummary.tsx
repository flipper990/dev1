import type { GeneratedProject } from '../../../../types/dashboard';
import { Card } from '../../../../components/ui';

interface UsageSummaryProps {
  projects: GeneratedProject[];
}

function formatTokens(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`;
  return value.toLocaleString();
}

function formatDuration(ms: number) {
  if (!ms) return '0m';
  const minutes = Math.max(1, Math.round(ms / 60_000));
  return `${minutes}m`;
}

export function UsageSummary({ projects }: UsageSummaryProps) {
  const totals = projects.reduce(
    (acc, project) => ({
      tokens: acc.tokens + (project.totalTokens ?? 0),
      cost: acc.cost + (project.totalCostUsd ?? 0),
      duration: acc.duration + (project.durationMs ?? 0),
      completed: acc.completed + (project.status === 'generated' ? 1 : 0),
    }),
    { tokens: 0, cost: 0, duration: 0, completed: 0 },
  );

  const items = [
    ['Projects', projects.length.toLocaleString()],
    ['Generated', totals.completed.toLocaleString()],
    ['Tokens', formatTokens(totals.tokens)],
    ['Cost', `$${totals.cost.toFixed(2)}`],
    ['Runtime', formatDuration(totals.duration)],
  ];

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-title-s text-text-primary">Usage and cost</h2>
          <p className="mt-1 text-body-s text-text-secondary">Aggregate production usage from backend project records.</p>
        </div>
      </div>
      <dl className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {items.map(([label, value]) => (
          <div key={label} className="rounded-[var(--radius-panel)] border border-border bg-surface-base p-3">
            <dt className="text-label-s text-text-muted">{label}</dt>
            <dd className="mt-1 text-title-s text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}
