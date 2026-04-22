// Agent Runner — Standalone execution, parallel runs, and chain orchestration.
// Chain definitions -> ./agent-chains.ts

import type {
  AgentRole,
  ChainResult,
  ChainStep,
  ExecutionContext,
  Task,
  TaskMetadata,
} from './types';
import type { BaseAgent, Logger } from './base-agent';

// Re-export so existing consumers importing from agent-runner still work.
export { ChainBuilder, fullGenerationChain, quickReviewChain, fixAndOptimizeChain } from './agent-chains';

// ── Factories ───────────────────────────────────────────────────

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

export function createExecutionContext(
  sessionId: string,
  agentRole: AgentRole,
  overrides?: Partial<ExecutionContext>,
): ExecutionContext {
  return {
    traceId: overrides?.traceId ?? `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    spanId:  `${agentRole}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    sessionId,
    agentRole,
    attempt:   1,
    startedAt: new Date(),
    variables: {},
    ...overrides,
  };
}

// ── Agent Runner ────────────────────────────────────────────────

export class AgentRunner {
  private agents: Map<AgentRole, BaseAgent>;
  private logger: Logger;

  constructor(agents: Map<AgentRole, BaseAgent>, logger: Logger) {
    this.agents = agents;
    this.logger = logger;
  }

  /** Execute a single agent with the given input. */
  async run(
    role: AgentRole,
    sessionId: string,
    input: Record<string, unknown>,
    contextOverrides?: Partial<ExecutionContext>,
  ): Promise<Task> {
    const agent = this.agents.get(role);
    if (!agent) throw new Error(`No agent registered for role: ${role}`);

    const task = createTask(sessionId, role, input);
    const ctx  = createExecutionContext(sessionId, role, contextOverrides);

    this.logger.info(`Running agent ${role}`, { traceId: ctx.traceId, sessionId, inputKeys: Object.keys(input) });
    const result = await agent.execute(task, ctx);
    this.logger.info(`Agent ${role} finished: ${result.status}`, { traceId: ctx.traceId, durationMs: result.metadata?.latencyMs });

    return result;
  }

  /** Execute multiple agents concurrently. */
  async runParallel(
    roles: AgentRole[],
    sessionId: string,
    inputsByRole: Map<AgentRole, Record<string, unknown>>,
    contextOverrides?: Partial<ExecutionContext>,
  ): Promise<Map<AgentRole, Task>> {
    const traceId = contextOverrides?.traceId ?? `trace-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.logger.info(`Running ${roles.length} agents in parallel`, { traceId, agents: roles });

    const results = await Promise.allSettled(
      roles.map(role =>
        this.run(role, sessionId, inputsByRole.get(role) ?? {}, { ...contextOverrides, traceId }),
      ),
    );

    const taskMap = new Map<AgentRole, Task>();
    for (let i = 0; i < roles.length; i++) {
      const result = results[i];
      if (result.status === 'fulfilled') {
        taskMap.set(roles[i], result.value);
      } else {
        this.logger.error(`Agent ${roles[i]} failed in parallel run`, { traceId, error: result.reason?.message ?? String(result.reason) });
        const task = createTask(sessionId, roles[i], inputsByRole.get(roles[i]) ?? {});
        task.status = 'failed';
        task.error  = { code: 'EXECUTION_ERROR', message: result.reason?.message ?? 'Unknown error', retryable: false };
        taskMap.set(roles[i], task);
      }
    }

    return taskMap;
  }

  /** Execute a chain of agents with optional input/output transformations between steps. */
  async runChain(
    sessionId: string,
    steps: ChainStep[],
    initialInput: Record<string, unknown>,
    contextOverrides?: Partial<ExecutionContext>,
  ): Promise<ChainResult> {
    const traceId    = contextOverrides?.traceId ?? `chain-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const start      = Date.now();
    const outputs    = new Map<AgentRole, Record<string, unknown>>();
    const tasks: Task[]         = [];
    const failedSteps: AgentRole[] = [];

    this.logger.info(`Starting chain with ${steps.length} steps`, { traceId, steps: steps.map(s => s.agentRole) });

    let currentInput = initialInput;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.condition && !step.condition(outputs)) {
        this.logger.info(`Chain step ${step.agentRole} skipped (condition false)`, { traceId });
        continue;
      }

      const transformedInput = step.inputTransform ? step.inputTransform(currentInput, outputs) : currentInput;
      const ctx = createExecutionContext(sessionId, step.agentRole, {
        ...contextOverrides,
        traceId,
        parentSpanId: i > 0 ? tasks[tasks.length - 1]?.id : undefined,
      });

      this.logger.info(`Chain step ${i + 1}/${steps.length}: ${step.agentRole}`, { traceId, inputKeys: Object.keys(transformedInput) });

      try {
        const task = await this.run(step.agentRole, sessionId, transformedInput, ctx);
        tasks.push(task);

        if (task.status === 'completed' && task.output) {
          const transformedOutput = step.outputTransform ? step.outputTransform(task.output) : task.output;
          outputs.set(step.agentRole, transformedOutput);
          currentInput = { ...currentInput, ...transformedOutput };
        } else {
          failedSteps.push(step.agentRole);
          const errorAction = step.onError ?? 'abort';
          this.logger.warn(`Chain step ${step.agentRole} failed (${errorAction})`, { traceId, error: task.error?.message });
          if (errorAction === 'abort') break;
        }
      } catch (err) {
        failedSteps.push(step.agentRole);
        this.logger.error(`Chain step ${step.agentRole} threw`, { traceId, error: (err as Error).message });
        if ((step.onError ?? 'abort') === 'abort') break;
      }
    }

    const durationMs = Date.now() - start;
    const success    = failedSteps.length === 0;
    this.logger.info(`Chain ${success ? 'completed' : 'failed'}`, { traceId, durationMs, completedSteps: steps.length - failedSteps.length, failedSteps });

    return { success, outputs, tasks, failedSteps, durationMs };
  }

  hasAgent(role: AgentRole): boolean    { return this.agents.has(role); }
  getAgent(role: AgentRole): BaseAgent | undefined { return this.agents.get(role); }
}
