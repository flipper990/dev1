// ─────────────────────────────────────────────────────────────
// Pipeline type definitions and the canonical step schedule
// ─────────────────────────────────────────────────────────────

import type { AgentRole, Task } from './types';

// ── Pipeline Step ───────────────────────────────────────────

export interface PipelineStep {
  id: string;
  name: string;
  agent: AgentRole;
  /** Is this step required for the pipeline to succeed? */
  critical: boolean;
  /** Description shown in progress UI. */
  description: string;
}

/** The canonical fullstack generation pipeline. All steps are critical and run in dependency order. */
export const PIPELINE_STEPS: PipelineStep[] = [
  { id: 'expand',   name: 'Intent Expansion', agent: 'intent_expander',  critical: true, description: 'Expanding prompts into detailed product specification' },
  { id: 'plan',     name: 'Planning',         agent: 'planner',          critical: true, description: 'Analyzing expanded spec and defining project scope' },
  { id: 'design',   name: 'Architecture',     agent: 'architect',        critical: true, description: 'Designing system architecture and tech stack' },
  { id: 'code',     name: 'Development',      agent: 'developer',        critical: true, description: 'Writing source code for all components' },
  { id: 'review',   name: 'Code Review',      agent: 'reviewer',         critical: true, description: 'Reviewing code quality and finding issues' },
  { id: 'test',     name: 'Testing',          agent: 'tester',           critical: true, description: 'Generating test suites' },
  { id: 'fix',      name: 'Bug Fixing',       agent: 'debugger',         critical: true, description: 'Fixing identified issues' },
  { id: 'quality',  name: 'Quality Gate',     agent: 'quality_enforcer', critical: true, description: 'Enforcing UI and functional quality standards' },
  { id: 'optimize', name: 'Optimization',     agent: 'optimizer',        critical: true, description: 'Applying performance and code quality optimizations' },
  { id: 'deploy',   name: 'DevOps',           agent: 'devops',           critical: true, description: 'Preparing deployment configuration' },
];

// ── Step State ──────────────────────────────────────────────

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

// ── Pipeline State ──────────────────────────────────────────

export interface PipelineState {
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /**
   * Index of the highest-indexed step that has started or completed.
   * In parallel mode multiple steps advance this simultaneously; use
   * `steps` for per-step status detail rather than relying on this field.
   */
  currentStepIndex: number;
  steps: StepState[];
  artifacts: Map<AgentRole, Record<string, unknown>>;
  tasks: Task[];
  startedAt: Date;
  durationMs: number;
  /** Fraction complete (0–1). Updated whenever a step finishes. */
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

export interface CachedStepResult {
  output: Record<string, unknown>;
  cachedAt: number;
}

// ── Pipeline Events ─────────────────────────────────────────

export type PipelineEvent =
  | { type: 'pipeline:started';   sessionId: string; totalSteps: number }
  | { type: 'wave:started';       sessionId: string; wave: number; agents: AgentRole[] }
  | { type: 'step:started';       sessionId: string; stepId: string; stepName: string; agent: AgentRole; description: string; stepIndex: number; totalSteps: number }
  | { type: 'step:retrying';      sessionId: string; stepId: string; agent: AgentRole; attempt: number; maxAttempts: number; error: string }
  | { type: 'step:completed';     sessionId: string; stepId: string; agent: AgentRole; durationMs: number; stepIndex: number; totalSteps: number }
  | { type: 'step:failed';        sessionId: string; stepId: string; agent: AgentRole; error: string; critical: boolean }
  | { type: 'step:skipped';       sessionId: string; stepId: string; agent: AgentRole; reason: string }
  | { type: 'pipeline:completed'; sessionId: string; durationMs: number; stepsCompleted: number; stepsFailed: number; stepsSkipped: number }
  | { type: 'pipeline:failed';    sessionId: string; error: string; failedStep: string; durationMs: number };

export type PipelineEventHandler = (event: PipelineEvent) => void;
