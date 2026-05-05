'use client';

import { AgentCard } from './AgentCard';
import { AgentLoop } from './AgentLoop';
import type { Agent, PipelineState } from './types';

export interface AgentFeedProps {
  agents: Agent[];
  pipeline: PipelineState;
}

export function AgentFeed({ agents, pipeline }: AgentFeedProps) {
  return (
    <section className="space-y-2">
      <header className="flex items-center justify-between px-1">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Agent Feed
        </h2>
        <span className="text-[10.5px] text-[var(--text-secondary)]">
          {agents.filter((a) => a.status === 'working' || a.status === 'looping').length} active
        </span>
      </header>
      <div className="relative space-y-2">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} />
        ))}
        <AgentLoop pipeline={pipeline} />
      </div>
    </section>
  );
}
