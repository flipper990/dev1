'use client';
import { Settings, ChevronDown, Zap, TrendingUp, TrendingDown, FolderOpen, Hash, DollarSign, Sparkles } from 'lucide-react';
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
      className="app-header flex flex-wrap items-center gap-2.5 sm:gap-3.5 flex-shrink-0 min-w-0 rounded-[var(--radius-panel)] border border-border/70 bg-surface-raised/70 px-3 py-2 sm:px-4"
      style={{ minHeight: 'var(--header-h)' }}
    >
      <a href="/" className="brand-wordmark flex-shrink-0" aria-label="DEVteam home">
        <span className="brand-wordmark__mark">
          <Sparkles size={14} strokeWidth={2.5} />
        </span>
        <span className="brand-wordmark__text">DEVteam</span>
      </a>

      <div className="w-px h-5 bg-white/10 flex-shrink-0" />

      <div className="flex items-center gap-2 bg-white/[0.04] border border-white/[0.06] rounded px-2.5 py-1.5 text-[11px] text-[#94A3B8] min-w-0 w-full sm:w-auto sm:min-w-[180px] sm:max-w-[320px] md:min-w-[220px] cursor-pointer hover:bg-white/[0.07] hover:border-white/10 transition-colors overflow-hidden">
        <FolderOpen size={11} className="text-[#64748B] flex-shrink-0" />
        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-[#F1F5F9]">
          {selected ? selected.name : 'Select project…'}
        </span>
        <ChevronDown size={10} className="text-[#64748B] flex-shrink-0" />
      </div>

      <div className="flex items-center gap-1.5 flex-wrap min-w-0">
        <StatusBadge status={statusLabel} pct={progress?.progress != null ? Math.round(progress.progress * 100) : undefined} />
        {selected?.preview?.previewStatus && (
          <PreviewBadge status={selected.preview.previewStatus} />
        )}
        <ValidationBadge
          execStatus={selected?.executionValidation?.status ?? null}
          execVerdict={selected?.executionValidation?.finalVerdict ?? null}
          runtimeStatus={selected?.runtimeValidation?.status ?? null}
          runtimeVerdict={selected?.runtimeValidation?.finalVerdict ?? null}
        />
      </div>

      <div className="hidden lg:block flex-1" />
      <div className="basis-full lg:hidden" />

      <div className="flex items-center gap-2 flex-wrap min-w-0 w-full lg:w-auto lg:justify-end">
        <MetricCard label="Projects" value={String(projects.length)}     icon={<FolderOpen size={11} />} />
        <MetricCard className="hidden sm:flex" label="Tokens"   value={fmtTokens(totalTokens)}      icon={<Hash size={11} />} mono />
        <MetricCard className="hidden lg:flex" label="Cost"     value={`$${totalCost.toFixed(3)}`}  icon={<DollarSign size={11} />} mono
          trend={totalCost > 0 ? 'up' : 'neutral'} />

        <div className={cn(
          'hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold tracking-widest uppercase border',
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
            className="btn btn-primary btn--sm"
          >
            <Zap size={12} strokeWidth={2.5} />
            New
          </button>
        )}

        <button
          onClick={() => {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
          }}
          title="Keyboard shortcuts (?)"
          className="hidden md:flex items-center justify-center w-7 h-7 rounded-md border border-transparent text-[#64748B] hover:bg-white/[0.06] hover:border-white/[0.08] hover:text-[#F1F5F9] transition-colors font-mono text-[13px]"
          aria-label="Show keyboard shortcuts"
        >
          ?
        </button>

        <button
          title="Settings"
          className="flex items-center justify-center w-7 h-7 rounded-md border border-transparent text-[#64748B] hover:bg-white/[0.06] hover:border-white/[0.08] hover:text-[#F1F5F9] transition-colors"
        >
          <Settings size={14} />
        </button>

        <div className="relative">
          <button
            onClick={() => setShowMenu((v) => !v)}
            className="avatar hover:scale-105 active:scale-100 transition-transform"
            aria-label="Account menu"
          >
            A
          </button>
          {showMenu && (
            <div className="card-elevated absolute right-0 top-10 w-52 z-50 py-1 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/[0.06]">
                <div className="text-[12px] font-semibold text-[#F8FAFC]">Signed in</div>
                <div className="text-[11px] text-[#64748B] truncate">you@devteam.ai</div>
              </div>
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
  label, value, icon, trend, mono, className,
}: {
  label: string; value: string; icon?: React.ReactNode; trend?: 'up' | 'down' | 'neutral'; mono?: boolean; className?: string;
}) {
  return (
    <div className={cn('flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.06] rounded px-2.5 py-1.5 text-[11px]', className)}>
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
    <div
      title={`Build status: ${status}`}
      className={cn('flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold uppercase tracking-wide', cls[status] ?? cls.idle)}
    >
      <span className="text-[#94A3B8] font-semibold">build</span>
      {status === 'generating' && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" style={{ animation: 'pulse-dot 1.8s ease-in-out infinite' }} />
      )}
      {status}{status === 'generating' && pct != null ? ` ${pct}%` : ''}
    </div>
  );
}

function PreviewBadge({ status }: { status: string }) {
  const cls: Record<string, string> = {
    idle:       'text-[#64748B] border-white/[0.06] bg-white/[0.03]',
    preparing:  'text-[#F59E0B] border-[#F59E0B]/30 bg-[#F59E0B]/[0.08]',
    installing: 'text-[#F59E0B] border-[#F59E0B]/30 bg-[#F59E0B]/[0.08]',
    building:   'text-[#F59E0B] border-[#F59E0B]/30 bg-[#F59E0B]/[0.08]',
    starting:   'text-[#F59E0B] border-[#F59E0B]/30 bg-[#F59E0B]/[0.08]',
    ready:      'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/[0.08]',
    failed:     'text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/[0.08]',
  };
  const transitional = ['preparing', 'installing', 'building', 'starting'].includes(status);
  return (
    <div
      title={`Preview status: ${status}`}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold uppercase tracking-wide',
        cls[status] ?? cls.idle,
      )}
    >
      <span className="text-[#94A3B8] font-semibold">preview</span>
      {transitional && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#F59E0B]" style={{ animation: 'pulse-dot 1.8s ease-in-out infinite' }} />
      )}
      {status}
    </div>
  );
}

type ValidatorStatus = 'pending' | 'running' | 'passed' | 'warning' | 'failed';
const STATUS_RANK: Record<ValidatorStatus, number> = {
  passed: 0, pending: 1, running: 2, warning: 3, failed: 4,
};
function worstStatus(a: ValidatorStatus | null, b: ValidatorStatus | null): ValidatorStatus | null {
  if (!a) return b;
  if (!b) return a;
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}
function ValidationBadge({
  execStatus, execVerdict, runtimeStatus, runtimeVerdict,
}: {
  execStatus: ValidatorStatus | null;
  execVerdict: 'pass' | 'fail' | null;
  runtimeStatus: ValidatorStatus | null;
  runtimeVerdict: 'pass' | 'fail' | null;
}) {
  const execEffective: ValidatorStatus | null =
    execStatus ?? (execVerdict === 'pass' ? 'passed' : execVerdict === 'fail' ? 'failed' : null);
  const runtimeEffective: ValidatorStatus | null =
    runtimeStatus ?? (runtimeVerdict === 'pass' ? 'passed' : runtimeVerdict === 'fail' ? 'failed' : null);
  const status = worstStatus(execEffective, runtimeEffective);
  if (!status) return null;
  const cls: Record<ValidatorStatus, string> = {
    pending: 'text-[#64748B] border-white/[0.06] bg-white/[0.03]',
    running: 'text-[#3B82F6] border-[#3B82F6]/30 bg-[#3B82F6]/[0.08]',
    passed:  'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/[0.08]',
    warning: 'text-[#F59E0B] border-[#F59E0B]/30 bg-[#F59E0B]/[0.08]',
    failed:  'text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/[0.08]',
  };
  const tip =
    `Validation: ${status}` +
    (execEffective ? ` · exec=${execEffective}` : '') +
    (runtimeEffective ? ` · runtime=${runtimeEffective}` : '');
  return (
    <div
      title={tip}
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11px] font-bold uppercase tracking-wide',
        cls[status],
      )}
    >
      <span className="text-[#94A3B8] font-semibold">validation</span>
      {status === 'running' && (
        <span className="w-1.5 h-1.5 rounded-full bg-[#3B82F6]" style={{ animation: 'pulse-dot 1.8s ease-in-out infinite' }} />
      )}
      {status}
    </div>
  );
}
