import type { SessionProgress } from '../types/dashboard';

interface AgentActivityPanelProps {
  progress: SessionProgress | null;
}

export function AgentActivityPanel({ progress }: AgentActivityPanelProps) {
  if (!progress) {
    return (
      <section className="panel">
        <div className="panel__header">
          <h2>Agent Activity</h2>
        </div>
        <div className="empty-state">No active session. Start generation to stream live step status.</div>
      </section>
    );
  }

  return (
    <section className="panel">
      <div className="panel__header panel__header--split">
        <h2>Agent Activity</h2>
        <span className="status-chip">{Math.round(progress.progress * 100)}%</span>
      </div>

      <div className="progress-bar">
        <div className="progress-bar__fill" style={{ width: `${Math.round(progress.progress * 100)}%` }} />
      </div>

      <div className="step-list">
        {progress.steps.map((step, index) => (
          <div className="step-item" key={`${step.stepId}-${index}`}>
            <div className="step-item__top">
              <span className="step-item__name">{step.name}</span>
              <span className={`step-badge step-badge--${step.status}`}>{step.status}</span>
            </div>
            <div className="step-item__meta">
              <span className="mono">{step.agent}</span>
              <span>{step.durationMs > 0 ? `${step.durationMs}ms` : 'waiting'}</span>
            </div>
            {step.error ? <div className="step-item__error">{step.error}</div> : null}
          </div>
        ))}
      </div>
    </section>
  );
}
