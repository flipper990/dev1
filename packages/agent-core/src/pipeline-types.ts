// ─────────────────────────────────────────────────────────────
// Pipeline type definitions and the canonical 4-step schedule.
//
// April 2026 — simplified pipeline:
//   spec → builder → qa → polish
//
// The QA→Builder loop (when verdict = 'needs-improvement') is implemented
// outside the orchestrator in apps/api/src/pipeline/project-generator.ts;
// each iteration reuses the same step ids.
// ─────────────────────────────────────────────────────────────

import type { AgentRole, Task } from './types';

export interface PipelineArtifactSummary {
  kind: 'empty' | 'object';
  keys: string[];
  outputSizeBytes: number;
  files?: { count: number; samplePaths: string[] };
  patches?: { count: number };
  newFiles?: { count: number; samplePaths: string[] };
  issues?: { count: number };
  productName?: string;
  featureSlices?: { count: number };
  apiContracts?: { count: number };
  frontendPages?: { count: number };
  components?: { count: number };
  verdict?: string;
  summary?: string;
}

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

/** The canonical 4-stage pipeline. */
export const PIPELINE_STEPS: PipelineStep[] = [
  { id: 'spec',    name: 'Specification', agent: 'spec',    critical: true,  description: 'Expanding intent → plan → architecture into one product specification' },
  { id: 'build',   name: 'Build',         agent: 'builder', critical: true,  description: 'Generating the fullstack application (frontend + backend)' },
  { id: 'qa',      name: 'QA',            agent: 'qa',      critical: true,  description: 'Reviewing for bugs, missing logic, inconsistencies — auto-fixing what it can' },
  { id: 'polish',  name: 'Polish',        agent: 'polish',  critical: false, description: 'UI/UX polish, performance, and production-readiness pass' },
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
  /** Populated by the self-heal pass when step output is validated. */
  validationVerdict?: 'ok' | 'repaired' | 'deferred' | 'blocked';
  /** Count of auto-repairs applied to this step's output. */
  repairCount?: number;
  /** QA→Builder loop iteration (1 = initial pass, 2+ = re-builds). */
  iteration?: number;
}

// ── Pipeline State ──────────────────────────────────────────

export interface PipelineState {
  sessionId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  currentStepIndex: number;
  steps: StepState[];
  artifacts: Map<AgentRole, Record<string, unknown>>;
  tasks: Task[];
  startedAt: Date;
  durationMs: number;
  progress: number;
  optimization: {
    cacheHits: number;
    cacheMisses: number;
    skippedSteps: number;
    executedSteps: number;
    estimatedApiCallsSaved: number;
  };
  /** QA→Builder loop iterations actually executed (1 = no loop, 2+ = looped). */
  qaIterations?: number;
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
  | { type: 'step:completed';     sessionId: string; stepId: string; agent: AgentRole; durationMs: number; stepIndex: number; totalSteps: number; usage?: { model?: string; provider?: string; tokensIn: number; tokensOut: number; totalTokens: number; costUsd: number }; artifactSummary?: PipelineArtifactSummary | null }
  | { type: 'step:validated';     sessionId: string; stepId: string; agent: AgentRole; verdict: 'ok' | 'repaired' | 'deferred' | 'blocked'; issueCount: number; repairCount: number; issues: { id: string; message: string; severity: 'info'|'warning'|'error'|'blocker'; category: string }[] }
  | { type: 'step:repaired';      sessionId: string; stepId: string; agent: AgentRole; changes: { path: string; action: string; detail: string }[] }
  | { type: 'step:blocked';       sessionId: string; stepId: string; agent: AgentRole; reason: string }
  | { type: 'step:failed';        sessionId: string; stepId: string; agent: AgentRole; error: string; critical: boolean; errorCode?: string }
  | { type: 'step:skipped';       sessionId: string; stepId: string; agent: AgentRole; reason: string }
  | { type: 'qa:loop';            sessionId: string; iteration: number; reason: string }
  | { type: 'pipeline:completed'; sessionId: string; durationMs: number; stepsCompleted: number; stepsFailed: number; stepsSkipped: number }
  | { type: 'pipeline:failed';    sessionId: string; error: string; failedStep: string; durationMs: number };

export type PipelineEventHandler = (event: PipelineEvent) => void;
