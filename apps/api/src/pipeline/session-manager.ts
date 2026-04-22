// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Session Manager â€” Tracks active generation sessions with
// per-step progress, duration, and real-time subscriber updates.
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { Session, AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { PipelineEvent, StepStatus } from '../../../../packages/agent-core/src/orchestrator.js';
import { PIPELINE_STEPS } from '../../../../packages/agent-core/src/orchestrator.js';

// â”€â”€ Progress Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface StepProgress {
  stepId: string;
  name: string;
  agent: AgentRole;
  status: StepStatus;
  description: string;
  durationMs: number;
  attempt: number;
  error?: string;
}

export interface SessionProgress {
  sessionId: string;
  status: Session['status'];
  /** 0â€“1 fraction of pipeline completion. */
  progress: number;
  currentStep?: StepProgress;
  steps: StepProgress[];
  completedAgents: AgentRole[];
  failedAgents: AgentRole[];
  events: PipelineEvent[];
  startedAt: Date;
  durationMs: number;
}

export type ProgressCallback = (progress: SessionProgress) => void;

// â”€â”€ Session Manager â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private progress: Map<string, SessionProgress> = new Map();
  private callbacks: Map<string, ProgressCallback[]> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

  /** Create a new session */
  create(id: string, userId: string, prompts: string[]): Session {
    const session: Session = {
      id,
      userId,
      prompts,
      status: 'active',
      pipelineId: 'default-fullstack',
      currentStageId: 'plan',
      artifacts: new Map(),
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(id, session);

    // Initialize step progress from canonical pipeline steps
    const stepProgress: StepProgress[] = PIPELINE_STEPS.map(s => ({
      stepId: s.id,
      name: s.name,
      agent: s.agent,
      status: 'pending' as StepStatus,
      description: s.description,
      durationMs: 0,
      attempt: 0,
    }));

    this.progress.set(id, {
      sessionId: id,
      status: 'active',
      progress: 0,
      steps: stepProgress,
      completedAgents: [],
      failedAgents: [],
      events: [],
      startedAt: new Date(),
      durationMs: 0,
    });

    this.logger.info(`Session created: ${id}`);
    return session;
  }

  /** Get a session */
  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  /** Get session progress */
  getProgress(id: string): SessionProgress | undefined {
    const p = this.progress.get(id);
    if (p) {
      p.durationMs = Date.now() - p.startedAt.getTime();
    }
    return p;
  }

  /** Subscribe to progress updates */
  onProgress(sessionId: string, callback: ProgressCallback): () => void {
    const cbs = this.callbacks.get(sessionId) ?? [];
    cbs.push(callback);
    this.callbacks.set(sessionId, cbs);

    return () => {
      const list = this.callbacks.get(sessionId) ?? [];
      const idx = list.indexOf(callback);
      if (idx >= 0) list.splice(idx, 1);
    };
  }

  /** Handle pipeline events â€” updates step progress and notifies subscribers */
  handleEvent(event: PipelineEvent): void {
    const sessionId = event.sessionId;
    const progress = this.progress.get(sessionId);
    if (!progress) return;

    progress.events.push(event);
    progress.durationMs = Date.now() - progress.startedAt.getTime();

    switch (event.type) {
      case 'pipeline:started':
        break;

      case 'step:started': {
        const step = progress.steps.find(s => s.stepId === event.stepId);
        if (step) {
          step.status = 'running';
          progress.currentStep = step;
        }
        // Update session's currentStageId
        const session = this.sessions.get(sessionId);
        if (session) {
          session.currentStageId = event.stepId;
          session.updatedAt = new Date();
        }
        // Progress = steps before this one / total
        progress.progress = event.stepIndex / event.totalSteps;
        break;
      }

      case 'step:retrying': {
        const step = progress.steps.find(s => s.stepId === event.stepId);
        if (step) {
          step.attempt = event.attempt;
          step.error = event.error;
        }
        break;
      }

      case 'step:completed': {
        const step = progress.steps.find(s => s.stepId === event.stepId);
        if (step) {
          step.status = 'completed';
          step.durationMs = event.durationMs;
        }
        if (!progress.completedAgents.includes(event.agent)) {
          progress.completedAgents.push(event.agent);
        }
        progress.progress = (event.stepIndex + 1) / event.totalSteps;
        break;
      }

      case 'step:failed': {
        const step = progress.steps.find(s => s.stepId === event.stepId);
        if (step) {
          step.status = 'failed';
          step.error = event.error;
        }
        if (!progress.failedAgents.includes(event.agent)) {
          progress.failedAgents.push(event.agent);
        }
        break;
      }

      case 'step:skipped': {
        const step = progress.steps.find(s => s.stepId === event.stepId);
        if (step) {
          step.status = 'skipped';
          step.error = event.reason;
        }
        break;
      }

      case 'pipeline:completed': {
        progress.status = 'completed';
        progress.progress = 1;
        progress.currentStep = undefined;
        const session = this.sessions.get(sessionId);
        if (session) session.status = 'completed';
        break;
      }

      case 'pipeline:failed': {
        progress.status = 'failed';
        progress.currentStep = undefined;
        const session = this.sessions.get(sessionId);
        if (session) session.status = 'failed';
        break;
      }
    }

    // Notify subscribers
    const cbs = this.callbacks.get(sessionId) ?? [];
    for (const cb of cbs) {
      try { cb(progress); } catch { /* don't let callback errors break pipeline */ }
    }
  }

  /** List all active sessions */
  listActive(): Session[] {
    return Array.from(this.sessions.values()).filter(s => s.status === 'active');
  }

  /** Cleanup completed/failed sessions older than maxAge ms */
  cleanup(maxAgeMs: number = 3_600_000): number {
    const cutoff = Date.now() - maxAgeMs;
    let cleaned = 0;
    for (const [id, session] of this.sessions) {
      if (session.status !== 'active' && session.createdAt.getTime() < cutoff) {
        this.sessions.delete(id);
        this.progress.delete(id);
        this.callbacks.delete(id);
        cleaned++;
      }
    }
    if (cleaned > 0) this.logger.debug(`Cleaned up ${cleaned} old sessions`);
    return cleaned;
  }
}
