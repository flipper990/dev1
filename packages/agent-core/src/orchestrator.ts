// Pipeline Orchestrator — wave-based parallel execution.
// Types: ./pipeline-types.ts | Inputs: ./agent-input-builder.ts | Steps: ./step-executor.ts

import type { AgentRole, Session } from './types';
import type { BaseAgent, Logger, MessageBus } from './base-agent';
import { AGENT_DEFINITIONS } from './agent-registry';
import {
  type PipelineStep,
  type StepState,
  type PipelineState,
  type PipelineEvent,
  type PipelineEventHandler,
  type CachedStepResult,
  PIPELINE_STEPS,
} from './pipeline-types';
import { executeStep, getStepCacheKey, writeStepCache } from './step-executor';

// Re-export types so existing consumers of this module are unaffected.
export type {
  PipelineStep, StepState, PipelineState, StepStatus,
  PipelineEvent, PipelineEventHandler, CachedStepResult,
} from './pipeline-types';
export { PIPELINE_STEPS } from './pipeline-types';

export class PipelineOrchestrator {
  private agents: Map<AgentRole, BaseAgent>;
  private bus: MessageBus;
  private logger: Logger;
  private eventHandlers: PipelineEventHandler[] = [];
  private cancelled = false;
  private stepCache = new Map<string, CachedStepResult>();
  private readonly STEP_CACHE_TTL_MS = 30 * 60 * 1000;

  constructor(agents: Map<AgentRole, BaseAgent>, bus: MessageBus, logger: Logger) {
    this.agents = agents;
    this.bus = bus;
    this.logger = logger;
  }

  onEvent(handler: PipelineEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /** Signal cancellation — the pipeline stops after the current step. */
  cancel(): void {
    this.cancelled = true;
  }

  private emit(event: PipelineEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* handler errors must not crash the pipeline */ }
    }
  }

  /** Execute the full pipeline. seedArtifacts pre-populates step outputs for update/resume mode. */
  async execute(
    session: Session,
    seedArtifacts?: Map<AgentRole, Record<string, unknown>>,
  ): Promise<PipelineState> {
    const steps = PIPELINE_STEPS;
    const totalSteps = steps.length;
    const pipelineStart = Date.now();

    const state: PipelineState = {
      sessionId: session.id,
      status: 'running',
      currentStepIndex: 0,
      steps: steps.map(s => ({
        stepId: s.id,
        status: 'pending',
        agent: s.agent,
        attempt: 0,
        maxAttempts: AGENT_DEFINITIONS[s.agent]!.retryPolicy.maxAttempts,
        durationMs: 0,
      })),
      artifacts: new Map(),
      tasks: [],
      startedAt: new Date(),
      durationMs: 0,
      progress: 0,
      optimization: {
        cacheHits: 0, cacheMisses: 0, skippedSteps: 0,
        executedSteps: 0, estimatedApiCallsSaved: 0,
      },
    };

    if (seedArtifacts) {
      for (const [role, output] of seedArtifacts) {
        state.artifacts.set(role, output);
        const stepIdx = steps.findIndex(s => s.agent === role);
        if (stepIdx >= 0) {
          state.steps[stepIdx].status = 'completed';
          state.steps[stepIdx].durationMs = 0;
          state.optimization.skippedSteps++;
          state.optimization.estimatedApiCallsSaved++;
        }
        writeStepCache(this.stepCache, getStepCacheKey(role, output), output);
      }
    }

    this.emit({ type: 'pipeline:started', sessionId: session.id, totalSteps });
    this.logger.info(`Pipeline starting for session ${session.id}`, { totalSteps });

    try {
      const stepByAgent = new Map<AgentRole, number>(
        steps.map((s, i) => [s.agent, i] as [AgentRole, number]),
      );

      const allDepsResolved = (role: AgentRole): boolean => {
        const deps = AGENT_DEFINITIONS[role]!.dependencies as AgentRole[];
        return deps.every(dep => {
          const idx = stepByAgent.get(dep);
          if (idx === undefined) return true;
          const st = state.steps[idx].status;
          return st === 'completed' || st === 'skipped';
        });
      };

      let waveNumber = 0;

      while (state.status === 'running' && !this.cancelled) {
        const wave = steps
          .map((step, i) => ({ step, stepState: state.steps[i], i }))
          .filter(({ stepState, step }) =>
            stepState.status === 'pending' && allDepsResolved(step.agent),
          );

        if (wave.length === 0) break;

        waveNumber++;
        this.emit({
          type: 'wave:started',
          sessionId: session.id,
          wave: waveNumber,
          agents: wave.map(w => w.step.agent),
        });

        await Promise.allSettled(
          wave.map(({ step, stepState, i }) =>
            this.runWaveStep(session, step, stepState, state, i, totalSteps, pipelineStart),
          ),
        );
      }

      if (this.cancelled && state.status === 'running') {
        state.status = 'cancelled';
        state.error = 'Pipeline cancelled by user';
      }

      for (let i = 0; i < steps.length; i++) {
        if (state.steps[i].status === 'pending') {
          state.steps[i].status = 'skipped';
          state.optimization.skippedSteps++;
          this.emit({
            type: 'step:skipped',
            sessionId: session.id,
            stepId: steps[i].id,
            agent: steps[i].agent,
            reason: 'Skipped — upstream dependency did not complete',
          });
        }
      }

      state.durationMs = Date.now() - pipelineStart;

      if (state.status === 'running') {
        state.status = 'completed';
        state.progress = 1;
        const counts = this.countSteps(state);
        this.emit({ type: 'pipeline:completed', sessionId: session.id, durationMs: state.durationMs, ...counts });
        this.logger.info(`Pipeline completed for session ${session.id}`, { durationMs: state.durationMs, waves: waveNumber, ...counts });
      }

      return state;

    } catch (err) {
      state.durationMs = Date.now() - pipelineStart;
      state.status = 'failed';
      state.error = (err as Error).message;
      this.emit({
        type: 'pipeline:failed',
        sessionId: session.id,
        error: state.error,
        failedStep: PIPELINE_STEPS[state.currentStepIndex]?.id ?? 'unknown',
        durationMs: state.durationMs,
      });
      this.logger.error('Pipeline execution error', { error: state.error, sessionId: session.id });
      return state;
    }
  }

  private async runWaveStep(
    session: Session,
    step: PipelineStep,
    stepState: StepState,
    state: PipelineState,
    stepIndex: number,
    totalSteps: number,
    pipelineStart: number,
  ): Promise<void> {
    if (this.cancelled || state.status !== 'running') return;

    state.currentStepIndex = Math.max(state.currentStepIndex, stepIndex);

    if (stepState.status === 'completed') {
      state.progress = Math.max(state.progress, (stepIndex + 1) / totalSteps);
      this.emit({ type: 'step:skipped', sessionId: session.id, stepId: step.id, agent: step.agent, reason: 'Seeded from existing project state' });
      return;
    }

    this.emit({ type: 'step:started', sessionId: session.id, stepId: step.id, stepName: step.name, agent: step.agent, description: step.description, stepIndex, totalSteps });

    stepState.status = 'running';
    stepState.startedAt = new Date();

    const { task, cacheHit } = await executeStep(session, step, stepState, state, {
      agents: this.agents,
      logger: this.logger,
      emit: this.emit.bind(this),
      stepCache: this.stepCache,
      STEP_CACHE_TTL_MS: this.STEP_CACHE_TTL_MS,
    });

    state.optimization.executedSteps++;
    if (cacheHit) { state.optimization.cacheHits++; state.optimization.estimatedApiCallsSaved++; }
    else { state.optimization.cacheMisses++; }

    stepState.durationMs = Date.now() - stepState.startedAt!.getTime();
    state.tasks.push(task);

    if (task.status === 'completed') {
      stepState.status = 'completed';
      stepState.completedAt = new Date();
      stepState.taskId = task.id;
      state.artifacts.set(step.agent, task.output ?? {});
      this.emit({ type: 'step:completed', sessionId: session.id, stepId: step.id, agent: step.agent, durationMs: stepState.durationMs, stepIndex, totalSteps });
    } else {
      stepState.status = 'failed';
      stepState.error = task.error?.message ?? 'Unknown error';
      this.emit({ type: 'step:failed', sessionId: session.id, stepId: step.id, agent: step.agent, error: stepState.error, critical: step.critical });

      if (step.critical) {
        state.status = 'failed';
        state.error = `Critical step "${step.name}" failed: ${stepState.error}`;
        this.emit({ type: 'pipeline:failed', sessionId: session.id, error: state.error, failedStep: step.id, durationMs: Date.now() - pipelineStart });
      } else {
        this.logger.warn(`Non-critical step "${step.name}" failed, continuing`, { error: stepState.error });
      }
    }

    state.progress = Math.max(state.progress, (stepIndex + 1) / totalSteps);
  }

  private countSteps(state: PipelineState): { stepsCompleted: number; stepsFailed: number; stepsSkipped: number } {
    return {
      stepsCompleted: state.steps.filter(s => s.status === 'completed').length,
      stepsFailed:    state.steps.filter(s => s.status === 'failed').length,
      stepsSkipped:   state.steps.filter(s => s.status === 'skipped').length,
    };
  }
}
