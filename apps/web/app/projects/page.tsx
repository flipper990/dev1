'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Folder, Search } from 'lucide-react';
import { TopNav } from '../../components/dashboard/TopNav';
import { Card } from '../../components/ui/Card';
import { listProjects } from '../../lib/api';
import type { GeneratedProject } from '../../types/dashboard';
import { cn } from '../../lib/cn';

const STATUS_CHIP: Record<GeneratedProject['status'], string> = {
  generating: 'cn-chip--violet',
  completed:  'cn-chip--success',
  failed:     'cn-chip--danger',
};

export default function ProjectsPage() {
  const [projects, setProjects] = useState<GeneratedProject[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    listProjects().then(setProjects).catch(() => {});
  }, []);

  const filtered = projects.filter((p) =>
    p.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="cosmic-root">
      <TopNav />
      <main className="max-w-[1280px] mx-auto px-7 pb-16">
        <section className="pt-6 pb-8 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 className="font-display text-5xl text-primary leading-tight tracking-[-0.02em]">
              Projects
            </h1>
            <p className="text-secondary mt-2 max-w-xl">
              Every build the agents have shipped from your prompts.
            </p>
          </div>
          <Link href="/" className="cn-btn cn-btn--gold">
            New project
          </Link>
        </section>

        <Card padded={false}>
          <div className="px-5 py-4 border-b border-white/[0.05] flex items-center gap-3">
            <Search size={14} className="text-muted" />
            <input
              className="bg-transparent border-0 outline-0 text-sm flex-1 placeholder:text-muted text-primary"
              placeholder="Search projects…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <span className="text-[11px] text-muted">{filtered.length} results</span>
          </div>

          {filtered.length === 0 ? (
            <div className="px-5 py-16 text-center text-muted text-sm">
              {projects.length === 0 ? 'No projects yet.' : 'No matches.'}
            </div>
          ) : (
            <div>
              {filtered.map((p) => (
                <Link
                  key={p.id}
                  href={`/?project=${p.id}`}
                  className="flex items-center gap-4 px-5 py-4 border-b border-white/[0.04] last:border-b-0 hover:bg-white/[0.03] transition-colors"
                >
                  <span className="cn-row__icon">
                    <Folder size={16} />
                  </span>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-primary truncate">{p.name}</div>
                    <div className="text-[11px] text-muted mt-0.5">
                      {new Date(p.createdAt).toLocaleString()} ·{' '}
                      {p.totalTokens.toLocaleString()} tok ·{' '}
                      ${p.totalCostUsd.toFixed(3)}
                    </div>
                  </div>
                  <span className={cn('cn-chip', STATUS_CHIP[p.status])}>{p.status}</span>
                </Link>
              ))}
            </div>
          )}
        </Card>
      </main>
    </div>
  );
}
