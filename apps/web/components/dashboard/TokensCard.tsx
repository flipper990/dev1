'use client';

import { Hash, DollarSign, TrendingUp } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';
import type { GeneratedProject } from '../../types/dashboard';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000)     return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

/** Aggregate token + cost spend across the workspace. */
export function TokensCard({ projects }: { projects: GeneratedProject[] }) {
  let tokens = 0;
  let cost = 0;
  for (const p of projects) {
    tokens += p.totalTokens ?? 0;
    cost   += p.totalCostUsd ?? 0;
  }

  return (
    <Card>
      <CardTitle icon={<Hash size={14} className="text-gold-300" />}>Tokens</CardTitle>
      <div className="flex items-end justify-between mb-4">
        <div>
          <div className="font-display text-3xl text-primary leading-none">
            {fmtTokens(tokens)}
          </div>
          <div className="text-[11px] text-muted mt-1.5 uppercase tracking-wider">
            Lifetime usage
          </div>
        </div>
        <span className="cn-chip cn-chip--gold">
          <TrendingUp size={11} /> active
        </span>
      </div>

      <div className="flex items-center gap-2 pt-3 border-t border-white/5">
        <DollarSign size={13} className="text-muted" />
        <span className="text-xs text-secondary mono">
          ${cost.toFixed(3)}
        </span>
        <span className="text-[10px] text-muted ml-auto uppercase tracking-wider">
          spent
        </span>
      </div>
    </Card>
  );
}
