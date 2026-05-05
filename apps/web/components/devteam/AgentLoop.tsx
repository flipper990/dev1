'use client';

import type { PipelineState } from './types';

export interface AgentLoopProps {
  pipeline: PipelineState;
}

/**
 * Decorative SVG arrow that overlays the agent stack — shows a flowing
 * dashed path from the QA card back to the Build card while the pipeline
 * is in a fix loop. Only renders when `pipeline.isLooping` is true.
 *
 * The cards are vertically stacked, so the arrow is a curved hook that
 * exits the right edge of QA, swings out, and re-enters the right edge of
 * Build. We position absolutely on the AgentFeed container.
 */
export function AgentLoop({ pipeline }: AgentLoopProps) {
  if (!pipeline.isLooping) return null;
  return (
    <div className="pointer-events-none absolute right-[-6px] top-[120px] h-[160px] w-[44px]">
      <svg width="44" height="160" viewBox="0 0 44 160" fill="none" aria-hidden>
        <defs>
          <linearGradient id="devteam-loop-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"  stopColor="#F59E0B" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity="0.35" />
          </linearGradient>
        </defs>
        {/* QA (top) → out → back into Build (bottom). */}
        <path
          d="M 6 18 Q 38 24 38 80 Q 38 136 6 142"
          stroke="url(#devteam-loop-grad)"
          strokeWidth="1.5"
          fill="none"
          className="devteam-loop-flow"
        />
        {/* Arrow head into Build. */}
        <path
          d="M 6 142 l 6 -3 m -6 3 l 6 3"
          stroke="#F59E0B"
          strokeWidth="1.5"
          fill="none"
          strokeLinecap="round"
        />
      </svg>
      <div
        className="absolute -right-1 top-[68px] pointer-events-auto rounded-full px-2 py-0.5 text-[10px] font-bold tracking-wide"
        style={{
          background: 'rgba(245,158,11,0.18)',
          color: '#F59E0B',
          border: '1px solid rgba(245,158,11,0.35)',
        }}
      >
        Loop #{pipeline.loopCount}
      </div>
    </div>
  );
}
