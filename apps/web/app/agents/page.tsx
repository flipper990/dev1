'use client';

import {
  Search,
  Sparkles,
  Plus,
  Code2,
  PenLine,
  Image as ImageIcon,
  MessageSquare,
  Music,
  Video,
  Database,
  ShoppingBag,
  Users as UsersIcon,
} from 'lucide-react';
import { TopNav } from '../../components/dashboard/TopNav';
import { Sparkle } from '../../components/ui/Sparkle';
import { Card } from '../../components/ui/Card';

const CATEGORIES = ['All', 'Featured', 'Productivity', 'Creative', 'Engineering', 'Data', 'Marketing'];

const AGENTS: {
  name: string;
  author: string;
  desc: string;
  tags: string[];
  bg: string;
  icon: React.ReactNode;
}[] = [
  {
    name: 'Spec Architect',
    author: 'devteam',
    desc: 'Expands a one-line idea into a full product spec with feature slices and API contracts.',
    tags: ['planning', 'design'],
    bg: 'linear-gradient(135deg,#FBBF24,#F59E0B)',
    icon: <PenLine size={22} />,
  },
  {
    name: 'Code Builder',
    author: 'devteam',
    desc: 'Generates production-ready Next.js + Fastify code, slice by slice, with full typing.',
    tags: ['code', 'fullstack'],
    bg: 'linear-gradient(135deg,#60A5FA,#3B82F6)',
    icon: <Code2 size={22} />,
  },
  {
    name: 'QA Sentinel',
    author: 'devteam',
    desc: 'System validator. Boots Docker, hits endpoints, gates "pass" until everything works.',
    tags: ['qa', 'runtime'],
    bg: 'linear-gradient(135deg,#C084FC,#8B5CF6)',
    icon: <Sparkles size={22} />,
  },
  {
    name: 'Polish Designer',
    author: 'devteam',
    desc: 'Enforces design tokens, primitives, app shell, accessibility, and dark-mode parity.',
    tags: ['design', 'a11y'],
    bg: 'linear-gradient(135deg,#4ADE80,#22C55E)',
    icon: <ImageIcon size={22} />,
  },
  {
    name: 'Data Modeler',
    author: 'community',
    desc: 'Designs Prisma schemas + seed scripts from your domain description.',
    tags: ['db', 'prisma'],
    bg: 'linear-gradient(135deg,#FB7185,#F43F5E)',
    icon: <Database size={22} />,
  },
  {
    name: 'Copy Editor',
    author: 'community',
    desc: 'Writes microcopy, empty states, error messages with a consistent voice.',
    tags: ['writing'],
    bg: 'linear-gradient(135deg,#A78BFA,#7C3AED)',
    icon: <MessageSquare size={22} />,
  },
  {
    name: 'Soundtrack Bot',
    author: 'community',
    desc: 'Generates ambient build music for long-running pipelines. Optional & whimsical.',
    tags: ['fun'],
    bg: 'linear-gradient(135deg,#38BDF8,#0EA5E9)',
    icon: <Music size={22} />,
  },
  {
    name: 'Demo Recorder',
    author: 'community',
    desc: 'Records a deterministic walkthrough video of any generated app for your changelog.',
    tags: ['video', 'qa'],
    bg: 'linear-gradient(135deg,#F472B6,#EC4899)',
    icon: <Video size={22} />,
  },
  {
    name: 'Shop Generator',
    author: 'devteam',
    desc: 'Scaffolds a checkout flow + Stripe wiring on top of an existing project.',
    tags: ['commerce'],
    bg: 'linear-gradient(135deg,#FBBF24,#D97706)',
    icon: <ShoppingBag size={22} />,
  },
  {
    name: 'Team Onboarder',
    author: 'community',
    desc: 'Generates a starter onboarding flow + role-based access for any saas project.',
    tags: ['saas'],
    bg: 'linear-gradient(135deg,#34D399,#10B981)',
    icon: <UsersIcon size={22} />,
  },
];

export default function AgentsPage() {
  return (
    <div className="cosmic-root">
      <TopNav />

      <main className="max-w-[1480px] mx-auto px-7 pb-16">
        <section className="pt-6 pb-8 flex items-end justify-between gap-6 flex-wrap">
          <div>
            <h1 className="font-display text-5xl text-primary leading-tight tracking-[-0.02em]">
              Agents
            </h1>
            <p className="text-secondary mt-2 max-w-xl">
              The cast of specialists that build, review, and polish your projects. Add
              your own or remix the community ones.
            </p>
          </div>
          <button className="cn-btn cn-btn--gold">
            <Plus size={14} />
            Create Agent
          </button>
        </section>

        <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-7">
          {/* Sidebar */}
          <aside className="flex flex-col gap-5">
            <div className="cn-card p-4">
              <div className="relative">
                <Search
                  size={14}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  className="cn-input !pl-9"
                  placeholder="Search agents…"
                />
              </div>
            </div>

            <div className="cn-card p-2">
              <div className="px-3 py-2 text-[11px] uppercase tracking-[0.18em] text-muted">
                Categories
              </div>
              <div className="flex flex-col">
                {CATEGORIES.map((c, i) => (
                  <button
                    key={c}
                    type="button"
                    className={
                      'flex items-center justify-between px-3 py-2 rounded-lg text-sm transition-colors text-left ' +
                      (i === 0
                        ? 'bg-gold-500/12 text-gold-200 border border-gold-300/30'
                        : 'text-secondary hover:bg-white/[0.04]')
                    }
                  >
                    <span>{c}</span>
                    <span className="text-[10.5px] text-muted">
                      {[10, 4, 6, 5, 3, 2, 4][i] ?? '·'}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <Card highlight className="!bg-gradient-to-br !from-gold-700/30 !to-gold-900/20">
              <div className="flex items-center gap-2 mb-2 text-gold-200">
                <Sparkle size={14} />
                <span className="text-[11px] uppercase tracking-[0.18em]">Pro</span>
              </div>
              <div className="font-display text-xl text-primary leading-tight mb-1">
                Build private agents
              </div>
              <div className="text-xs text-secondary mb-4">
                Ship custom roles trained on your repo. Available on the team plan.
              </div>
              <button className="cn-btn cn-btn--gold w-full">Upgrade</button>
            </Card>
          </aside>

          {/* Grid */}
          <section className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-5">
            {AGENTS.map((a) => (
              <article key={a.name} className="cn-agent-card">
                <div className="cn-agent-card__icon" style={{ background: a.bg, color: '#0B0F1C' }}>
                  {a.icon}
                </div>
                <div>
                  <div className="font-display text-lg text-primary leading-tight">
                    {a.name}
                  </div>
                  <div className="text-[11px] text-muted mt-0.5">by {a.author}</div>
                </div>
                <p className="text-xs text-secondary leading-relaxed">{a.desc}</p>
                <div className="flex flex-wrap gap-1.5 mt-auto">
                  {a.tags.map((t) => (
                    <span key={t} className="cn-chip">{t}</span>
                  ))}
                </div>
              </article>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
