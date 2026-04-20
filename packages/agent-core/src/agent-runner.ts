// ─────────────────────────────────────────────────────────────
// Agent Runner — Standalone execution + chain orchestration
// Runs agents individually, sequentially, or in custom chains
// with input/output transformation between steps.
// ─────────────────────────────────────────────────────────────

import type {
  AgentRole,
  ChainResult,
  ChainStep,
  ExecutionContext,
  Task,
  TaskMetadata,
} from './types';
import type { BaseAgent, Logger, MemoryStore, MessageBus } from './base-agent';

// ── Task Factory ────────────────────────────────────────────

export function createTask(
  sessionId: string,
  agentRole: AgentRole,
  input: Record<string, unknown>,
  overrides?: Partial<Pick<Task, 'priority' | 'parentTaskId' | 'maxAttempts'>>,
): Task {
  return {
    id: `${sessionId}-${agentRole}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    sessionId,
    agentRole,
    status: 'pending',
    priority: overrides?.priority ?? 5,
    input,
    attempt: 0,
    maxAttempts: overrides?.maxAttempts ?? 3,
    parentTaskId: overrides?.parentTaskId,
    childTaskIds: [],
    createdAt: new Date(),
    metadata: {} as TaskMetadata,
  };
}

// ── Execution Context Factory ───────────────────────────────

export function createExecutionContext(
  sessionId: string,
  agentRole: AgentRole,
  overrides?: Partial<ExecutionContext>,
): ExecutionContext {
  return {
    traceId: overrides?.traceId ?? `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    spanId: `${agentRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    agentRole,
    attempt: 1,
    startedAt: new Date(),
    variables: {},
    ...overrides,
  };
}

// ── Agent Runner ────────────────────────────────────────────

export class AgentRunner {
  private agents: Map<AgentRole, BaseAgent>;
  private logger: Logger;

  constructor(agents: Map<AgentRole, BaseAgent>, logger: Logger) {
    this.agents = agents;
    this.logger = logger;
  }

  /** Execute a single agent with the given input */
  async run(
    role: AgentRole,
    sessionId: string,
    input: Record<string, unknown>,
    contextOverrides?: Partial<ExecutionContext>,
  ): Promise<Task> {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`No agent registered for role: ${role}`);

    const task = createTask(sessionId, role, input);
    const ctx = createExecutionContext(sessionId, role, contextOverrides);

    this.logger.info(`Running agent ${role}`, {
      traceId: ctx.traceId,
      sessionId,
      inputKeys: Object.keys(input),
    });

    const result = await agent.execute(task, ctx);

    this.logger.info(`Agent ${role} finished: ${result.status}`, {
      traceId: ctx.traceId,
      durationMs: result.metadata?.latencyMs,
    });

    return result;
  }

  /** Execute multiple agents in parallel */
  async runParallel(
    roles: AgentRole[],
    sessionId: string,
    inputsByRole: Map<AgentRole, Record<string, unknown>>,
    contextOverrides?: Partial<ExecutionContext>,
  ): Promise<Map<AgentRole, Task>> {
    const traceId = contextOverrides?.traceId ??
      `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    this.logger.info(`Running ${roles.length} agents in parallel`, {
      traceId,
      agents: roles,
    });

    const results = await Promise.allSettled(
      roles.map(role => {
        const input = inputsByRole.get(role) ?? {};
        return this.run(role, sessionId, input, { ...contextOverrides, traceId });
      }),
    );

    const taskMap = new Map<AgentRole, Task>();
    for (let i = 0; i < roles.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        taskMap.set(roles[i], result.value);
      } else {
        this.logger.error(`Agent ${roles[i]} failed in parallel run`, {
          traceId,
          error: result.reason?.message ?? String(result.reason),
        });
        // Create a failed task placeholder
        const task = createTask(sessionId, roles[i], inputsByRole.get(roles[i]) ?? {});
        task.status = 'failed';
        task.error = {
          code: 'EXECUTION_ERROR',
          message: result.reason?.message ?? 'Unknown error',
          retryable: false,
        };
        taskMap.set(roles[i], task);
      }
    }

    return taskMap;
  }

  /** Execute a chain of agents with input/output transformations */
  async runChain(
    sessionId: string,
    steps: ChainStep[],
    initialInput: Record<string, unknown>,
    contextOverrides?: Partial<ExecutionContext>,
  ): Promise<ChainResult> {
    const traceId = contextOverrides?.traceId ??
      `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start = Date.now();
    const outputs = new Map<AgentRole, Record<string, unknown>>();
    const tasks: Task[] = [];
    const failedSteps: AgentRole[] = [];

    this.logger.info(`Starting chain with ${steps.length} steps`, {
      traceId,
      steps: steps.map(s => s.agentRole),
    });

    let currentInput = initialInput;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      // Check condition
      if (step.condition && !step.condition(outputs)) {
        this.logger.info(`Chain step ${step.agentRole} skipped (condition false)`, { traceId });
        continue;
      }

      // Apply input transformation
      const transformedInput = step.inputTransform
        ? step.inputTransform(currentInput, outputs)
        : currentInput;

      // Create context with chain tracking
      const ctx = createExecutionContext(sessionId, step.agentRole, {
        ...contextOverrides,
        traceId,
        parentSpanId: i > 0 ? tasks[tasks.length - 1]?.id : undefined,
      });

      this.logger.info(`Chain step ${i + 1}/${steps.length}: ${step.agentRole}`, {
        traceId,
        inputKeys: Object.keys(transformedInput),
      });

      try {
        const task = await this.run(
          step.agentRole,
          sessionId,
          transformedInput,
          ctx,
        );
        tasks.push(task);

        if (task.status === 'completed' && task.output) {
          // Apply output transformation
          const transformedOutput = step.outputTransform
            ? step.outputTransform(task.output)
            : task.output;

          outputs.set(step.agentRole, transformedOutput);

          // The output of this step becomes the input for the next
          currentInput = { ...currentInput, ...transformedOutput };
        } else {
          failedSteps.push(step.agentRole);
          const errorAction = step.onError ?? 'abort';

          if (errorAction === 'abort') {
            this.logger.error(`Chain aborted at step ${step.agentRole}`, {
              traceId,
              error: task.error?.message,
            });
            break;
          }

          if (errorAction === 'skip') {
            this.logger.warn(`Chain step ${step.agentRole} failed, skipping`, {
              traceId,
              error: task.error?.message,
            });
            continue;
          }

          // errorAction === 'continue' — proceed with current input
          this.logger.warn(`Chain step ${step.agentRole} failed, continuing`, {
            traceId,
            error: task.error?.message,
          });
        }
      } catch (err) {
        failedSteps.push(step.agentRole);
        const errorAction = step.onError ?? 'abort';

        this.logger.error(`Chain step ${step.agentRole} threw`, {
          traceId,
          error: (err as Error).message,
        });

        if (errorAction === 'abort') break;
      }
    }

    const durationMs = Date.now() - start;
    const success = failedSteps.length === 0;

    this.logger.info(`Chain ${success ? 'completed' : 'failed'}`, {
      traceId,
      durationMs,
      completedSteps: steps.length - failedSteps.length,
      failedSteps,
    });

    return {
      success,
      outputs,
      tasks,
      failedSteps,
      durationMs,
    };
  }

  /** Check if an agent is registered */
  hasAgent(role: AgentRole): boolean {
    return this.agents.has(role);
  }

  /** Get a registered agent */
  getAgent(role: AgentRole): BaseAgent | undefined {
    return this.agents.get(role);
  }
}

// ── Chain Builder (fluent API) ──────────────────────────────

export class ChainBuilder {
  private steps: ChainStep[] = [];

  /** Add a step to the chain */
  step(
    agentRole: AgentRole,
    options?: Omit<ChainStep, 'agentRole'>,
  ): this {
    this.steps.push({ agentRole, ...options });
    return this;
  }

  /** Add a conditional step */
  stepIf(
    condition: ChainStep['condition'],
    agentRole: AgentRole,
    options?: Omit<ChainStep, 'agentRole' | 'condition'>,
  ): this {
    this.steps.push({ agentRole, condition, ...options });
    return this;
  }

  /** Add a step with custom input transformation */
  stepWithTransform(
    agentRole: AgentRole,
    inputTransform: ChainStep['inputTransform'],
    options?: Omit<ChainStep, 'agentRole' | 'inputTransform'>,
  ): this {
    this.steps.push({ agentRole, inputTransform, ...options });
    return this;
  }

  /** Build the chain steps array */
  build(): ChainStep[] {
    return [...this.steps];
  }
}

// ── Pre-built Chain Definitions ─────────────────────────────

/** Full generation chain: plan → architect → develop → review → test → debug → optimize */
export function fullGenerationChain(): ChainStep[] {
  return new ChainBuilder()
    .step('planner')
    .stepWithTransform('architect', (input, outputs) => ({
      plan: outputs.get('planner') ?? {},
      userPreferences: input.userPreferences ?? {},
    }))
    .stepWithTransform('developer', (_input, outputs) => ({
      spec: outputs.get('architect') ?? {},
      fileAssignment: (outputs.get('architect') as any)?.fileTree ?? [],
    }))
    .stepWithTransform('devops', (_input, outputs) => ({
      spec: outputs.get('architect') ?? {},
      fileTree: (outputs.get('architect') as any)?.fileTree ?? [],
    }), { onError: 'skip' })
    .stepWithTransform('reviewer', (_input, outputs) => ({
      spec: outputs.get('architect') ?? {},
      files: (outputs.get('developer') as any)?.files ?? [],
    }))
    .stepWithTransform('tester', (_input, outputs) => ({
      files: (outputs.get('developer') as any)?.files ?? [],
      apiContracts: (outputs.get('architect') as any)?.apiContracts ?? [],
      spec: outputs.get('architect') ?? {},
    }), { onError: 'skip' })
    .stepIf(
      (outputs) => {
        const review = outputs.get('reviewer') as any;
        return review?.issues?.length > 0;
      },
      'debugger',
      {
        inputTransform: (_input, outputs) => ({
          issues: (outputs.get('reviewer') as any)?.issues ?? [],
          affectedFiles: (outputs.get('developer') as any)?.files ?? [],
          spec: outputs.get('architect') ?? {},
        }),
        onError: 'continue',
      },
    )
    .stepWithTransform('optimizer', (_input, outputs) => ({
      files: (outputs.get('developer') as any)?.files ?? [],
      spec: outputs.get('architect') ?? {},
      qaReport: outputs.get('reviewer') ?? {},
    }), { onError: 'skip' })
    .build();
}

/** Quick review chain: develop → review only */
export function quickReviewChain(): ChainStep[] {
  return new ChainBuilder()
    .step('developer')
    .stepWithTransform('reviewer', (_input, outputs) => ({
      spec: {},
      files: (outputs.get('developer') as any)?.files ?? [],
    }))
    .build();
}

/** Fix chain: review → debug → optimize */
export function fixAndOptimizeChain(): ChainStep[] {
  return new ChainBuilder()
    .step('reviewer')
    .stepIf(
      (outputs) => {
        const review = outputs.get('reviewer') as any;
        return review?.issues?.some((i: any) =>
          i.severity === 'critical' || i.severity === 'high',
        );
      },
      'debugger',
      {
        inputTransform: (input, outputs) => ({
          issues: (outputs.get('reviewer') as any)?.issues ?? [],
          affectedFiles: input.files ?? [],
        }),
      },
    )
    .step('optimizer', { onError: 'skip' })
    .build();
}
