'use client';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, XCircle, Minus, Clock } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { PipelineStep, StepStatus } from '../types/dashboard';

const AGENT_CONFIG: Record<string, { label: string; color: string; bg: string; emoji: string }> = {
  planner:  { label: 'Planner',  color: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  emoji: '🗺' },
  coder:    { label: 'Coder',    color: '#60A5FA', bg: 'rgba(96,165,250,0.12)',  emoji: '💻' },
  reviewer: { label: 'Reviewer', color: '#C084FC', bg: 'rgba(192,132,252,0.12)', emoji: '🔍' },
  tester:   { label: 'Tester',   color: '#4ADE80', bg: 'rgba(74,222,128,0.12)',  emoji: '🧪' },
  devops:   { label: 'DevOps',   color: '#FB7185', bg: 'rgba(251,113,133,0.12)', emoji: '🚀' },
};

function getAgentKey(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('planner') || n.includes('architect')) return 'planner';
  if (n.includes('coder')   || n.includes('developer') || n.includes('backend') || n.includes('frontend')) return 'coder';
  if (n.includes('review')  || n.includes('quality')) return 'reviewer';
  if (n.includes('test')    || n.includes('qa')) return 'tester';
  if (n.includes('devops')  || n.includes('deploy') || n.includes('infra')) return 'devops';
  return 'coder';
}

function fmt(ms: number): string {
  if (!ms) return '';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const SKELETON_KEYS = ['planner', 'coder', 'reviewer', 'tester', 'devops'];

export function AgentPipeline() {
  const { progress, isGenerating } = useStore();

  if (!progress && !isGenerating) {
    return (
      <div className="p-4 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">Agent Pipeline</span>
        </div>
        <div className="py-8 text-center text-[#64748B] text-[12px] leading-loose">
          Generate a project to see the<br />multi-agent pipeline in action.
        </div>
      </div>
    );
  }

  const steps: PipelineStep[] = progress?.steps ?? [];
  const pct = progress?.progress ?? 0;

  // Dedupe by agent role, prefer running/failed over completed
  const agentNodes = steps.reduce<PipelineStep[]>((acc, step) => {
    const key = getAgentKey(step.agent);
    const idx = acc.findIndex((s) => getAgentKey(s.agent) === key);
    if (idx >= 0) {
      if (step.status === 'running' || step.status === 'failed') acc[idx] = step;
    } else {
      acc.push(step);
    }
    return acc;
  }, []);

  const displayNodes = agentNodes.length > 0
    ? agentNodes
    : SKELETON_KEYS.map((key) => ({
        stepId: key,
        name:   AGENT_CONFIG[key].label,
        agent:  key,
        status: 'pending' as StepStatus,
        durationMs: 0,
      }));

  const activeStep = steps.find((s) => s.status === 'running');

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

      {/* Progress bar */}
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

      {/* Pipeline track */}
      <div className="flex items-center overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
        {displayNodes.map((step, i) => {
          const agentKey = getAgentKey(step.agent);
          const cfg      = AGENT_CONFIG[agentKey] ?? AGENT_CONFIG.coder;
          const isActive = step.status === 'running';
          const isDone   = step.status === 'completed' || step.status === 'skipped';
          const prevDone = i > 0 && (displayNodes[i - 1].status === 'completed' || displayNodes[i - 1].status === 'skipped');

          return (
            <div key={step.stepId} className="flex items-center">
              {/* Connector SVG */}
              {i > 0 && (
                <div className="relative flex-1 min-w-[16px] mx-0.5" style={{ marginBottom: '28px' }}>
                  <svg width="100%" height="4" style={{ minWidth: 16 }}>
                    <line x1="0" y1="2" x2="100%" y2="2"
                      stroke="rgba(255,255,255,0.06)" strokeWidth="2" strokeLinecap="round" />
                    {(isDone || isActive) && (
                      <motion.line
                        x1="0" y1="2" x2="100%" y2="2"
                        stroke={cfg.color}
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeDasharray="100"
                        initial={{ strokeDashoffset: 100 }}
                        animate={{ strokeDashoffset: 0 }}
                        transition={{ duration: 0.3, ease: 'easeOut' }}
                        pathLength={1}
                      />
                    )}
                  </svg>
                  {isActive && (
                    <div
                      className="absolute inset-0 overflow-hidden rounded"
                      style={{ height: 2, top: 1 }}
                    >
                      <div
                        style={{
                          height: '100%',
                          background: `linear-gradient(90deg, transparent, ${cfg.color}, transparent)`,
                          animation: 'pipe-flow 1.2s linear infinite',
                        }}
                      />
                    </div>
                  )}
                </div>
              )}

              {/* Node */}
              <motion.div
                className="flex flex-col items-center gap-1 flex-shrink-0"
                style={{ minWidth: 52 }}
                initial={false}
                animate={isDone ? { scale: [1, 1.1, 1] } : {}}
                transition={{ duration: 0.3 }}
              >
                {/* Icon circle */}
                <div
                  className={cn(
                    'relative w-9 h-9 rounded-xl flex items-center justify-center text-base border-2 transition-all duration-300',
                    step.status === 'pending'   && 'bg-white/[0.04] border-white/[0.06] text-[#64748B]',
                    step.status === 'running'   && 'border-2',
                    step.status === 'completed' && 'border-2',
                    step.status === 'failed'    && 'bg-[#EF4444]/10 border-[#EF4444] text-[#EF4444]',
                    step.status === 'skipped'   && 'bg-white/[0.04] border-[#475569] text-[#475569] opacity-50',
                  )}
                  style={
                    step.status === 'running'
                      ? { background: cfg.bg, borderColor: cfg.color, color: cfg.color, boxShadow: `0 0 12px ${cfg.color}66` }
                      : step.status === 'completed'
                      ? { background: cfg.bg, borderColor: cfg.color, color: cfg.color }
                      : undefined
                  }
                >
                  {step.status === 'running' && (
                    <span
                      className="absolute inset-[-5px] rounded-2xl border-2 opacity-0"
                      style={{ borderColor: cfg.color, animation: 'pulse-ring 1.4s ease-out infinite' }}
                    />
                  )}
                  {step.status === 'running'   ? cfg.emoji : null}
                  {step.status === 'completed' ? <CheckCircle2 size={15} /> : null}
                  {step.status === 'failed'    ? <XCircle size={15} /> : null}
                  {step.status === 'skipped'   ? <Minus size={13} /> : null}
                  {step.status === 'pending'   ? cfg.emoji : null}
                </div>

                {/* Label */}
                <span className={cn(
                  'text-[11px] font-medium text-center',
                  step.status === 'running'   ? 'text-[#F1F5F9]' : 'text-[#64748B]',
                  step.status === 'completed' ? 'text-[#94A3B8]' : '',
                )}>
                  {cfg.label}
                </span>

                {/* Duration badge */}
                {step.durationMs > 0 && (
                  <span className="text-[10px] text-[#475569] font-mono flex items-center gap-0.5">
                    <Clock size={8} />
                    {fmt(step.durationMs)}
                  </span>
                )}
              </motion.div>
            </div>
          );
        })}
      </div>

      {/* Active step detail */}
      <AnimatePresence>
        {(activeStep || progress?.currentStep) && (
          <motion.div
            key="detail"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.2 }}
            className="bg-white/[0.04] border border-white/[0.06] rounded-lg p-2.5 flex flex-col gap-1.5"
          >
            <div className="flex items-center justify-between">
              <span className="text-[12px] font-semibold text-[#F1F5F9]">
                {progress?.currentStep?.name ?? activeStep?.name ?? '…'}
              </span>
              <span className="text-[11px] font-mono text-[#3B82F6]">running</span>
            </div>
            {progress?.currentStep?.description && (
              <span className="text-[11px] text-[#64748B] leading-relaxed">
                {progress.currentStep.description}
              </span>
            )}
            {progress?.durationMs != null && (
              <span className="text-[11px] font-mono text-[#475569]">
                elapsed {fmt(progress.durationMs)}
              </span>
            )}
          </motion.div>
        )}
      </AnimatePresence>

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
              <span>{steps.length} steps</span>
              <span>·</span>
              <span>{fmt(progress.durationMs)}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

