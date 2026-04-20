import { Logger, now, stableStringify } from '@devteam/core';
import type {
  AgentRole,
  PipelineState,
  PipelineStep,
  StepStatus,
  OptimizationMetrics,
} from '@devteam/core';
import type { AgentContext, AgentResult } from '@devteam/agents';

// ─── Cache ────────────────────────────────────────────────────────────────────

interface CachedStep {
  output: unknown;
  cachedAt: number;
}

const STEP_CACHE = new Map<string, CachedStep>();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCacheKey(role: AgentRole, input: unknown): string {
  return `${role}:${stableStringify(input)}`;
}

function readStepCache(role: AgentRole, input: unknown): unknown | undefined {
  const key = getCacheKey(role, input);
  const cached = STEP_CACHE.get(key);
  if (!cached) return undefined;
  if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
    STEP_CACHE.delete(key);
    return undefined;
  }
  return cached.output;
}

function writeStepCache(role: AgentRole, input: unknown, output: unknown): void {
  const key = getCacheKey(role, input);
  STEP_CACHE.set(key, { output, cachedAt: Date.now() });
}

// ─── Step runner ──────────────────────────────────────────────────────────────

export interface StepRunnerOptions<TInput, TOutput> {
  role: AgentRole;
  input: TInput;
  ctx: AgentContext;
  run: (input: TInput, ctx: AgentContext) => Promise<AgentResult<TOutput>>;
  canSkip?: (input: TInput) => boolean | string; // returns false or skip reason
  useCache?: boolean;
}

export interface StepRunResult<TOutput> {
  output: TOutput;
  cacheHit: boolean;
  skipped: boolean;
  skipReason?: string;
  durationMs: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

export async function runStep<TInput, TOutput>(
  options: StepRunnerOptions<TInput, TOutput>,
): Promise<StepRunResult<TOutput>> {
  const { role, input, ctx, run, canSkip, useCache = true } = options;
  const logger = new Logger(`step:${role}`);

  // ── Skip check ─────────────────────────────────────────────────────────
  if (canSkip) {
    const skipResult = canSkip(input);
    if (skipResult !== false) {
      const reason = typeof skipResult === 'string' ? skipResult : 'Condition not met';
      logger.info('Skipping step', { reason });
      return {
        output: undefined as unknown as TOutput,
        cacheHit: false,
        skipped: true,
        skipReason: reason,
        durationMs: 0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }

  // ── Cache check ────────────────────────────────────────────────────────
  if (useCache) {
    const cached = readStepCache(role, input);
    if (cached !== undefined) {
      logger.info('Cache hit');
      return {
        output: cached as TOutput,
        cacheHit: true,
        skipped: false,
        durationMs: 0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
    }
  }

  // ── Execute ────────────────────────────────────────────────────────────
  const result = await run(input, ctx);

  if (useCache) {
    writeStepCache(role, input, result.output);
  }

  return {
    output: result.output,
    cacheHit: false,
    skipped: false,
    durationMs: result.durationMs,
    costUsd: result.costUsd,
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
  };
}

// ─── Pipeline state builder ────────────────────────────────────────────────────

export function buildInitialPipelineState(
  sessionId: string,
  projectId: string,
  roles: AgentRole[],
): PipelineState {
  return {
    sessionId,
    projectId,
    status: 'running',
    steps: roles.map((role) => ({
      role,
      status: 'pending' as StepStatus,
    })),
    startedAt: now(),
    optimization: {
      cacheHits: 0,
      cacheMisses: 0,
      skippedSteps: 0,
      executedSteps: 0,
      estimatedApiCallsSaved: 0,
    } satisfies OptimizationMetrics,
  };
}

export function updateStepInState(
  state: PipelineState,
  role: AgentRole,
  patch: Partial<PipelineStep>,
): void {
  const step = state.steps.find((s) => s.role === role);
  if (step) Object.assign(step, patch);
}

export function finalizeState(state: PipelineState, status: 'completed' | 'failed'): void {
  state.status = status;
  state.completedAt = now();
  state.totalDurationMs = state.steps.reduce((acc, s) => acc + (s.durationMs ?? 0), 0);
  state.totalCostUsd = state.steps.reduce((acc, s) => acc + (s.costUsd ?? 0), 0);
  state.totalTokens = state.steps.reduce(
    (acc, s) => acc + (s.tokensUsed ?? 0),
    0,
  );
}
