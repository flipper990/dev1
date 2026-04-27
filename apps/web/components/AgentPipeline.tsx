'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Minus, Clock, Loader2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { PipelineStep, StepStatus } from '../types/dashboard';

// ── 4 agents in pipeline execution order ────────────────────────────
const PIPELINE_ORDER = ['spec', 'builder', 'qa', 'polish'] as const;

type AgentRole = typeof PIPELINE_ORDER[number];

const AGENT_CONFIG: Record<AgentRole, { label: string; description: string; color: string; bg: string; emoji: string }> = {
  spec:    { label: 'Spec',    description: 'Intent → plan → architecture → specification', color: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  emoji: '📝' },
  builder: { label: 'Builder', description: 'Generating fullstack code',                       color: '#60A5FA', bg: 'rgba(96,165,250,0.12)',  emoji: '🔨' },
  qa:      { label: 'QA',      description: 'Reviewing & fixing (loops back if needed)',       color: '#C084FC', bg: 'rgba(192,132,252,0.12)', emoji: '🔍' },
  polish:  { label: 'Polish',  description: 'UI/UX, perf, production readiness',               color: '#A78BFA', bg: 'rgba(167,139,250,0.12)', emoji: '✨' },
};

/** Map any agent string coming from the backend onto one of our 4 known keys. */
function resolveRole(raw: string | undefined | null): AgentRole {
  const n = (raw ?? '').toLowerCase();
  if (n.includes('spec') || n.includes('plan') || n.includes('arch') || n.includes('intent')) return 'spec';
  if (n.includes('build') || n.includes('dev') || n.includes('code')) return 'builder';
  if (n.includes('qa') || n.includes('review') || n.includes('test') || n.includes('debug') || n.includes('quality')) return 'qa';
  if (n.includes('polish') || n.includes('optim') || n.includes('devop') || n.includes('deploy') || n.includes('ui')) return 'polish';
  return 'spec';
}

function fmt(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ── Skeleton nodes shown before any pipeline data arrives ────
const SKELETON_STEPS: PipelineStep[] = PIPELINE_ORDER.map((role) => ({
  stepId: role,
  name: AGENT_CONFIG[role].label,
  agent: role,
  status: 'pending' as StepStatus,
  durationMs: 0,
}));

export function AgentPipeline() {
  const { progress, isGenerating } = useStore();

  if (!progress && !isGenerating) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">Agent Pipeline</span>
        <div className="py-8 text-center text-[#64748B] text-[12px] leading-loose">
          Generate a project to see the<br />multi-agent pipeline in action.
        </div>
      </div>
    );
  }

  const rawSteps: PipelineStep[] = progress?.steps ?? [];
  const pct = Math.round((progress?.progress ?? 0) * 100);

  // Build a Map<role → most-informative step> from whatever the backend sent
  const byRole = new Map<AgentRole, PipelineStep>();
  for (const step of rawSteps) {
    const role = resolveRole(step.agent);
    const existing = byRole.get(role);
    // Prefer running > failed > completed > skipped > pending
    const rank = (s: StepStatus) =>
      s === 'running' ? 5 : s === 'failed' ? 4 : s === 'completed' ? 3 : s === 'skipped' ? 2 : 1;
    if (!existing || rank(step.status) > rank(existing.status)) {
      byRole.set(role, step);
    }
  }

  // Always display in the fixed 8-step order
  const displaySteps: PipelineStep[] = PIPELINE_ORDER.map((role) =>
    byRole.get(role) ?? SKELETON_STEPS.find((s) => s.agent === role)!,
  );

  const activeStep = displaySteps.find((s) => s.status === 'running');
  const completedCount = displaySteps.filter((s) => s.status === 'completed').length;

  return (
    <div className="p-4 flex flex-col gap-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">Agent Pipeline</span>
        {isGenerating && (
          <span className="text-[12px] font-bold text-[#3B82F6] font-mono">{pct}%</span>
        )}
        {progress?.status === 'completed' && (
          <span className="text-[11px] text-[#22C55E] flex items-center gap-1">
            <CheckCircle2 size={12} /> Done
          </span>
        )}
      </div>

      {/* Overall progress bar */}
      {(isGenerating || pct > 0) && (
        <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: 'linear-gradient(90deg, #3B82F6, #818CF8)' }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.4, ease: 'easeOut' }}
          />
        </div>
      )}

      {/* Vertical pipeline — all 8 agents */}
      <div className="flex flex-col">
        {displaySteps.map((step, i) => {
          const role = resolveRole(step.agent);
          const cfg  = AGENT_CONFIG[role];
          const isActive  = step.status === 'running';
          const isDone    = step.status === 'completed';
          const isFailed  = step.status === 'failed';
          const isSkipped = step.status === 'skipped';
          const isPending = step.status === 'pending';
          const isLast    = i === displaySteps.length - 1;

          return (
            <div key={step.stepId ?? role} className="flex gap-3">
              {/* Left rail: icon + connector line */}
              <div className="flex flex-col items-center flex-shrink-0" style={{ width: 32 }}>
                {/* Step icon */}
                <motion.div
                  className={cn(
                    'w-8 h-8 rounded-xl flex items-center justify-center text-sm border-2 flex-shrink-0 transition-all duration-300 z-10',
                    isPending  && 'bg-white/[0.04] border-white/[0.06] text-[#475569]',
                    isFailed   && 'bg-[#EF4444]/10 border-[#EF4444] text-[#EF4444]',
                    isSkipped  && 'bg-white/[0.04] border-[#334155] text-[#475569] opacity-50',
                  )}
                  style={
                    isActive
                      ? { background: cfg.bg, borderColor: cfg.color, color: cfg.color, boxShadow: `0 0 12px ${cfg.color}66` }
                      : isDone
                      ? { background: cfg.bg, borderColor: cfg.color, color: cfg.color }
                      : undefined
                  }
                  animate={isDone ? { scale: [1, 1.15, 1] } : {}}
                  transition={{ duration: 0.3 }}
                >
                  {isActive && (
                    <span
                      className="absolute w-10 h-10 rounded-2xl border-2 opacity-0"
                      style={{ borderColor: cfg.color, animation: 'pulse-ring 1.4s ease-out infinite' }}
                    />
                  )}
                  {isActive   ? cfg.emoji : null}
                  {isDone     ? <CheckCircle2 size={14} /> : null}
                  {isFailed   ? <XCircle size={14} /> : null}
                  {isSkipped  ? <Minus size={12} /> : null}
                  {isPending  ? cfg.emoji : null}
                </motion.div>

                {/* Connector line to next step */}
                {!isLast && (
                  <div className="relative flex-1 w-0.5 my-0.5 rounded-full overflow-hidden" style={{ minHeight: 16, background: 'rgba(255,255,255,0.06)' }}>
                    {(isDone || isActive) && (
                      <motion.div
                        className="absolute top-0 left-0 right-0 bottom-0 rounded-full"
                        style={{ background: cfg.color }}
                        initial={{ scaleY: 0, originY: 0 }}
                        animate={{ scaleY: isDone ? 1 : 0.5 }}
                        transition={{ duration: 0.4, ease: 'easeOut' }}
                      />
                    )}
                    {isActive && (
                      <div
                        className="absolute inset-0"
                        style={{
                          background: `linear-gradient(180deg, ${cfg.color}, transparent)`,
                          animation: 'pipe-flow-v 1.2s linear infinite',
                        }}
                      />
                    )}
                  </div>
                )}
              </div>

              {/* Right: label + meta */}
              <div className={cn('flex flex-col justify-start pb-3', isLast && 'pb-0')} style={{ paddingTop: 4 }}>
                <div className="flex items-center gap-2">
                  <span className={cn(
                    'text-[12px] font-semibold leading-none',
                    isActive  && 'text-[#F1F5F9]',
                    isDone    && 'text-[#94A3B8]',
                    isFailed  && 'text-[#F87171]',
                    isSkipped && 'text-[#475569]',
                    isPending && 'text-[#475569]',
                  )}>
                    {cfg.label}
                  </span>

                  {isActive && (
                    <Loader2 size={11} className="animate-spin" style={{ color: cfg.color }} />
                  )}

                  {step.durationMs > 0 && (
                    <span className="text-[10px] font-mono text-[#475569] flex items-center gap-0.5">
                      <Clock size={8} />
                      {fmt(step.durationMs)}
                    </span>
                  )}
                </div>

                {/* Description — shown while active */}
                <AnimatePresence>
                  {isActive && (
                    <motion.span
                      key="desc"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-[11px] text-[#64748B] mt-0.5 leading-relaxed overflow-hidden"
                    >
                      {cfg.description}
                    </motion.span>
                  )}
                  {isFailed && step.error && (
                    <motion.span
                      key="err"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                      className="text-[11px] text-[#F87171] mt-0.5 leading-relaxed overflow-hidden"
                    >
                      {step.error}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </div>
          );
        })}
      </div>

      {/* Completion summary */}
      <AnimatePresence>
        {progress?.status === 'completed' && (
          <motion.div
            key="summary"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="bg-[#22C55E]/[0.06] border border-[#22C55E]/20 rounded-lg p-2.5 flex items-center justify-between"
          >
            <span className="text-[12px] font-semibold text-[#22C55E]">Pipeline complete</span>
            <div className="flex items-center gap-2 text-[11px] font-mono text-[#64748B]">
              <span>{completedCount}/8 steps</span>
              <span>·</span>
              <span>{fmt(progress.durationMs)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

