// Shared pipeline-step event helpers extracted from Orchestrator.
// Each function is stateless — all mutable state is passed as parameters.

import type { PipelineState } from '@devteam/core';
import { now } from '@devteam/core';
import { sessionManager } from './session-manager.js';
import { updateStepInState } from './pipeline.js';

export type OnEventFn = (type: string, data: unknown) => void;

export function startPipelineStep(
  pipeline: PipelineState,
  role: string,
  sessionId: string,
  onEvent: OnEventFn,
): void {
  updateStepInState(pipeline, role as never, { status: 'running', startedAt: now() });
  onEvent('step.started', { role });
  sessionManager.emit(sessionId, 'step.started', { role });
  emitPipelineProgress(sessionId, pipeline);
}

interface StepResult {
  cacheHit: boolean;
  skipped: boolean;
  skipReason?: string;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export function completePipelineStep(
  pipeline: PipelineState,
  role: string,
  result: StepResult,
  sessionId: string,
  onEvent: OnEventFn,
): void {
  const status = result.skipped ? 'skipped' : 'completed';
  updateStepInState(pipeline, role as never, {
    status,
    completedAt: now(),
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    tokensUsed: result.inputTokens + result.outputTokens,
    skippedReason: result.skipReason,
  });

  if (result.cacheHit) pipeline.optimization.cacheHits++;
  else if (result.skipped) pipeline.optimization.skippedSteps++;
  else pipeline.optimization.executedSteps++;

  pipeline.optimization.estimatedApiCallsSaved =
    pipeline.optimization.cacheHits + pipeline.optimization.skippedSteps;

  onEvent(status === 'skipped' ? 'step.skipped' : 'step.completed', {
    role, durationMs: result.durationMs, cacheHit: result.cacheHit,
  });
  sessionManager.emit(sessionId, 'step.completed', { role, status });
  emitPipelineProgress(sessionId, pipeline);
}

export function emitPipelineProgress(sessionId: string, pipeline: PipelineState): void {
  const completedCount = pipeline.steps.filter(s => s.status === 'completed' || s.status === 'skipped').length;
  const totalCount = pipeline.steps.length;
  const running = pipeline.steps.find(s => s.status === 'running');
  sessionManager.emit(sessionId, 'progress', {
    sessionId: pipeline.sessionId,
    projectId: pipeline.projectId,
    status: pipeline.status,
    progress: totalCount > 0 ? completedCount / totalCount : 0,
    steps: pipeline.steps.map(step => ({
      stepId: step.role, name: step.role, agent: step.role,
      status: step.status, durationMs: step.durationMs ?? 0, error: step.error,
    })),
    currentStep: running
      ? { stepId: running.role, name: running.role, agent: running.role, description: 'Running...', attempt: 1 }
      : null,
  });
}
