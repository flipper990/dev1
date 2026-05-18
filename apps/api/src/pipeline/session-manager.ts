import type { Session, AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { PipelineEvent, StepStatus } from '../../../../packages/agent-core/src/orchestrator.js';
import { PIPELINE_STEPS } from '../../../../packages/agent-core/src/orchestrator.js';

export type RuntimeExecutionPhase =
  | 'queued'
  | 'planning'
  | 'architecting'
  | 'backend_generation'
  | 'frontend_generation'
  | 'verification'
  | 'preview_build'
  | 'artifact_packaging'
  | 'completed'
  | 'failed'
  | 'timed_out'
  | 'provider_unavailable'
  | 'retrying';

export interface SessionWatchdogFailure {
  sessionId: string;
  reason: 'mission-timeout' | 'stalled-step' | 'heartbeat-timeout';
  executionPhase: RuntimeExecutionPhase;
  currentStep: string | null;
  ageMs: number;
  heartbeatAgeMs: number;
  timeoutAt: string;
  diagnostics: string;
}

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
  progress: number;
  executionPhase: RuntimeExecutionPhase;
  providerStatus: Record<string, boolean>;
  retryAttempt: number;
  activeWorker: AgentRole | 'system' | null;
  lastHeartbeatAt: string;
  timeoutAt: string | null;
  timeoutRemainingMs: number | null;
  failureReason: string | null;
  currentStep?: StepProgress;
  steps: StepProgress[];
  completedAgents: AgentRole[];
  failedAgents: AgentRole[];
  events: PipelineEvent[];
  startedAt: Date;
  durationMs: number;
  currentStepStartedAt?: Date;
}

export type ProgressCallback = (progress: SessionProgress) => void;

export class SessionManager {
  private sessions: Map<string, Session> = new Map();
  private progress: Map<string, SessionProgress> = new Map();
  private callbacks: Map<string, ProgressCallback[]> = new Map();
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
  }

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

    const stepProgress: StepProgress[] = PIPELINE_STEPS.map((s) => ({
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
      executionPhase: 'queued',
      providerStatus: {},
      retryAttempt: 0,
      activeWorker: null,
      lastHeartbeatAt: new Date().toISOString(),
      timeoutAt: null,
      timeoutRemainingMs: null,
      failureReason: null,
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

  get(id: string): Session | undefined {
    return this.sessions.get(id);
  }

  getProgress(id: string): SessionProgress | undefined {
    const p = this.progress.get(id);
    if (p) {
      const now = Date.now();
      p.durationMs = now - p.startedAt.getTime();
      p.timeoutRemainingMs = p.timeoutAt ? Math.max(0, Date.parse(p.timeoutAt) - now) : null;
    }
    return p;
  }

  setProviderStatus(sessionId: string, providerStatus: Record<string, boolean>): void {
    const progress = this.progress.get(sessionId);
    if (!progress) return;
    progress.providerStatus = { ...providerStatus };
    this.touchHeartbeat(progress, {
      forcePhase: this.toExecutionPhase(progress.executionPhase, progress.currentStep?.stepId),
    });
    this.emit(progress);
  }

  markRetrying(sessionId: string, reason: string): void {
    const progress = this.progress.get(sessionId);
    if (!progress) return;
    progress.retryAttempt += 1;
    progress.failureReason = reason;
    progress.executionPhase = 'retrying';
    this.touchHeartbeat(progress, { forcePhase: 'retrying' });
    this.emit(progress);
  }

  markProviderUnavailable(sessionId: string, diagnostics: string): void {
    let progress = this.progress.get(sessionId);
    if (!progress) {
      const stepProgress: StepProgress[] = PIPELINE_STEPS.map((s) => ({
        stepId: s.id,
        name: s.name,
        agent: s.agent,
        status: 'pending' as StepStatus,
        description: s.description,
        durationMs: 0,
        attempt: 0,
      }));
      progress = {
        sessionId,
        status: 'failed',
        progress: 0,
        executionPhase: 'provider_unavailable',
        providerStatus: {},
        retryAttempt: 0,
        activeWorker: null,
        lastHeartbeatAt: new Date().toISOString(),
        timeoutAt: null,
        timeoutRemainingMs: null,
        failureReason: diagnostics,
        steps: stepProgress,
        completedAgents: [],
        failedAgents: [],
        events: [],
        startedAt: new Date(),
        durationMs: 0,
      };
      this.progress.set(sessionId, progress);
    }
    progress.status = 'failed';
    progress.executionPhase = 'provider_unavailable';
    progress.failureReason = diagnostics;
    progress.currentStep = undefined;
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = {
        id: sessionId,
        userId: 'system',
        prompts: [],
        status: 'failed',
        pipelineId: 'default-fullstack',
        currentStageId: 'failed',
        artifacts: new Map(),
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.sessions.set(sessionId, session);
    } else {
      session.status = 'failed';
      session.updatedAt = new Date();
    }
    this.touchHeartbeat(progress, { forcePhase: 'provider_unavailable' });
    this.emit(progress);
  }

  markHeartbeat(
    sessionId: string,
    patch: {
      phase?: string;
      step?: string;
      activeWorker?: AgentRole | 'system' | null;
      timeoutAt?: string | null;
      providerStatus?: Record<string, boolean>;
    },
  ): void {
    const progress = this.progress.get(sessionId);
    if (!progress) return;
    if (patch.providerStatus) progress.providerStatus = { ...patch.providerStatus };
    if (patch.activeWorker !== undefined) progress.activeWorker = patch.activeWorker;
    if (patch.timeoutAt !== undefined) progress.timeoutAt = patch.timeoutAt;
    const targetStep = patch.step ?? progress.currentStep?.stepId;
    const targetPhase = patch.phase ?? progress.executionPhase;
    this.touchHeartbeat(progress, { forcePhase: this.toExecutionPhase(targetPhase, targetStep) });
    this.emit(progress);
  }

  sweepStalled(opts?: {
    missionTimeoutMs?: number;
    heartbeatTimeoutMs?: number;
    stalledStepTimeoutMs?: number;
  }): SessionWatchdogFailure[] {
    const missionTimeoutMs = Math.max(60_000, opts?.missionTimeoutMs ?? 45 * 60 * 1000);
    const heartbeatTimeoutMs = Math.max(15_000, opts?.heartbeatTimeoutMs ?? 90_000);
    const stalledStepTimeoutMs = Math.max(30_000, opts?.stalledStepTimeoutMs ?? 8 * 60 * 1000);
    const now = Date.now();
    const failures: SessionWatchdogFailure[] = [];

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.status !== 'active') continue;
      const progress = this.progress.get(sessionId);
      if (!progress) continue;
      const startedAtMs = progress.startedAt.getTime();
      const heartbeatAtMs = Date.parse(progress.lastHeartbeatAt);
      const heartbeatAgeMs = Number.isFinite(heartbeatAtMs) ? Math.max(0, now - heartbeatAtMs) : now - startedAtMs;
      const stepAgeMs = progress.currentStepStartedAt ? now - progress.currentStepStartedAt.getTime() : 0;
      const ageMs = now - startedAtMs;

      let reason: SessionWatchdogFailure['reason'] | null = null;
      if (ageMs >= missionTimeoutMs) {
        reason = 'mission-timeout';
      } else if (stepAgeMs > stalledStepTimeoutMs && progress.currentStep?.status === 'running') {
        reason = 'stalled-step';
      } else if (heartbeatAgeMs > heartbeatTimeoutMs) {
        reason = 'heartbeat-timeout';
      }
      if (!reason) continue;

      const timeoutAt = new Date(now).toISOString();
      const currentStep = progress.currentStep?.stepId ?? null;
      const diagnostics = `watchdog=${reason}; ageMs=${ageMs}; heartbeatAgeMs=${heartbeatAgeMs}; currentStep=${currentStep ?? 'none'}`;
      progress.status = 'failed';
      progress.executionPhase = reason === 'mission-timeout' ? 'timed_out' : 'failed';
      progress.failureReason = diagnostics;
      progress.currentStep = undefined;
      progress.lastHeartbeatAt = timeoutAt;
      session.status = 'failed';
      session.updatedAt = new Date(timeoutAt);
      this.emit(progress);

      failures.push({
        sessionId,
        reason,
        executionPhase: progress.executionPhase,
        currentStep,
        ageMs,
        heartbeatAgeMs,
        timeoutAt,
        diagnostics,
      });
    }

    return failures;
  }

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

  handleEvent(event: PipelineEvent): void {
    const sessionId = event.sessionId;
    const progress = this.progress.get(sessionId);
    if (!progress) return;

    progress.events.push(event);
    progress.durationMs = Date.now() - progress.startedAt.getTime();

    switch (event.type) {
      case 'pipeline:started': {
        this.touchHeartbeat(progress, { forcePhase: this.toExecutionPhase(progress.executionPhase) });
        break;
      }

      case 'step:started': {
        const step = progress.steps.find((s) => s.stepId === event.stepId);
        if (step) {
          step.status = 'running';
          progress.currentStep = step;
          progress.currentStepStartedAt = new Date();
        }
        const session = this.sessions.get(sessionId);
        if (session) {
          session.currentStageId = event.stepId;
          session.updatedAt = new Date();
        }
        progress.progress = event.stepIndex / event.totalSteps;
        progress.activeWorker = event.agent;
        progress.executionPhase = this.toExecutionPhase(progress.executionPhase, event.stepId);
        this.touchHeartbeat(progress, { forcePhase: progress.executionPhase });
        break;
      }

      case 'step:retrying': {
        const step = progress.steps.find((s) => s.stepId === event.stepId);
        if (step) {
          step.attempt = event.attempt;
          step.error = event.error;
        }
        progress.retryAttempt = Math.max(progress.retryAttempt, event.attempt);
        progress.executionPhase = 'retrying';
        progress.failureReason = event.error ?? null;
        this.touchHeartbeat(progress, { forcePhase: 'retrying' });
        break;
      }

      case 'step:completed': {
        const step = progress.steps.find((s) => s.stepId === event.stepId);
        if (step) {
          step.status = 'completed';
          step.durationMs = event.durationMs;
        }
        if (!progress.completedAgents.includes(event.agent)) {
          progress.completedAgents.push(event.agent);
        }
        progress.progress = (event.stepIndex + 1) / event.totalSteps;
        progress.activeWorker = event.agent;
        progress.executionPhase = this.toExecutionPhase(progress.executionPhase, event.stepId);
        this.touchHeartbeat(progress, { forcePhase: progress.executionPhase });
        break;
      }

      case 'step:failed': {
        const step = progress.steps.find((s) => s.stepId === event.stepId);
        if (step) {
          step.status = 'failed';
          step.error = event.error;
        }
        if (!progress.failedAgents.includes(event.agent)) {
          progress.failedAgents.push(event.agent);
        }
        progress.activeWorker = event.agent;
        progress.executionPhase = 'failed';
        progress.failureReason = event.error ?? null;
        this.touchHeartbeat(progress, { forcePhase: 'failed' });
        break;
      }

      case 'step:skipped': {
        const step = progress.steps.find((s) => s.stepId === event.stepId);
        if (step) {
          step.status = 'skipped';
          step.error = event.reason;
        }
        this.touchHeartbeat(progress, {
          forcePhase: this.toExecutionPhase(progress.executionPhase, event.stepId),
        });
        break;
      }

      case 'pipeline:completed': {
        progress.status = 'completed';
        progress.progress = 1;
        progress.executionPhase = 'completed';
        progress.currentStep = undefined;
        progress.failureReason = null;
        const session = this.sessions.get(sessionId);
        if (session) session.status = 'completed';
        this.touchHeartbeat(progress, { forcePhase: 'completed' });
        break;
      }

      case 'pipeline:failed': {
        progress.status = 'failed';
        progress.executionPhase = 'failed';
        progress.currentStep = undefined;
        progress.failureReason = event.error ?? 'pipeline failed';
        const session = this.sessions.get(sessionId);
        if (session) session.status = 'failed';
        this.touchHeartbeat(progress, { forcePhase: 'failed' });
        break;
      }
    }

    this.emit(progress);
  }

  listActive(): Session[] {
    return Array.from(this.sessions.values()).filter((s) => s.status === 'active');
  }

  listProgressSnapshots(): SessionProgress[] {
    return Array.from(this.progress.values()).map((entry) => ({ ...entry }));
  }

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

  private touchHeartbeat(
    progress: SessionProgress,
    opts?: { forcePhase?: RuntimeExecutionPhase },
  ): void {
    const nowIso = new Date().toISOString();
    progress.lastHeartbeatAt = nowIso;
    if (opts?.forcePhase) progress.executionPhase = opts.forcePhase;
    progress.durationMs = Date.now() - progress.startedAt.getTime();
    progress.timeoutRemainingMs = progress.timeoutAt
      ? Math.max(0, Date.parse(progress.timeoutAt) - Date.now())
      : null;
  }

  private emit(progress: SessionProgress): void {
    const cbs = this.callbacks.get(progress.sessionId) ?? [];
    for (const cb of cbs) {
      try {
        cb(progress);
      } catch {
        // callback errors are non-fatal
      }
    }
  }

  private toExecutionPhase(phase: string, stepId?: string): RuntimeExecutionPhase {
    const p = (phase ?? '').toLowerCase();
    const s = (stepId ?? '').toLowerCase();
    if (p === 'completed') return 'completed';
    if (p === 'failed') return 'failed';
    if (p === 'timed_out') return 'timed_out';
    if (p === 'provider_unavailable') return 'provider_unavailable';
    if (p === 'retrying') return 'retrying';
    if (!p || p === 'init' || p === 'reserve' || s.includes('reserve')) return 'queued';
    if (p === 'spec') {
      if (s.includes('returned') || s.includes('architect')) return 'architecting';
      return 'planning';
    }
    if (p.includes('slice') || s.includes('builder') || s.includes('backend')) return 'backend_generation';
    if (p.includes('final-assembly') || s.includes('frontend') || s.includes('assemble')) return 'frontend_generation';
    if (p.includes('qa') || s.includes('qa') || s.includes('verify') || p.includes('execution-validation') || p.includes('runtime-validation')) {
      return 'verification';
    }
    if (p.includes('preview') || s.includes('preview')) return 'preview_build';
    if (p.includes('finalize') || s.includes('package') || s.includes('manifest') || s.includes('export')) return 'artifact_packaging';
    return 'planning';
  }
}
