'use client';

import { Card, CardTitle } from '../ui/Card';
import { ProgressRing } from '../ui/ProgressRing';
import { SkillBar } from '../ui/SkillBar';
import { Sparkle } from '../ui/Sparkle';
import type { GeneratedProject } from '../../types/dashboard';

/**
 * "Agent Progression" card — turns workspace activity into an editorial
 * skill-tree readout. Levels are derived from completed-project counts
 * + token throughput so the visual stays meaningful instead of static.
 */
export function AgentProgressionCard({ projects }: { projects: GeneratedProject[] }) {
  const completed = projects.filter((p) => p.status === 'completed').length;
  const tokens = projects.reduce((s, p) => s + (p.totalTokens || 0), 0);
  const failures = projects.filter((p) => p.status === 'failed').length;

  // Simple deterministic curves — ring fills as you build.
  const level = 1 + Math.floor(Math.sqrt(completed * 4 + tokens / 50_000));
  const ringValue = Math.min(0.99, (completed % 5) / 5 + 0.1);

  const skills: { label: string; value: number }[] = [
    { label: 'Spec',    value: Math.min(1, 0.35 + completed * 0.06) },
    { label: 'Builder', value: Math.min(1, 0.42 + completed * 0.05) },
    { label: 'QA',      value: Math.min(1, 0.30 + (completed - failures) * 0.05) },
    { label: 'Polish',  value: Math.min(1, 0.25 + completed * 0.04) },
  ];

  return (
    <Card>
      <CardTitle icon={<Sparkle size={14} className="text-gold-300" />}>
        Agent Progression
      </CardTitle>

      <div className="flex items-center gap-5 mb-5">
        <ProgressRing value={ringValue} level={level} />
        <div className="flex-1 min-w-0">
          <div className="font-display text-xl text-primary leading-tight">Apprentice</div>
          <div className="text-xs text-muted mt-1">
            {completed} build{completed === 1 ? '' : 's'} shipped ·{' '}
            {(tokens / 1000).toFixed(1)}K tokens
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-2.5">
        {skills.map((s) => (
          <SkillBar key={s.label} {...s} />
        ))}
      </div>
    </Card>
  );
}
