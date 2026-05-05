'use client';

import { Cpu, Database, Globe, Server } from 'lucide-react';
import { Card, CardTitle } from '../ui/Card';

/** Stack chip + small list of detected runtimes. */
export function EnvironmentCard() {
  const items = [
    { icon: <Globe size={13} />,    label: 'Next.js 16',     hint: 'frontend / web' },
    { icon: <Server size={13} />,   label: 'Fastify',        hint: 'apps/api · 3003' },
    { icon: <Database size={13} />, label: 'Postgres + Prisma', hint: 'compose service' },
    { icon: <Cpu size={13} />,      label: 'OpenAI GPT-4o',  hint: 'agent runtime' },
  ];

  return (
    <Card>
      <CardTitle icon={<Cpu size={14} className="text-gold-300" />}>
        Environment
      </CardTitle>
      <div className="flex flex-col gap-2.5">
        {items.map((i) => (
          <div
            key={i.label}
            className="flex items-center gap-3 py-1.5"
          >
            <span className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] grid place-items-center text-gold-300">
              {i.icon}
            </span>
            <div className="flex-1 min-w-0">
              <div className="text-[13px] text-primary truncate">{i.label}</div>
              <div className="text-[10.5px] text-muted">{i.hint}</div>
            </div>
            <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse-dot" />
          </div>
        ))}
      </div>
    </Card>
  );
}
