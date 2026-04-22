// ─────────────────────────────────────────────────────────────
// Step Executor — Retry loop with exponential backoff,
// step-level caching, and timeout enforcement.
// ─────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import type { AgentRole, Session, Task } from './types';
import type { BaseAgent, Logger } from './base-agent';
import { AGENT_DEFINITIONS } from './agent-registry';
import { createTask, createExecutionContext } from './agent-runner';
import type { PipelineStep, StepState, PipelineState, CachedStepResult, PipelineEvent } from './pipeline-types';
import { buildAgentInput } from './agent-input-builder';

// ── Context passed from the orchestrator into each step ─────

export interface StepExecutionContext {
  agents: Map<AgentRole, BaseAgent>;
  logger: Logger;
  emit: (event: PipelineEvent) => void;
  stepCache: Map<string, CachedStepResult>;
  STEP_CACHE_TTL_MS: number;
}

// ── Public API ──────────────────────────────────────────────

export async function executeStep(
  session: Session,
  step: PipelineStep,
  stepState: StepState,
  pipelineState: PipelineState,
  ctx: StepExecutionContext,
): Promise<{ task: Task; cacheHit: boolean }> {
  const agent = ctx.agents.get(step.agent);
  if (!agent) throw new Error(`No agent registered for role: ${step.agent}`);

  const definition = agent.getDefinition();
  const policy = definition.retryPolicy;

  const input = buildAgentInput(session, step.agent, pipelineState.artifacts);

  const task = createTask(session.id, step.agent, input, {
    priority: getStepPriority(step.id),
    maxAttempts: policy.maxAttempts,
  });

  const cacheKey = getStepCacheKey(step.agent, input);
  const cached = readStepCache(ctx.stepCache, cacheKey, ctx.STEP_CACHE_TTL_MS);
  if (cached) {
    task.status = 'completed';
    task.output = cached;
    task.startedAt = new Date();
    task.completedAt = new Date();
    task.metadata = {
      model: definition.model.model,
      provider: definition.model.provider,
      tokensIn: 0, tokensOut: 0, latencyMs: 0, costUsd: 0, memoryEntriesUsed: 0,
    };
    return { task, cacheHit: true };
  }

  const traceId = `pipeline-${session.id}`;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    stepState.attempt = attempt;
    task.attempt = attempt;
    task.status = attempt > 1 ? 'retrying' : 'in-progress';
    task.startedAt = new Date();

    if (attempt > 1) {
      agent.recordRetry();
      ctx.emit({
        type: 'step:retrying',
        sessionId: session.id,
        stepId: step.id,
        agent: step.agent,
        attempt,
        maxAttempts: policy.maxAttempts,
        error: task.error?.message ?? 'Unknown',
      });

      const delay = Math.min(
        policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
        policy.maxDelayMs,
      );
      const jitter = delay * 0.25 * (Math.random() * 2 - 1);
      await sleep(Math.max(100, Math.round(delay + jitter)));
    }

    const execCtx = createExecutionContext(session.id, step.agent, {
      traceId,
      parentSpanId: task.parentTaskId,
    });
    execCtx.attempt = attempt;

    try {
      const result = await Promise.race([
        agent.execute({ ...task }, execCtx),
        timeout(definition.timeoutMs, step.agent),
      ]);

      if (result.status === 'completed') {
        task.status = 'completed';
        task.output = result.output;
        task.completedAt = new Date();
        task.metadata = result.metadata;
        writeStepCache(ctx.stepCache, cacheKey, task.output ?? {});
        return { task, cacheHit: false };
      }

      task.error = result.error;

      if (result.error && !result.error.retryable) {
        ctx.logger.warn(`Agent ${step.agent} non-retryable error`, { error: result.error.message });
        break;
      }

      if (result.error && !policy.retryableErrors.includes(result.error.code)) {
        ctx.logger.warn(`Agent ${step.agent} error code ${result.error.code} not retryable`);
        break;
      }

    } catch (err) {
      task.error = {
        code: 'EXECUTION_ERROR',
        message: (err as Error).message,
        retryable: true,
      };
    }

    ctx.logger.warn(`Step "${step.name}" attempt ${attempt}/${policy.maxAttempts} failed`, {
      agent: step.agent,
      error: task.error?.message,
    });
  }

  task.status = 'failed';
  return { task, cacheHit: false };
}

/** Deterministic cache key from role + input hash. */
export function getStepCacheKey(role: AgentRole, input: Record<string, unknown>): string {
  const serialized = stableStringify({ role, input });
  return createHash('sha256').update(serialized).digest('hex');
}

/** Write a step result into the provided cache map. */
export function writeStepCache(
  cache: Map<string, CachedStepResult>,
  key: string,
  output: Record<string, unknown>,
): void {
  cache.set(key, { output, cachedAt: Date.now() });
}

// ── Private Helpers ─────────────────────────────────────────

function readStepCache(
  cache: Map<string, CachedStepResult>,
  key: string,
  ttlMs: number,
): Record<string, unknown> | null {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.cachedAt > ttlMs) {
    cache.delete(key);
    return null;
  }
  return item.output;
}

function getStepPriority(stepId: string): number {
  const priorities: Record<string, number> = {
    plan: 1, design: 2, code: 3, review: 4, test: 5, fix: 6, optimize: 7, deploy: 8,
  };
  return priorities[stepId] ?? 5;
}

function timeout(ms: number, agent: AgentRole): Promise<Task> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Agent ${agent} timed out after ${ms}ms`)), ms),
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortRecursively(value));
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortRecursively);
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      out[key] = sortRecursively(obj[key]);
    }
    return out;
  }
  return value;
}
