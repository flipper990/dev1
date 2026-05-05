'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { Agent, AgentStatus } from './types';

const STATUS_COLORS: Record<AgentStatus, { dot: string; text: string }> = {
  waiting: { dot: '#64748B', text: 'var(--text-secondary)' },
  working: { dot: '#F59E0B', text: '#F59E0B' },
  done:    { dot: '#10B981', text: '#10B981' },
  blocked: { dot: '#EF4444', text: '#EF4444' },
  looping: { dot: '#F59E0B', text: '#F59E0B' },
};

export interface AgentCardProps {
  agent: Agent;
}

export function AgentCard({ agent }: AgentCardProps) {
  const [open, setOpen] = useState(false);
  const colors = STATUS_COLORS[agent.status];
  const isActive = agent.status === 'working' || agent.status === 'looping';

  return (
    <div
      className="rounded-xl border bg-[var(--bg-surface)] p-3"
      style={{ borderColor: 'var(--border-subtle)' }}
      data-agent-role={agent.role}
    >
      <div className="flex items-start gap-3">
        <div className="relative">
          <div
            className={cn(
              'h-9 w-9 rounded-lg grid place-items-center text-[18px]',
              isActive && 'devteam-pulse-slow',
            )}
            style={{ background: 'var(--bg-elevated)' }}
            aria-hidden
          >
            {agent.avatar}
          </div>
          {isActive && (
            <span
              className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2"
              style={{
                background: colors.dot,
                boxShadow: '0 0 0 0 ' + colors.dot,
                ['--tw-ring-color' as string]: 'var(--bg-surface)',
              }}
            />
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-semibold text-[var(--text-primary)] truncate">
              {agent.name}
            </span>
            <button
              type="button"
              onClick={() => setOpen((o) => !o)}
              className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
              aria-label="Toggle logs"
              aria-expanded={open}
            >
              <ChevronDown
                size={14}
                style={{ transform: open ? 'rotate(180deg)' : 'rotate(0)' }}
              />
            </button>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[11.5px]" style={{ color: colors.text }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: colors.dot }} />
            <span className="truncate">{agent.statusText}</span>
            {agent.status === 'looping' && agent.loopCount ? (
              <span className="ml-auto text-[10.5px] font-semibold tracking-wide">
                Fixing… #{agent.loopCount}
              </span>
            ) : null}
          </div>

          <div
            className="mt-2 h-1.5 rounded-full overflow-hidden"
            style={{ background: 'var(--bg-elevated)' }}
            aria-label="progress"
            role="progressbar"
            aria-valuenow={agent.progress}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max(0, Math.min(100, agent.progress))}%`,
                background:
                  agent.status === 'done'
                    ? 'var(--success)'
                    : agent.status === 'blocked'
                    ? 'var(--error)'
                    : 'linear-gradient(90deg,#F59E0B,#FBBF24)',
              }}
            />
          </div>
        </div>
      </div>

      {open && (
        <div
          className="mt-3 rounded-lg border p-2.5 text-[11.5px] leading-relaxed text-[var(--text-secondary)] font-mono"
          style={{ borderColor: 'var(--border-subtle)', background: 'rgba(0,0,0,0.25)' }}
        >
          {agent.logs.length === 0 ? (
            <span className="opacity-60">No logs yet.</span>
          ) : (
            <ul className="space-y-1">
              {agent.logs.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="text-[var(--accent-amber)]/70">›</span>
                  <span className="flex-1 break-words">{l}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
