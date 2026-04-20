'use client';

import type { PipelineState, PipelineStep } from '../types/index';

interface Props {
  pipeline: PipelineState | null;
}

const ICONS: Record<string, string> = {
  planner: '📋',
  architect: '🏗️',
  coder: '💻',
  reviewer: '🔍',
  tester: '🧪',
  debugger: '🐛',
  devops: '🚀',
  optimizer: '⚡',
};

function StepRow({ step }: { step: PipelineStep }) {
  const icon = ICONS[step.role] ?? '🤖';
  const meta = [
    step.durationMs != null && `${(step.durationMs / 1000).toFixed(1)}s`,
    step.tokensUsed != null && `${step.tokensUsed.toLocaleString()} tokens`,
    step.costUsd != null && `$${step.costUsd.toFixed(4)}`,
    step.skippedReason,
  ].filter(Boolean).join(' · ');

  return (
    <div className="step-item">
      <div className={`step-icon ${step.status}`}>{icon}</div>
      <div className="step-info">
        <div className="step-role">{step.role}</div>
        {meta && <div className="step-meta">{meta}</div>}
      </div>
      <span className={`step-badge ${step.status}`}>{step.status}</span>
    </div>
  );
}

export function AgentActivityPanel({ pipeline }: Props) {
  const completedCount = pipeline?.steps.filter(
    (s) => s.status === 'completed' || s.status === 'skipped',
  ).length ?? 0;
  const totalCount = pipeline?.steps.length ?? 0;
  const progress = totalCount > 0 ? (completedCount / totalCount) * 100 : 0;

  return (
    <div className="panel" style={{ gridRow: '1 / 2' }}>
      <div className="panel-header">
        <span>Agent Activity</span>
        {pipeline && (
          <span style={{ color: 'var(--text-2)', fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>
            {completedCount}/{totalCount} steps
          </span>
        )}
      </div>
      <div className="panel-body">
        {!pipeline ? (
          <div className="empty-state">
            <span className="icon">🤖</span>
            <span>No active pipeline</span>
          </div>
        ) : (
          <>
            <div className="step-list">
              {pipeline.steps.map((step) => (
                <StepRow key={step.role} step={step} />
              ))}
            </div>
            <div className="progress-bar">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>
            {pipeline.optimization && (
              <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-2)' }}>
                Cache hits: {pipeline.optimization.cacheHits} ·
                Skipped: {pipeline.optimization.skippedSteps} ·
                API calls saved: {pipeline.optimization.estimatedApiCallsSaved}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
