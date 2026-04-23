'use client';
import { Settings, User, ChevronDown, Zap, TrendingUp, TrendingDown, FolderOpen, Hash, DollarSign } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function AppHeader({ onNewProject }: { onNewProject?: () => void }) {
  const { projects, selectedProjectId, isGenerating, progress, wsConnected } = useStore();
  const [showMenu, setShowMenu] = useState(false);

  const selected   = useMemo(
    () => projects.find((p) => p.id === selectedProjectId) ?? null,
    [projects, selectedProjectId],
  );
  const statusLabel = isGenerating
    ? 'generating'
    : selected?.status === 'completed' ? 'completed'
    : selected?.status === 'failed'    ? 'failed'
    : 'idle';

  // Reduce over all projects once per projects-change, not per render. This
  // matters during WS streaming when the page re-renders several times per
  // second on a large project list.
  const { totalCost, totalTokens } = useMemo(() => {
    let cost = 0, tokens = 0;
    for (const p of projects) {
      cost   += p.totalCostUsd ?? 0;
      tokens += p.totalTokens  ?? 0;
    }
    return { totalCost: cost, totalTokens: tokens };
  }, [projects]);

  return (
    <header
      className="flex items-center gap-3 px-4 border-b border-white/[0.06] bg-[#0B0F19]/80 backdrop-blur-xl flex-shrink-0 z-50"
      style={{ height: 'var(--header-h)' }}
    >
      {/* Logo */}
      <a href="/" className="flex items-center gap-2 font-bold text-sm tracking-tight text-[#F1F5F9] no-underline flex-shrink-0">
        <span className="w-2 h-2 rounded-full bg-[#3B82F6]" style={{ boxShadow: '0 0 8px #3B82F6' }} />
        DEVteam
      </a>

      <div className="w-px h-5 bg-white/10 flex-shrink-0" />

      {/* Project selector */}
      <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded px-2.5 py-1.5 text-[11px] text-[#94A3B8] min-w-[140px] max-w-[240px] cursor-pointer hover:bg-white/[0.07] hover:border-white/10 transition-colors overflow-hidden">
        <FolderOpen size={11} className="text-[#64748B] flex-shrink-0" />
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[#F1F5F9]">
          {selected ? selected.name : 'Select project…'}
        </span>
        <ChevronDown size={10} className="text-[#64748B] flex-shrink-0" />
      </div>

      {/* Status badge */}
      <StatusBadge status={statusLabel} pct={progress?.progress != null ? Math.round(progress.progress * 100) : undefined} />

      <div className="flex-1" />

      {/* Metrics row */}
      <div className="flex items-center gap-2">
        <MetricCard label="Projects" value={String(projects.length)}     icon={<FolderOpen size={11} />} />
        <MetricCard label="Tokens"   value={fmtTokens(totalTokens)}      icon={<Hash size={11} />} mono />
        <MetricCard label="Cost"     value={`$${totalCost.toFixed(3)}`}  icon={<DollarSign size={11} />} mono
          trend={totalCost > 0 ? 'up' : 'neutral'} />

        {/* WS badge */}
        <div className={cn(
          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-widest uppercase border',
          wsConnected
            ? 'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/[0.08]'
            : 'text-[#64748B] border-white/[0.06] bg-white/[0.03]',
        )}>
          <span
            className={cn('w-1.5 h-1.5 rounded-full', wsConnected ? 'bg-[#22C55E]' : 'bg-[#64748B]')}
            style={wsConnected ? { animation: 'pulse-dot 1.8s ease-in-out infinite' } : {}}
          />
          {wsConnected ? 'Live' : 'Offline'}
        </div>

        {onNewProject && (
          <button
            onClick={onNewProject}
            title="New project (Ctrl+N)"
            className="flex items-center gap-1.5 bg-[#3B82F6] hover:bg-[#3B82F6]/90 active:bg-[#3B82F6] text-white rounded px-3 py-1.5 text-[11px] font-semibold transition-all hover:-translate-y-px active:translate-y-0 shadow-[0_1px_0_rgba(255,255,255,0.08)_inset]"
          >
            <Zap size={11} />
            New
          </button>
        )}

        {/* Keyboard shortcuts hint — dispatches a `?` so the global handler opens the overlay */}
        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
          }}
          title="Keyboard shortcuts (?)"
          className="flex items-center justify-center w-7 h-7 rounded border border-transparent text-[#64748B] hover:bg-white/[0.06] hover:border-white/[0.06] hover:text-[#F1F5F9] transition-colors font-mono text-[13px]"
          aria-label="Show keyboard shortcuts"
        >
          ?
        </button>

        {/* Settings */}
        <button
          title="Settings"
          className="flex items-center justify-center w-7 h-7 rounded border border-transparent text-[#64748B] hover:bg-white/[0.06] hover:border-white/[0.06] hover:text-[#F1F5F9] transition-colors"
        >
          <Settings size={14} />
        </button>

        {/* User avatar */}
        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="flex items-center justify-center w-7 h-7 rounded-full bg-[#3B82F6]/20 border border-[#3B82F6]/30 text-[#3B82F6] hover:bg-[#3B82F6]/30 transition-colors"
          >
            <User size={14} />
          </button>
          {showMenu && (
            <div className="absolute right-0 top-9 bg-[#151B2B] border border-white/[0.08] rounded-lg shadow-panel w-44 z-50 py-1 overflow-hidden">
              <button className="w-full text-left px-3 py-2 text-[12px] text-[#CBD5E1] hover:bg-white/[0.06] transition-colors">Profile</button>
              <button className="w-full text-left px-3 py-2 text-[12px] text-[#CBD5E1] hover:bg-white/[0.06] transition-colors">Settings</button>
              <div className="h-px bg-white/[0.06] my-1" />
              <button className="w-full text-left px-3 py-2 text-[12px] text-[#EF4444] hover:bg-[#EF4444]/[0.08] transition-colors">Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function MetricCard({
  label, value, icon, trend, mono,
}: {
  label: string; value: string; icon?: React.ReactNode; trend?: 'up' | 'down' | 'neutral'; mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.06] rounded px-2.5 py-1.5 text-[11px]">
      {icon && <span className="text-[#64748B]">{icon}</span>}
      <span className="text-[#64748B]">{label}</span>
      <span className={cn('font-semibold text-[#F1F5F9]', mono && 'font-mono')}>{value}</span>
      {trend === 'up'   && <TrendingUp   size={10} className="text-[#EF4444]" />}
      {trend === 'down' && <TrendingDown size={10} className="text-[#22C55E]" />}
    </div>
  );
}

function StatusBadge({ status, pct }: { status: string; pct?: number }) {
  const cls: Record<string, string> = {
    idle:       'text-[#64748B] border-white/[0.06] bg-white/[0.03]',
    generating: 'text-[#3B82F6] border-[#3B82F6]/30 bg-[#3B82F6]/[0.08]',
    completed:  'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/[0.08]',
    failed:     'text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/[0.08]',
  };
  return (
    <div className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[10px] font-bold uppercase tracking-widest', cls[status] ?? cls.idle)}>
      {status === 'generating' && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" style={{ animation: 'pulse-dot 1.8s ease-in-out infinite' }} />
      )}
      {status}{status === 'generating' && pct != null ? ` ${pct}%` : ''}
    </div>
  );
}
