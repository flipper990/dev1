'use client';

import { CheckCircle2, Loader2, Circle, AlertCircle } from 'lucide-react';
import type { SessionProgress, StepStatus } from '../../types/dashboard';
import { cn } from '../../lib/cn';

const AGENT_ORDER = ['spec', 'builder', 'qa', 'polish'];
const AGENT_LABEL: Record<string, string> = {
  spec:    'Spec',
  builder: 'Builder',
  qa:      'QA',
  polish:  'Polish',
};

function statusFor(progress: SessionProgress | null, agent: string): StepStatus {
  if (!progress) return 'pending';
  if (progress.failedAgents?.includes(agent)) return 'failed';
  if (progress.completedAgents?.includes(agent)) return 'completed';
  if (progress.currentStep?.agent === agent) return 'running';
  return 'pending';
}

/**
 * Inline progress strip shown above the idea prompt while the pipeline is
 * generating a project. 4 capsules — one per agent — with running spinner,
 * gold highlight, and a thin live percent bar underneath.
 */
export function PipelineStrip({ progress }: { progress: SessionProgress | null }) {
  const pct = progress?.progress != null ? Math.round(progress.progress * 100) : 0;
  return (
    <div className="cn-card p-4 mb-4 animate-fade-in-up">
      <div className="flex items-center gap-2 mb-3">
        {AGENT_ORDER.map((a) => {
          const s = statusFor(progress, a);
          return (
            <div
              key={a}
              className={cn(
                'flex items-center gap-2 px-3 py-1.5 rounded-full text-[11.5px] font-medium border transition-colors flex-1 justify-center',
                s === 'running'   && 'bg-gold-500/12 text-gold-200 border-gold-300/40',
                s === 'completed' && 'bg-success/10 text-success border-success/30',
                s === 'failed'    && 'bg-error/10 text-error border-error/30',
                s === 'pending'   && 'bg-white/[0.025] text-muted border-white/[0.06]',
              )}
            >
              {s === 'running'   && <Loader2 size={12} className="animate-spin" />}
              {s === 'completed' && <CheckCircle2 size={12} />}
              {s === 'failed'    && <AlertCircle size={12} />}
              {s === 'pending'   && <Circle size={12} />}
              {AGENT_LABEL[a]}
            </div>
          );
        })}
      </div>
      <div className="h-1 bg-white/[0.05] rounded-full overflow-hidden">
        <div
          className="h-full bg-gold-grad transition-[width] duration-500"
          style={{ width: `${pct}%`, background: 'linear-gradient(90deg, #E2BB5A, #C99030)' }}
        />
      </div>
      <div className="flex items-center justify-between mt-2 text-[11px] text-muted">
        <span>
          {progress?.currentStep
            ? `${progress.currentStep.agent} · ${progress.currentStep.name}`
            : 'queued'}
        </span>
        <span className="mono">{pct}%</span>
      </div>
    </div>
  );
}
