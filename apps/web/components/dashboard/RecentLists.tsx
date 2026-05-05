'use client';

import { Code2, FileCode, Folder } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import { Sparkle } from '../ui/Sparkle';
import type { GeneratedProject } from '../../types/dashboard';
import { cn } from '../../lib/cn';

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000)         return 'just now';
  if (ms < 3_600_000)      return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)     return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

const STATUS_LABEL: Record<GeneratedProject['status'], string> = {
  generating: 'Generating',
  completed:  'Ready',
  failed:     'Failed',
};

const STATUS_CHIP: Record<GeneratedProject['status'], string> = {
  generating: 'cn-chip--violet',
  completed:  'cn-chip--success',
  failed:     'cn-chip--danger',
};

/** "Recent Projects" card — selectable list. */
export function RecentProjects({
  projects,
  selectedId,
  onSelect,
  emptyHint,
}: {
  projects: GeneratedProject[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  emptyHint?: string;
}) {
  return (
    <Card>
      <CardTitle icon={<Sparkle size={14} className="text-gold-300" />}>
        Recent Projects
      </CardTitle>
      {projects.length === 0 ? (
        <div className="text-muted text-xs py-6 text-center">
          {emptyHint ?? 'No projects yet — describe your idea above to start.'}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {projects.slice(0, 5).map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p.id)}
              className={cn(
                'cn-row text-left',
                selectedId === p.id && '!border-gold-300/50 !bg-gold-500/[0.06]',
              )}
            >
              <span className="cn-row__icon">
                <Folder size={16} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="cn-row__title block truncate">{p.name}</span>
                <span className="cn-row__meta block">
                  {formatRelative(p.createdAt)} · {p.totalTokens.toLocaleString()} tok
                </span>
              </span>
              <span className={cn('cn-chip', STATUS_CHIP[p.status])}>
                {STATUS_LABEL[p.status]}
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}

/** "Recent Ideas" — derives from the latest prompts across recent projects. */
export function RecentIdeas({
  projects,
  onPick,
}: {
  projects: GeneratedProject[];
  onPick: (text: string) => void;
}) {
  const ideas = projects
    .flatMap((p) =>
      (p.promptHistory ?? p.prompts.map((t) => ({ text: t, createdAt: p.createdAt }))).map((h) => ({
        ...h,
        project: p.name,
      })),
    )
    .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))
    .slice(0, 4);

  return (
    <Card>
      <CardTitle icon={<FileCode size={14} className="text-gold-300" />}>
        Recent Ideas
      </CardTitle>
      {ideas.length === 0 ? (
        <div className="text-muted text-xs py-6 text-center">
          Your previous prompts will appear here.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {ideas.map((idea, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPick(idea.text)}
              className="cn-row text-left"
            >
              <span className="cn-row__icon">
                <Code2 size={16} />
              </span>
              <span className="flex-1 min-w-0">
                <span className="cn-row__title block truncate">{idea.text}</span>
                <span className="cn-row__meta block">
                  {idea.project} · {formatRelative(idea.createdAt)}
                </span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Card>
  );
}
