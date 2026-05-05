'use client';

import { ChevronRight, RotateCw } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { PipelineState, PipelineStepState } from './types';

const STATE_STYLES: Record<PipelineStepState, { bg: string; color: string; ring: string }> = {
  pending:   { bg: 'var(--bg-elevated)',     color: 'var(--text-secondary)', ring: 'var(--border-subtle)' },
  active:    { bg: 'var(--accent-amber)',    color: 'var(--bg-void)',         ring: 'rgba(245,158,11,0.6)' },
  completed: { bg: 'rgba(16,185,129,0.18)',  color: 'var(--success)',         ring: 'rgba(16,185,129,0.4)' },
  failed:    { bg: 'rgba(239,68,68,0.18)',   color: 'var(--error)',           ring: 'rgba(239,68,68,0.4)' },
};

export interface BuildPipelineProps {
  pipeline: PipelineState;
}

export function BuildPipeline({ pipeline }: BuildPipelineProps) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 h-16 rounded-xl border bg-[var(--bg-surface)] overflow-x-auto devteam-scroll"
      style={{ borderColor: 'var(--border-subtle)' }}
      role="list"
      aria-label="Build pipeline"
    >
      {pipeline.steps.map((s, i) => {
        const style = STATE_STYLES[s.state];
        const showLoop = pipeline.isLooping && s.id === 'build';
        return (
          <div key={s.id} className="flex items-center gap-1.5 shrink-0">
            <div
              role="listitem"
              className={cn(
                'flex items-center gap-2 h-9 px-3.5 rounded-lg text-[12.5px] font-semibold border',
                s.state === 'active' && 'devteam-glow',
              )}
              style={{
                background: style.bg,
                color: style.color,
                borderColor: style.ring,
              }}
            >
              {showLoop && (
                <RotateCw
                  size={13}
                  className="devteam-pulse-slow"
                  style={{ animation: 'spin 2.4s linear infinite' }}
                />
              )}
              <span>{s.label}</span>
              {s.state === 'completed' && <span className="text-[10px]">✓</span>}
              {s.state === 'failed'    && <span className="text-[10px]">✕</span>}
            </div>
            {i < pipeline.steps.length - 1 && (
              <ChevronRight size={14} className="text-[var(--text-secondary)]" />
            )}
          </div>
        );
      })}
      {pipeline.isLooping && (
        <span
          className="ml-auto shrink-0 rounded-full px-2.5 py-1 text-[10.5px] font-bold tracking-wide border"
          style={{
            background: 'rgba(245,158,11,0.18)',
            color: '#F59E0B',
            borderColor: 'rgba(245,158,11,0.4)',
          }}
        >
          ↻ Loop #{pipeline.loopCount}
        </span>
      )}
    </div>
  );
}
