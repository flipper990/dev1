'use client';

import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, Loader2, Circle, AlertTriangle } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import type { PipelineStep, StepStatus } from '../types/dashboard';

/**
 * PhaseProgress — a user-facing simplification of the 11-agent pipeline.
 *
 * The backend emits fine-grained agent steps (intent_analyzer, planner, …).
 * For the dashboard we collapse them into four friendly phases so the user
 * always knows "what is the system doing *for me* right now".
 */

type PhaseId = 'planning' | 'designing' | 'building' | 'connecting';

interface PhaseDef {
  id: PhaseId;
  label: string;
  description: string;
  /** Agent roles (loose match) that contribute to this phase */
  match: (role: string) => boolean;
}

const PHASES: PhaseDef[] = [
  {
    id: 'planning',
    label: 'Planning',
    description: 'Analysing your prompt and choosing the stack',
    match: (r) => /intent|plan|architect/.test(r),
  },
  {
    id: 'designing',
    label: 'Designing UI',
    description: 'Producing design system, layout and tokens',
    match: (r) => /ui|ux|design/.test(r),
  },
  {
    id: 'building',
    label: 'Building frontend',
    description: 'Writing source files and optimising them',
    match: (r) => /coder|code|develop|optim/.test(r),
  },
  {
    id: 'connecting',
    label: 'Connecting backend',
    description: 'Wiring APIs, review, tests and deploy config',
    match: (r) => /integration|review|debug|test|devop|deploy/.test(r),
  },
];

type PhaseState = 'pending' | 'active' | 'completed' | 'failed';

function derivePhaseStates(steps: PipelineStep[], overallStatus?: string): Record<PhaseId, PhaseState> {
  const initial: Record<PhaseId, PhaseState> = {
    planning: 'pending',
    designing: 'pending',
    building: 'pending',
    connecting: 'pending',
  };

  // Collect the set of statuses per phase
  for (const step of steps) {
    const role = (step.agent ?? '').toLowerCase();
    const phase = PHASES.find((p) => p.match(role));
    if (!phase) continue;

    const prev = initial[phase.id];
    if (step.status === 'failed') {
      initial[phase.id] = 'failed';
    } else if (step.status === 'running') {
      if (prev !== 'failed') initial[phase.id] = 'active';
    } else if (step.status === 'completed' || step.status === 'skipped') {
      if (prev === 'pending') initial[phase.id] = 'completed';
    }
  }

  // If the overall session is completed, any previously-pending phases
  // that had no matching agent are marked completed too (e.g. backend-only
  // projects that skipped "Designing UI").
  if (overallStatus === 'completed') {
    (Object.keys(initial) as PhaseId[]).forEach((id) => {
      if (initial[id] === 'pending') initial[id] = 'completed';
    });
  }

  return initial;
}

function statusTone(state: PhaseState) {
  switch (state) {
    case 'active':    return { color: '#3B82F6', bg: 'rgba(59,130,246,0.12)', border: 'rgba(59,130,246,0.45)' };
    case 'completed': return { color: '#22C55E', bg: 'rgba(34,197,94,0.10)',  border: 'rgba(34,197,94,0.35)' };
    case 'failed':    return { color: '#EF4444', bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.40)' };
    default:          return { color: '#475569', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.06)' };
  }
}

export function PhaseProgress() {
  const { progress, isGenerating } = useStore();

  if (!progress && !isGenerating) return null;

  const steps: PipelineStep[] = progress?.steps ?? [];
  const phaseStates = derivePhaseStates(steps, progress?.status);
  const pct = Math.round((progress?.progress ?? 0) * 100);
  const currentStepName = progress?.currentStep?.name;

  return (
    <div className="flex-shrink-0 border-b border-white/[0.06] bg-[#0B0F19]/40 px-4 py-3">
      {/* Header */}
      <div className="flex items-center justify-between mb-2.5">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">
          Progress
        </span>
        <div className="flex items-center gap-2 text-[11px] text-[#64748B]">
          {currentStepName && isGenerating && (
            <span className="font-mono truncate max-w-[220px]">{currentStepName}</span>
          )}
          <span className="font-mono font-semibold text-[#F1F5F9]">{pct}%</span>
        </div>
      </div>

      {/* Overall bar */}
      <div className="h-1 w-full rounded-full bg-white/[0.06] overflow-hidden mb-3">
        <motion.div
          className="h-full rounded-full"
          style={{ background: 'linear-gradient(90deg, #3B82F6, #818CF8)' }}
          initial={{ width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
        />
      </div>

      {/* Phase pills */}
      <div className="grid grid-cols-4 gap-2">
        {PHASES.map((phase) => {
          const state = phaseStates[phase.id];
          const tone = statusTone(state);

          return (
            <motion.div
              key={phase.id}
              layout
              className={cn(
                'relative flex items-center gap-2 rounded-lg px-2.5 py-2 border min-w-0 transition-colors',
              )}
              style={{ background: tone.bg, borderColor: tone.border }}
              animate={
                state === 'active'
                  ? { boxShadow: `0 0 0 0 ${tone.color}00`, scale: 1 }
                  : { scale: 1 }
              }
            >
              <span className="flex-shrink-0 flex items-center justify-center w-4 h-4">
                {state === 'active' && (
                  <Loader2 size={14} className="animate-spin" style={{ color: tone.color }} />
                )}
                {state === 'completed' && (
                  <CheckCircle2 size={14} style={{ color: tone.color }} />
                )}
                {state === 'failed' && (
                  <AlertTriangle size={14} style={{ color: tone.color }} />
                )}
                {state === 'pending' && (
                  <Circle size={12} style={{ color: tone.color }} />
                )}
              </span>

              <div className="flex flex-col min-w-0">
                <span
                  className="text-[11px] font-semibold leading-tight truncate"
                  style={{ color: state === 'pending' ? '#64748B' : '#F1F5F9' }}
                >
                  {phase.label}
                </span>
                <AnimatePresence>
                  {state === 'active' && (
                    <motion.span
                      key="desc"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.18 }}
                      className="text-[10px] text-[#94A3B8] leading-tight truncate overflow-hidden"
                    >
                      {phase.description}
                    </motion.span>
                  )}
                </AnimatePresence>
              </div>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
}
