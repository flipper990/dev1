import type { AgentRole, LLMProvider } from '../../../../packages/agent-core/src/types.js';
import type { TaskCategory } from './types.js';

export type GenerationBudgetLevel = 'warning' | 'critical' | 'exceeded';
export type GenerationBudgetAction = 'continue' | 'stop';

export interface GenerationBudgetConfig {
  softLimitUsd: number | null;
  warningThreshold: number;
  criticalThreshold: number;
  hardStopEnabled: boolean;
}

export interface GenerationBudgetCallContext {
  projectId?: string;
  sessionId?: string;
  traceId?: string;
  agentRole?: AgentRole;
  taskCategory?: TaskCategory;
  provider?: LLMProvider;
  model?: string;
  phase?: string;
  step?: string;
  requestId?: string;
}

export interface GenerationBudgetEvent extends Required<Pick<GenerationBudgetConfig, 'warningThreshold' | 'criticalThreshold' | 'hardStopEnabled'>> {
  at: string;
  projectId: string;
  sessionId?: string;
  traceId?: string;
  agentRole?: AgentRole;
  taskCategory?: TaskCategory;
  provider?: LLMProvider;
  model?: string;
  phase?: string;
  step?: string;
  requestId?: string;
  level: GenerationBudgetLevel;
  action: GenerationBudgetAction;
  spentUsd: number;
  budgetUsd: number;
  percentUsed: number;
  threshold: number;
  message: string;
}

export class GenerationBudgetExceededError extends Error {
  readonly code = 'COST_LIMIT_EXCEEDED';
  readonly details: Record<string, unknown>;

  constructor(event: GenerationBudgetEvent) {
    super(event.message);
    this.name = 'GenerationBudgetExceededError';
    this.details = {
      kind: 'generation_cost',
      projectId: event.projectId,
      currentValue: event.spentUsd,
      limit: event.budgetUsd,
      percentUsed: event.percentUsed,
      hardStopEnabled: event.hardStopEnabled,
    };
  }
}

export type GenerationBudgetEventHandler = (event: GenerationBudgetEvent) => void;

export interface GenerationBudgetDiagnosticEvent {
  at: string;
  level: GenerationBudgetLevel;
  action: GenerationBudgetAction;
  spentUsd: number;
  budgetUsd: number;
  percentUsed: number;
  threshold: number;
  hardStopEnabled: boolean;
  agentRole?: string;
  taskCategory?: string;
  provider?: string;
  model?: string;
  phase?: string;
  step?: string;
  requestId?: string;
  message: string;
}

export interface GenerationBudgetDiagnostics {
  enabled: boolean;
  softLimitUsd: number | null;
  warningThreshold: number;
  criticalThreshold: number;
  hardStopEnabled: boolean;
  lastLevel?: GenerationBudgetLevel;
  lastAction?: GenerationBudgetAction;
  lastWarningAt?: string;
  spentUsd?: number;
  percentUsed?: number;
  events: GenerationBudgetDiagnosticEvent[];
  updatedAt: string;
}

type SpendLookup = (projectId: string) => number;

const LEVEL_ORDER: Record<GenerationBudgetLevel, number> = {
  warning: 1,
  critical: 2,
  exceeded: 3,
};

export class GenerationBudgetGuard {
  private readonly emittedLevels = new Map<string, GenerationBudgetLevel>();
  private readonly handlers: GenerationBudgetEventHandler[] = [];

  constructor(
    private readonly config: GenerationBudgetConfig,
    private readonly getSpendUsd: SpendLookup,
  ) {}

  getConfig(): GenerationBudgetConfig {
    return { ...this.config };
  }

  isEnabled(): boolean {
    return typeof this.config.softLimitUsd === 'number' && this.config.softLimitUsd > 0;
  }

  onEvent(handler: GenerationBudgetEventHandler): void {
    this.handlers.push(handler);
  }

  checkBeforeCall(ctx: GenerationBudgetCallContext): void {
    const event = this.evaluate(ctx);
    if (!event) return;

    this.emitOncePerLevel(event);
    if (event.action === 'stop') {
      throw new GenerationBudgetExceededError(event);
    }
  }

  checkAfterRecord(ctx: GenerationBudgetCallContext): void {
    const event = this.evaluate(ctx);
    if (!event) return;
    this.emitOncePerLevel(event);
  }

  snapshot(projectId: string): {
    enabled: boolean;
    softLimitUsd: number | null;
    spentUsd: number;
    percentUsed: number | null;
    warningThreshold: number;
    criticalThreshold: number;
    hardStopEnabled: boolean;
    lastLevel?: GenerationBudgetLevel;
  } {
    const spentUsd = this.getSpendUsd(projectId);
    const budgetUsd = this.config.softLimitUsd;
    return {
      enabled: this.isEnabled(),
      softLimitUsd: budgetUsd,
      spentUsd,
      percentUsed: budgetUsd && budgetUsd > 0 ? spentUsd / budgetUsd : null,
      warningThreshold: this.config.warningThreshold,
      criticalThreshold: this.config.criticalThreshold,
      hardStopEnabled: this.config.hardStopEnabled,
      lastLevel: this.emittedLevels.get(projectId),
    };
  }

  private evaluate(ctx: GenerationBudgetCallContext): GenerationBudgetEvent | null {
    if (!this.isEnabled()) return null;
    const projectId = ctx.projectId;
    if (!projectId) return null;

    const budgetUsd = this.config.softLimitUsd!;
    const spentUsd = this.getSpendUsd(projectId);
    const percentUsed = spentUsd / budgetUsd;
    const level = this.levelFor(percentUsed);
    if (!level) return null;

    const hardStop = this.config.hardStopEnabled && percentUsed >= 1;
    const action: GenerationBudgetAction = hardStop ? 'stop' : 'continue';
    const threshold =
      level === 'exceeded' ? 1 :
      level === 'critical' ? this.config.criticalThreshold :
      this.config.warningThreshold;

    return {
      at: new Date().toISOString(),
      ...ctx,
      projectId,
      level,
      action,
      spentUsd,
      budgetUsd,
      percentUsed,
      threshold,
      warningThreshold: this.config.warningThreshold,
      criticalThreshold: this.config.criticalThreshold,
      hardStopEnabled: this.config.hardStopEnabled,
      message: buildMessage(level, action, spentUsd, budgetUsd, percentUsed),
    };
  }

  private levelFor(percentUsed: number): GenerationBudgetLevel | null {
    if (percentUsed >= 1) return 'exceeded';
    if (percentUsed >= this.config.criticalThreshold) return 'critical';
    if (percentUsed >= this.config.warningThreshold) return 'warning';
    return null;
  }

  private emitOncePerLevel(event: GenerationBudgetEvent): void {
    const previous = this.emittedLevels.get(event.projectId);
    if (previous && LEVEL_ORDER[previous] >= LEVEL_ORDER[event.level]) return;
    this.emittedLevels.set(event.projectId, event.level);
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch {
        // Budget diagnostics must not break generation or router behavior.
      }
    }
  }
}

export function createInitialBudgetDiagnostics(config: GenerationBudgetConfig): GenerationBudgetDiagnostics {
  return {
    enabled: typeof config.softLimitUsd === 'number' && config.softLimitUsd > 0,
    softLimitUsd: config.softLimitUsd,
    warningThreshold: config.warningThreshold,
    criticalThreshold: config.criticalThreshold,
    hardStopEnabled: config.hardStopEnabled,
    events: [],
    updatedAt: new Date().toISOString(),
  };
}

export function appendBudgetDiagnostic(
  current: unknown,
  event: GenerationBudgetEvent,
): GenerationBudgetDiagnostics {
  const existing = current && typeof current === 'object'
    ? current as { events?: unknown[] }
    : {};
  const events: GenerationBudgetDiagnosticEvent[] = Array.isArray(existing.events)
    ? existing.events.filter(isBudgetDiagnosticEvent).slice(-49)
    : [];
  events.push({
    at: event.at,
    level: event.level,
    action: event.action,
    spentUsd: Number(event.spentUsd.toFixed(6)),
    budgetUsd: Number(event.budgetUsd.toFixed(6)),
    percentUsed: Number((event.percentUsed * 100).toFixed(2)),
    threshold: event.threshold,
    hardStopEnabled: event.hardStopEnabled,
    agentRole: event.agentRole,
    taskCategory: event.taskCategory,
    provider: event.provider,
    model: event.model,
    phase: event.phase,
    step: event.step,
    requestId: event.requestId,
    message: event.message,
  });

  return {
    enabled: true,
    softLimitUsd: event.budgetUsd,
    warningThreshold: event.warningThreshold,
    criticalThreshold: event.criticalThreshold,
    hardStopEnabled: event.hardStopEnabled,
    lastLevel: event.level,
    lastAction: event.action,
    lastWarningAt: event.at,
    spentUsd: Number(event.spentUsd.toFixed(6)),
    percentUsed: Number((event.percentUsed * 100).toFixed(2)),
    events,
    updatedAt: event.at,
  };
}

function isBudgetDiagnosticEvent(value: unknown): value is GenerationBudgetDiagnosticEvent {
  return Boolean(
    value &&
    typeof value === 'object' &&
    typeof (value as { at?: unknown }).at === 'string' &&
    typeof (value as { message?: unknown }).message === 'string',
  );
}

function buildMessage(
  level: GenerationBudgetLevel,
  action: GenerationBudgetAction,
  spentUsd: number,
  budgetUsd: number,
  percentUsed: number,
): string {
  const pct = Math.round(percentUsed * 100);
  const spent = spentUsd.toFixed(4);
  const budget = budgetUsd.toFixed(4);
  if (action === 'stop') {
    return `Generation cost budget reached: spent $${spent} of $${budget} (${pct}%). Hard stop is enabled; no further LLM calls will be started for this project.`;
  }
  if (level === 'critical') {
    return `Generation cost budget critical: spent $${spent} of $${budget} (${pct}%). Continuing because hard stop is not active before 100%.`;
  }
  if (level === 'exceeded') {
    return `Generation cost budget exceeded: spent $${spent} of $${budget} (${pct}%). Continuing because hard stop is disabled.`;
  }
  return `Generation cost budget warning: spent $${spent} of $${budget} (${pct}%).`;
}
