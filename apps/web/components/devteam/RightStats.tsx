'use client';

import { ExternalLink } from 'lucide-react';
import type { GeneratedProject } from '@devteam/types';
import type { Project, SkillBar, TechStackItem } from './types';
import { ProjectIdChip } from './ProjectIdChip';

/* ── Agent progression ─────────────────────────────────────────────────── */

export interface AgentProgressionProps {
  skills: SkillBar[];
  totals: { tokens: number; activeCount: number };
  rawProjects: GeneratedProject[];
}

/**
 * Team level = (# completed projects) — capped to 99.
 * Ratio = fraction of next 5 projects completed toward the next level.
 */
function deriveLevel(rawProjects: GeneratedProject[]) {
  const completed = rawProjects.filter((p) => p.status === 'completed').length;
  const level = Math.min(99, Math.floor(completed / 5) + 1);
  const intoLevel = completed - (level - 1) * 5;
  const ratio = Math.max(0, Math.min(1, intoLevel / 5));
  const tier =
    level >= 50 ? 'Legend'
    : level >= 25 ? 'Master'
    : level >= 10 ? 'Expert'
    : level >= 5  ? 'Adept'
    :               'Apprentice';
  return { level, ratio, tier };
}

export function AgentProgression({ skills, rawProjects }: AgentProgressionProps) {
  const { level, ratio, tier } = deriveLevel(rawProjects);
  const r = 28;
  const c = 2 * Math.PI * r;
  return (
    <Card title="Team Progression">
      <div className="flex items-center gap-4">
        <div
          className="flex flex-col items-center shrink-0"
          title={`${rawProjects.filter((p) => p.status === 'completed').length} projects completed`}
        >
          <div className="relative h-[72px] w-[72px]">
            <svg width="72" height="72" viewBox="0 0 72 72">
              <circle cx="36" cy="36" r={r} stroke="var(--border-subtle)" strokeWidth="6" fill="none" />
              <circle
                cx="36"
                cy="36"
                r={r}
                stroke="var(--accent-amber)"
                strokeWidth="6"
                fill="none"
                strokeDasharray={c}
                strokeDashoffset={c * (1 - ratio)}
                strokeLinecap="round"
                transform="rotate(-90 36 36)"
              />
            </svg>
            <div className="absolute inset-0 grid place-items-center">
              <div className="text-[14px] font-bold leading-none">Lv {level}</div>
            </div>
          </div>
          <div className="mt-1 text-[9px] text-[var(--text-secondary)] uppercase tracking-wider whitespace-nowrap">
            {tier}
          </div>
        </div>
        <div className="flex-1 space-y-1.5">
          {skills.map((s) => (
            <div key={s.id}>
              <div className="flex items-center justify-between text-[10.5px] uppercase tracking-wider">
                <span className="text-[var(--text-secondary)]">{s.label}</span>
                <span style={{ color: s.waiting ? 'var(--text-secondary)' : 'var(--text-primary)' }}>
                  {s.waiting ? 'No data' : `${s.value}%`}
                </span>
              </div>
              <div
                className="mt-1 h-1.5 rounded-full overflow-hidden"
                style={{ background: 'var(--bg-elevated)', opacity: s.waiting ? 0.3 : 1 }}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: s.waiting ? '100%' : `${s.value}%`,
                    background: s.waiting ? 'var(--text-secondary)' : 'linear-gradient(90deg,#F59E0B,#FBBF24)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </Card>
  );
}

/* ── Token dashboard ───────────────────────────────────────────────────── */

export interface TokenDashboardProps {
  sparkline: number[];
  totals: { tokens: number; costUsd: number; lifetimeLabel: string; activeCount: number };
}

export function TokenDashboard({ sparkline, totals }: TokenDashboardProps) {
  const w = 220;
  const h = 44;
  const points = sparkline.length === 0 ? [0, 0] : sparkline;
  const max = Math.max(1, ...points);
  const step = points.length > 1 ? w / (points.length - 1) : w;
  const path = points.map((p, i) => `${i * step},${h - (p / max) * (h - 6) - 2}`).join(' ');
  const isActive = totals.activeCount > 0;
  return (
    <Card
      title="Tokens"
      action={
        <span
          className="rounded-full px-2 py-0.5 text-[9.5px] font-bold tracking-wide uppercase"
          style={{
            background: isActive ? 'rgba(245,158,11,0.18)' : 'rgba(16,185,129,0.18)',
            color: isActive ? 'var(--accent-amber)' : 'var(--success)',
          }}
        >
          {isActive ? `${totals.activeCount} building` : 'Idle'}
        </span>
      }
    >
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[26px] font-bold leading-none tracking-tight">{totals.lifetimeLabel}</div>
          <div className="text-[10.5px] text-[var(--text-secondary)] mt-1 uppercase tracking-wider">
            Lifetime tokens
          </div>
        </div>
        <svg
          viewBox={`0 0 ${w} ${h}`}
          preserveAspectRatio="none"
          className="flex-1 min-w-0 max-w-[140px]"
          style={{ height: h }}
        >
          <defs>
            <linearGradient id="dt-spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F59E0B" stopOpacity="0.4" />
              <stop offset="100%" stopColor="#F59E0B" stopOpacity="0" />
            </linearGradient>
          </defs>
          <polyline points={path} fill="none" stroke="#F59E0B" strokeWidth="1.5" strokeLinejoin="round" />
          <polyline points={`0,${h} ${path} ${w},${h}`} fill="url(#dt-spark)" stroke="none" />
        </svg>
      </div>
      <div className="mt-2 flex items-center justify-between text-[11.5px]">
        <span className="text-[var(--text-secondary)]">${totals.costUsd.toFixed(2)} spent</span>
        <span className="font-semibold flex items-center gap-1" style={{ color: 'var(--accent-amber)' }}>
          {sparkline.length} runs <ExternalLink size={11} />
        </span>
      </div>
    </Card>
  );
}

/* ── Environment / tech stack ─────────────────────────────────────────── */

export interface EnvironmentStackProps {
  items: TechStackItem[];
}

export function EnvironmentStack({ items }: EnvironmentStackProps) {
  return (
    <Card title="Environment">
      <ul className="space-y-1.5">
        {items.map((t) => (
          <li
            key={t.id}
            className="flex items-center gap-3 px-2.5 py-2 rounded-lg border bg-[var(--bg-elevated)]"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div
              className="h-7 w-7 rounded-md grid place-items-center text-[10.5px] font-bold"
              style={{ background: 'var(--bg-surface)', color: 'var(--text-primary)' }}
            >
              {t.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">{t.name}</div>
              <div className="text-[10.5px] text-[var(--text-secondary)] font-mono">{t.version}</div>
            </div>
            <span
              className="h-2 w-2 rounded-full"
              title={t.ready ? 'Ready' : 'Unavailable'}
              style={{ background: t.ready ? 'var(--success)' : 'var(--error)' }}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ── Recent projects ───────────────────────────────────────────────────── */

export interface RecentProjectsProps {
  projects: Project[];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onNew?: () => void;
  /** Diagnostic: jump to whatever project the backend most recently
   *  created. Helps confirm the dashboard is in sync with the
   *  backend after out-of-band project creation. */
  onOpenLatest?: () => void;
}

export function RecentProjects({ projects, selectedId, onSelect, onNew, onOpenLatest }: RecentProjectsProps) {
  const action = (
    <div className="flex items-center gap-1">
      {onOpenLatest && (
        <button
          type="button"
          onClick={onOpenLatest}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border"
          style={{ borderColor: 'var(--border-subtle)' }}
          aria-label="Open the most recently created project"
          title="Fetch from backend, sort by createdAt desc, select newest id"
        >
          Open latest
        </button>
      )}
      {onNew && (
        <button
          type="button"
          onClick={onNew}
          className="flex items-center gap-1 px-2 py-1 rounded-md text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border"
          style={{ borderColor: 'var(--border-subtle)' }}
          aria-label="Start a new project"
        >
          <span aria-hidden>+</span>
          <span>New</span>
        </button>
      )}
    </div>
  );
  if (projects.length === 0) {
    return (
      <Card title="Recent Projects" action={action}>
        <div className="text-[11.5px] text-[var(--text-secondary)] py-2">
          No projects yet. Submit a prompt to create your first build.
        </div>
      </Card>
    );
  }
  return (
    <Card title="Recent Projects" action={action}>
      <ul className="space-y-1">
        {projects.map((p) => (
          <ProjectRow
            key={p.id}
            project={p}
            selected={p.id === selectedId}
            onClick={() => onSelect?.(p.id)}
          />
        ))}
      </ul>
    </Card>
  );
}

function ProjectRow({
  project,
  selected,
  onClick,
}: {
  project: Project;
  selected: boolean;
  onClick: () => void;
}) {
  const badge =
    project.status === 'failed'
      ? { color: 'var(--error)',   bg: 'rgba(239,68,68,0.15)',  label: 'Failed'  }
      : project.status === 'ready'
      ? { color: 'var(--success)', bg: 'rgba(16,185,129,0.15)', label: 'Ready'   }
      : { color: 'var(--accent-amber)', bg: 'rgba(245,158,11,0.15)', label: 'Building' };
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group w-full flex items-center gap-2 px-2 py-2 rounded-md hover:bg-[var(--bg-elevated)] text-left"
        style={{ background: selected ? 'var(--bg-elevated)' : undefined }}
      >
        <span className="h-2 w-2 rounded-full shrink-0" style={{ background: project.colorDot }} />
        <div className="flex-1 min-w-0">
          <div className="text-[12px] font-medium text-[var(--text-primary)] truncate">
            {project.name}
          </div>
          <div className="flex items-center gap-1.5 mt-0.5">
            <ProjectIdChip id={project.id} truncate size="xs" hideCopy />
            <span className="text-[10.5px] text-[var(--text-secondary)] truncate">
              {project.updatedLabel} • {(project.tokens / 1000).toFixed(1)}k tok
            </span>
          </div>
        </div>
        <span
          className="text-[9.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
          style={{ color: badge.color, background: badge.bg }}
        >
          {badge.label}
        </span>
      </button>
    </li>
  );
}

/* ── Shared card chrome ───────────────────────────────────────────────── */

function Card({
  title,
  action,
  children,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      className="rounded-xl border bg-[var(--bg-surface)] p-3"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <header className="flex items-center justify-between mb-2.5">
        <h3 className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          {title}
        </h3>
        {action}
      </header>
      {children}
    </section>
  );
}
