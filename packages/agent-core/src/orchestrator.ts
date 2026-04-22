// ─────────────────────────────────────────────────────────────
// Pipeline Orchestrator — Step-by-step execution with state
// tracking, error recovery, and checkpoint/resume support.
//
// Execution model:
//   7 sequential stages, each with one primary agent.
//   Each stage: prepare input → run agent (with retry) →
//               validate output → store artifact → checkpoint.
//
// Error recovery:
//   1. Automatic retry with exponential backoff (per agent config)
//   2. Fallback model on repeated LLM failures
//   3. Skip optional stages on unrecoverable failure
//   4. Pipeline abort on critical-stage failure
// ─────────────────────────────────────────────────────────────

import type {
  AgentRole,
  ExecutionContext,
  Session,
  Task,
  TaskStatus,
  TaskError,
} from './types';
import { createHash } from 'node:crypto';
import type { BaseAgent, Logger, MessageBus } from './base-agent';
import { AGENT_DEFINITIONS } from './agent-registry';
import { createTask, createExecutionContext } from './agent-runner';

// ── Pipeline Step Definition ────────────────────────────────

export interface PipelineStep {
  id: string;
  name: string;
  agent: AgentRole;
  /** Is this step required for the pipeline to succeed? */
  critical: boolean;
  /** Description shown in progress UI. */
  description: string;
}

/** The canonical 8-step fullstack generation pipeline. */
export const PIPELINE_STEPS: PipelineStep[] = [
  { id: 'plan',     name: 'Planning',       agent: 'planner',   critical: true,  description: 'Analyzing prompts and defining project scope' },
  { id: 'design',   name: 'Architecture',   agent: 'architect', critical: true,  description: 'Designing system architecture and tech stack' },
  { id: 'code',     name: 'Development',    agent: 'developer', critical: true,  description: 'Writing source code for all components' },
  { id: 'review',   name: 'Code Review',    agent: 'reviewer',  critical: false, description: 'Reviewing code quality and finding issues' },
  { id: 'test',     name: 'Testing',        agent: 'tester',    critical: false, description: 'Generating test suites' },
  { id: 'fix',      name: 'Bug Fixing',     agent: 'debugger',  critical: false, description: 'Fixing identified issues' },
  { id: 'optimize', name: 'Optimization',   agent: 'optimizer', critical: false, description: 'Applying performance and code quality optimizations' },
  { id: 'deploy',   name: 'DevOps',         agent: 'devops',    critical: false, description: 'Preparing deployment configuration' },
];

// ── Pipeline State ──────────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface StepState {
  stepId: string;
  status: StepStatus;
  agent: AgentRole;
  attempt: number;
  maxAttempts: number;
  taskId?: string;
  error?: string;
  durationMs: number;
  startedAt?: Date;
  completedAt?: Date;
}

export interface PipelineState {
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  steps: StepState[];
  artifacts: Map<AgentRole, Record<string, unknown>>;
  tasks: Task[];
  startedAt: Date;
  durationMs: number;
  /** Number of steps finished (completed + skipped) out of total. */
  progress: number;
  optimization: {
    cacheHits: number;
    cacheMisses: number;
    skippedSteps: number;
    executedSteps: number;
    estimatedApiCallsSaved: number;
  };
  error?: string;
}

interface CachedStepResult {
  output: Record<string, unknown>;
  cachedAt: number;
}

// ── Pipeline Events ─────────────────────────────────────────

export type PipelineEvent =
  | { type: 'pipeline:started';    sessionId: string; totalSteps: number }
  | { type: 'step:started';        sessionId: string; stepId: string; stepName: string; agent: AgentRole; description: string; stepIndex: number; totalSteps: number }
  | { type: 'step:retrying';       sessionId: string; stepId: string; agent: AgentRole; attempt: number; maxAttempts: number; error: string }
  | { type: 'step:completed';      sessionId: string; stepId: string; agent: AgentRole; durationMs: number; stepIndex: number; totalSteps: number }
  | { type: 'step:failed';         sessionId: string; stepId: string; agent: AgentRole; error: string; critical: boolean }
  | { type: 'step:skipped';        sessionId: string; stepId: string; agent: AgentRole; reason: string }
  | { type: 'pipeline:completed';  sessionId: string; durationMs: number; stepsCompleted: number; stepsFailed: number; stepsSkipped: number }
  | { type: 'pipeline:failed';     sessionId: string; error: string; failedStep: string; durationMs: number };

export type PipelineEventHandler = (event: PipelineEvent) => void;

// ── Orchestrator ────────────────────────────────────────────

export class PipelineOrchestrator {
  private agents: Map<AgentRole, BaseAgent>;
  private bus: MessageBus;
  private logger: Logger;
  private eventHandlers: PipelineEventHandler[] = [];
  private cancelled = false;
  private stepCache = new Map<string, CachedStepResult>();
  private readonly STEP_CACHE_TTL_MS = 30 * 60 * 1000;

  constructor(
    agents: Map<AgentRole, BaseAgent>,
    bus: MessageBus,
    logger: Logger,
  ) {
    this.agents = agents;
    this.bus = bus;
    this.logger = logger;
  }

  onEvent(handler: PipelineEventHandler): void {
    this.eventHandlers.push(handler);
  }

  /** Signal cancellation — the pipeline will stop after the current step. */
  cancel(): void {
    this.cancelled = true;
  }

  private emit(event: PipelineEvent): void {
    for (const handler of this.eventHandlers) {
      try { handler(event); } catch { /* handler errors must not crash pipeline */ }
    }
  }

  // ══════════════════════════════════════════════════════════
  // Main Execution — 7 sequential steps
  // ══════════════════════════════════════════════════════════

  async execute(session: Session): Promise<PipelineState> {
    const steps = PIPELINE_STEPS;
    const totalSteps = steps.length;
    const pipelineStart = Date.now();

    // Initialize state
    const state: PipelineState = {
      sessionId: session.id,
      status: 'running',
      currentStepIndex: 0,
      steps: steps.map(s => ({
        stepId: s.id,
        status: 'pending',
        agent: s.agent,
        attempt: 0,
        maxAttempts: AGENT_DEFINITIONS[s.agent].retryPolicy.maxAttempts,
        durationMs: 0,
      })),
      artifacts: new Map(),
      tasks: [],
      startedAt: new Date(),
      durationMs: 0,
      progress: 0,
      optimization: {
        cacheHits: 0,
        cacheMisses: 0,
        skippedSteps: 0,
        executedSteps: 0,
        estimatedApiCallsSaved: 0,
      },
    };

    this.emit({ type: 'pipeline:started', sessionId: session.id, totalSteps });
    this.logger.info(`Pipeline starting for session ${session.id}`, { totalSteps });

    try {
      for (let i = 0; i < steps.length; i++) {
        // Check cancellation
        if (this.cancelled) {
          state.status = 'cancelled';
          state.error = 'Pipeline cancelled by user';
          break;
        }

        const step = steps[i];
        const stepState = state.steps[i];
        state.currentStepIndex = i;

        // ── Check if upstream dependencies have artifacts ──
        const missingDep = this.checkDependencies(step.agent, state.artifacts);
        if (missingDep && step.critical) {
          const error = `Missing required input from ${missingDep}`;
          stepState.status = 'failed';
          stepState.error = error;
          state.status = 'failed';
          state.error = error;
          this.emit({ type: 'step:failed', sessionId: session.id, stepId: step.id, agent: step.agent, error, critical: true });
          this.emit({ type: 'pipeline:failed', sessionId: session.id, error, failedStep: step.id, durationMs: Date.now() - pipelineStart });
          break;
        }
        if (missingDep && !step.critical) {
          stepState.status = 'skipped';
          state.optimization.skippedSteps++;
          state.optimization.estimatedApiCallsSaved++;
          this.emit({ type: 'step:skipped', sessionId: session.id, stepId: step.id, agent: step.agent, reason: `Missing input from ${missingDep}` });
          state.progress = (i + 1) / totalSteps;
          continue;
        }

        const skipReason = this.shouldSkipStep(step.agent, state.artifacts);
        if (skipReason) {
          stepState.status = 'skipped';
          stepState.error = skipReason;
          state.optimization.skippedSteps++;
          state.optimization.estimatedApiCallsSaved++;
          this.emit({
            type: 'step:skipped',
            sessionId: session.id,
            stepId: step.id,
            agent: step.agent,
            reason: skipReason,
          });
          state.progress = (i + 1) / totalSteps;
          continue;
        }

        // ── Execute step ──
        this.emit({
          type: 'step:started',
          sessionId: session.id,
          stepId: step.id,
          stepName: step.name,
          agent: step.agent,
          description: step.description,
          stepIndex: i,
          totalSteps,
        });

        stepState.status = 'running';
        stepState.startedAt = new Date();

        const { task, cacheHit } = await this.executeStep(session, step, stepState, state);

        state.optimization.executedSteps++;
        if (cacheHit) {
          state.optimization.cacheHits++;
          state.optimization.estimatedApiCallsSaved++;
        } else {
          state.optimization.cacheMisses++;
        }

        stepState.durationMs = Date.now() - stepState.startedAt.getTime();
        state.tasks.push(task);

        if (task.status === 'completed') {
          stepState.status = 'completed';
          stepState.completedAt = new Date();
          stepState.taskId = task.id;

          // Store artifact
          state.artifacts.set(step.agent, task.output ?? {});

          this.emit({
            type: 'step:completed',
            sessionId: session.id,
            stepId: step.id,
            agent: step.agent,
            durationMs: stepState.durationMs,
            stepIndex: i,
            totalSteps,
          });
        } else {
          // Step failed after all retries
          stepState.status = 'failed';
          stepState.error = task.error?.message ?? 'Unknown error';

          this.emit({
            type: 'step:failed',
            sessionId: session.id,
            stepId: step.id,
            agent: step.agent,
            error: stepState.error,
            critical: step.critical,
          });

          if (step.critical) {
            state.status = 'failed';
            state.error = `Critical step "${step.name}" failed: ${stepState.error}`;
            this.emit({
              type: 'pipeline:failed',
              sessionId: session.id,
              error: state.error,
              failedStep: step.id,
              durationMs: Date.now() - pipelineStart,
            });
            break;
          }

          // Non-critical: skip and continue
          this.logger.warn(`Non-critical step "${step.name}" failed, continuing`, { error: stepState.error });
        }

        state.progress = (i + 1) / totalSteps;
      }

      // Finalize
      state.durationMs = Date.now() - pipelineStart;

      if (state.status === 'running') {
        state.status = 'completed';
        state.progress = 1;

        const counts = this.countSteps(state);
        this.emit({
          type: 'pipeline:completed',
          sessionId: session.id,
          durationMs: state.durationMs,
          ...counts,
        });

        this.logger.info(`Pipeline completed for session ${session.id}`, {
          durationMs: state.durationMs,
          ...counts,
        });
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

  // ══════════════════════════════════════════════════════════
  // Step Execution — Retry loop with backoff + fallback
  // ══════════════════════════════════════════════════════════

  private async executeStep(
    session: Session,
    step: PipelineStep,
    stepState: StepState,
    pipelineState: PipelineState,
  ): Promise<{ task: Task; cacheHit: boolean }> {
    const agent = this.agents.get(step.agent);
    if (!agent) throw new Error(`No agent registered for role: ${step.agent}`);

    const definition = agent.getDefinition();
    const policy = definition.retryPolicy;

    // Build input from session + upstream artifacts
    const input = this.buildAgentInput(session, step.agent, pipelineState.artifacts);

    const task = createTask(session.id, step.agent, input, {
      priority: this.getStepPriority(step.id),
      maxAttempts: policy.maxAttempts,
    });

    const cacheKey = this.getStepCacheKey(step.agent, input);
    const cached = this.readStepCache(cacheKey);
    if (cached) {
      task.status = 'completed';
      task.output = cached;
      task.startedAt = new Date();
      task.completedAt = new Date();
      task.metadata = {
        model: definition.model.model,
        provider: definition.model.provider,
        tokensIn: 0,
        tokensOut: 0,
        latencyMs: 0,
        costUsd: 0,
        memoryEntriesUsed: 0,
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
        this.emit({
          type: 'step:retrying',
          sessionId: session.id,
          stepId: step.id,
          agent: step.agent,
          attempt,
          maxAttempts: policy.maxAttempts,
          error: task.error?.message ?? 'Unknown',
        });

        // Exponential backoff with jitter
        const delay = Math.min(
          policy.baseDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1),
          policy.maxDelayMs,
        );
        const jitter = delay * 0.25 * (Math.random() * 2 - 1);
        await this.sleep(Math.max(100, Math.round(delay + jitter)));
      }

      const ctx = createExecutionContext(session.id, step.agent, {
        traceId,
        parentSpanId: task.parentTaskId,
      });
      ctx.attempt = attempt;

      try {
        // Execute with timeout
        const result = await Promise.race([
          agent.execute({ ...task }, ctx),
          this.timeout(definition.timeoutMs, step.agent),
        ]);

        if (result.status === 'completed') {
          task.status = 'completed';
          task.output = result.output;
          task.completedAt = new Date();
          task.metadata = result.metadata;
          this.writeStepCache(cacheKey, task.output ?? {});
          return { task, cacheHit: false };
        }

        // Task returned failed status
        task.error = result.error;

        // Non-retryable error — break immediately
        if (result.error && !result.error.retryable) {
          this.logger.warn(`Agent ${step.agent} non-retryable error`, { error: result.error.message });
          break;
        }

        if (result.error && !policy.retryableErrors.includes(result.error.code)) {
          this.logger.warn(`Agent ${step.agent} error code ${result.error.code} not retryable`);
          break;
        }

      } catch (err) {
        task.error = {
          code: 'EXECUTION_ERROR',
          message: (err as Error).message,
          retryable: true,
        };
      }

      this.logger.warn(`Step "${step.name}" attempt ${attempt}/${policy.maxAttempts} failed`, {
        agent: step.agent,
        error: task.error?.message,
      });
    }

    // All attempts exhausted
    task.status = 'failed';
    return { task, cacheHit: false };
  }

  // ══════════════════════════════════════════════════════════
  // Input Assembly — Builds agent input from upstream artifacts
  // ══════════════════════════════════════════════════════════

  private buildAgentInput(
    session: Session,
    role: AgentRole,
    artifacts: Map<AgentRole, Record<string, unknown>>,
  ): Record<string, unknown> {
    const input: Record<string, unknown> = {};

    switch (role) {
      case 'planner':
        input.prompts = session.prompts;
        input.userPreferences = session.artifacts.get('userPreferences') ?? {};
        input.globalMemoryHints = session.artifacts.get('globalMemoryHints') ?? [];
        break;

      case 'architect':
        input.plan = artifacts.get('planner') ?? {};
        input.userPreferences = session.artifacts.get('userPreferences') ?? {};
        input.globalMemoryHints = session.artifacts.get('globalMemoryHints') ?? [];
        break;

      case 'developer': {
        const archArtifact = artifacts.get('architect') as { fileTree?: string[] } | undefined;
        const fileTree: string[] = Array.isArray(archArtifact?.fileTree) ? archArtifact.fileTree : [];
        const devConcurrency = AGENT_DEFINITIONS['developer'].maxConcurrency ?? 1;
        // Partition file tree into chunks for parallel execution awareness.
        // The pipeline runs one task, but we pass all files; partitioning
        // is surfaced so the agent prompt can self-batch large trees.
        const chunkSize = Math.max(1, Math.ceil(fileTree.length / devConcurrency));
        input.spec = artifacts.get('architect') ?? {};
        input.fileAssignment = fileTree;
        input.fileChunkSize = chunkSize;
        // Populate context with any previously generated files (retry case)
        const priorDev = artifacts.get('developer') as { files?: Array<{ path: string; content: string }> } | undefined;
        input.context = priorDev?.files
          ? Object.fromEntries(priorDev.files.map(f => [f.path, f.content]))
          : {};
        break;
      }

      case 'reviewer':
        input.spec = artifacts.get('architect') ?? {};
        input.files = (artifacts.get('developer') as any)?.files ?? [];
        break;

      case 'tester':
        input.files = (artifacts.get('developer') as any)?.files ?? [];
        input.apiContracts = (artifacts.get('architect') as any)?.apiContracts ?? [];
        input.spec = artifacts.get('architect') ?? {};
        // Provide reviewer findings so tests can target already-known problem areas
        input.reviewIssues = (artifacts.get('reviewer') as any)?.issues ?? [];
        break;

      case 'debugger': {
        const reviewerArtifact = artifacts.get('reviewer') as
          { issues?: Array<{ file?: string }> } | undefined;
        const reviewerIssues: Array<{ file?: string }> = reviewerArtifact?.issues ?? [];
        // Only send files that are referenced in issues; fall back to full set when
        // reviewer produced no file-location data (so debugger always has context).
        const issuedPaths = new Set(
          reviewerIssues.map(i => i.file).filter((f): f is string => typeof f === 'string'),
        );
        const allDevFiles = (artifacts.get('developer') as
          { files?: Array<{ path: string; content: string }> } | undefined)?.files ?? [];
        input.issues = reviewerIssues;
        input.affectedFiles = issuedPaths.size > 0
          ? allDevFiles.filter(f => issuedPaths.has(f.path))
          : allDevFiles;
        // Pass tester output so the debugger can also address coverage gaps
        const testerArtifact = artifacts.get('tester') as
          { testFiles?: unknown[]; coverage?: unknown } | undefined;
        input.testResults = testerArtifact
          ? { coverage: testerArtifact.coverage ?? {}, testFileCount: testerArtifact.testFiles?.length ?? 0 }
          : null;
        input.spec = artifacts.get('architect') ?? {};
        break;
      }

      case 'optimizer':
        // Always work from the post-debugger merged state so we don't re-introduce
        // fixed bugs and don't optimize code that is about to be patched.
        input.files = this.getMergedFiles(artifacts);
        input.spec = artifacts.get('architect') ?? {};
        input.qaReport = artifacts.get('reviewer') ?? {};
        // Surface unresolved debugger issues so the optimizer avoids touching those areas
        input.unresolvedIssues = (artifacts.get('debugger') as any)?.unresolved ?? [];
        break;

      case 'devops': {
        const archSpec = artifacts.get('architect') as { fileTree?: string[] } | undefined;
        input.spec = archSpec ?? {};
        // Top-level fileTree matches the registry input schema
        input.fileTree = archSpec?.fileTree ?? [];
        // Pass generated file paths (not full content) so devops can tailor configs to
        // the actual build outputs produced, including any debugger/optimizer patches.
        input.generatedFiles = this.getMergedFiles(artifacts, true)
          .map(f => ({ path: f.path, language: f.language }));
        break;
      }
    }

    return input;
  }

  // ══════════════════════════════════════════════════════════
  // Dependency Checking
  // ══════════════════════════════════════════════════════════

  /** Returns the name of the missing dependency, or null if all satisfied. */
  private checkDependencies(
    role: AgentRole,
    artifacts: Map<AgentRole, Record<string, unknown>>,
  ): AgentRole | null {
    const deps = AGENT_DEFINITIONS[role].dependencies;
    for (const dep of deps) {
      if (!artifacts.has(dep)) return dep;
    }
    return null;
  }

  private shouldSkipStep(
    role: AgentRole,
    artifacts: Map<AgentRole, Record<string, unknown>>,
  ): string | null {
    if (role === 'tester') {
      const files = (artifacts.get('developer') as { files?: unknown[] } | undefined)?.files ?? [];
      if (!Array.isArray(files) || files.length === 0) {
        return 'No generated code files available; skipping tests';
      }
    }

    if (role === 'debugger') {
      const issues = (artifacts.get('reviewer') as { issues?: unknown[] } | undefined)?.issues ?? [];
      // Only skip when reviewer explicitly passed the code — prevents skipping when
      // reviewer was itself skipped (artifact absent) or found zero issues AND marked passable.
      const passable = (artifacts.get('reviewer') as { passable?: boolean } | undefined)?.passable ?? false;
      if (Array.isArray(issues) && issues.length === 0 && passable) {
        return 'Reviewer found no issues and marked code passable; skipping debugger';
      }
    }

    if (role === 'optimizer') {
      const files = (artifacts.get('developer') as { files?: unknown[] } | undefined)?.files ?? [];
      if (!Array.isArray(files) || files.length === 0) {
        return 'No generated files to optimize; skipping optimizer';
      }
    }

    if (role === 'devops') {
      // Merge developer + debugger + optimizer files to check for pre-existing deployment artifacts
      const mergedPaths = new Set(
        this.getMergedFiles(artifacts, true).map(f => f.path),
      );
      if (mergedPaths.has('Dockerfile') && mergedPaths.has('docker-compose.yml') && mergedPaths.has('.env.example')) {
        return 'Deployment artifacts already generated; skipping devops';
      }
    }

    return null;
  }

  private getStepCacheKey(role: AgentRole, input: Record<string, unknown>): string {
    const serialized = stableStringify({ role, input });
    return createHash('sha256').update(serialized).digest('hex');
  }

  private readStepCache(key: string): Record<string, unknown> | null {
    const item = this.stepCache.get(key);
    if (!item) return null;
    if (Date.now() - item.cachedAt > this.STEP_CACHE_TTL_MS) {
      this.stepCache.delete(key);
      return null;
    }
    return item.output;
  }

  private writeStepCache(key: string, output: Record<string, unknown>): void {
    this.stepCache.set(key, { output, cachedAt: Date.now() });
  }

  // ══════════════════════════════════════════════════════════
  // Helpers
  // ══════════════════════════════════════════════════════════

  // ── Merged-file helper ──────────────────────────────────

  /**
   * Returns the developer-generated file set with patches applied in order:
   *   1. debugger patches (bug fixes)
   *   2. optimizer patches (perf/quality improvements) — only when applyOptimizer=true
   *
   * Downstream agents (optimizer, devops) call this so they always work from the
   * latest code state rather than the raw developer output.
   */
  private getMergedFiles(
    artifacts: Map<AgentRole, Record<string, unknown>>,
    applyOptimizer = false,
  ): Array<{ path: string; content: string; language?: string }> {
    const devFiles = (artifacts.get('developer') as
      { files?: Array<{ path: string; content: string; language?: string }> } | undefined
    )?.files ?? [];

    const fileMap = new Map(devFiles.map(f => [f.path, { ...f }]));

    const applyPatches = (patches: Array<{ file: string; oldContent: string; newContent: string }>) => {
      for (const patch of patches) {
        const file = fileMap.get(patch.file);
        // Only apply when the source still matches to avoid double-application on retry
        if (file && file.content === patch.oldContent) {
          file.content = patch.newContent;
        }
      }
    };

    const debugPatches = (artifacts.get('debugger') as
      { patches?: Array<{ file: string; oldContent: string; newContent: string }> } | undefined
    )?.patches ?? [];
    applyPatches(debugPatches);

    if (applyOptimizer) {
      const optPatches = (artifacts.get('optimizer') as
        { patches?: Array<{ file: string; oldContent: string; newContent: string }> } | undefined
      )?.patches ?? [];
      applyPatches(optPatches);
    }

    return Array.from(fileMap.values());
  }

  private getStepPriority(stepId: string): number {
    const priorities: Record<string, number> = {
      plan: 1, design: 2, code: 3, review: 4, test: 5, fix: 6, optimize: 7, deploy: 8,
    };
    return priorities[stepId] ?? 5;
  }

  private countSteps(state: PipelineState): { stepsCompleted: number; stepsFailed: number; stepsSkipped: number } {
    return {
      stepsCompleted: state.steps.filter(s => s.status === 'completed').length,
      stepsFailed: state.steps.filter(s => s.status === 'failed').length,
      stepsSkipped: state.steps.filter(s => s.status === 'skipped').length,
    };
  }

  private async timeout(ms: number, agent: AgentRole): Promise<Task> {
    return new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Agent ${agent} timed out after ${ms}ms`)), ms),
    );
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortRecursively(value));
}

function sortRecursively(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortRecursively);
  }
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
