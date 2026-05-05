/**
 * @devteam/types — single source of truth for shared API/UI contract types.
 *
 * Consumed by:
 *   - apps/web (frontend dashboard)
 *   - apps/api (backend API responses must match these shapes)
 */

// ─── Pipeline / session progress (WS feed) ────────────────────────────────────

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface DashboardLog {
  id: string;
  ts: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export interface PipelineStep {
  stepId: string;
  name: string;
  agent: string;
  status: StepStatus;
  durationMs: number;
  error?: string;
}

export interface SessionProgress {
  sessionId: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  currentStep: {
    stepId: string;
    name: string;
    agent: string;
    description: string;
    attempt: number;
  } | null;
  steps: PipelineStep[];
  completedAgents: string[];
  failedAgents: string[];
  durationMs: number;
}

// ─── Project model ────────────────────────────────────────────────────────────

export interface PromptHistoryEntry {
  text: string;
  createdAt: string;
  sessionId?: string;
  /** Union of added + modified + removed (compat). */
  changedFiles?: string[];
  added?: string[];
  modified?: string[];
  removed?: string[];
  snapshotVersionId?: string;
}

export interface ProjectVersion {
  id: string;
  createdAt: string;
  promptText: string;
  summary?: string;
  fileCount?: number;
}

export interface RuntimeValidationResult {
  finalVerdict: 'pass' | 'fail';
  iterations: number;
  issues: { category: string; message: string; hint?: string }[];
  totalDurationMs: number;
  completedAt: string;
}

export interface GeneratedProject {
  id: string;
  sessionId: string;
  name: string;
  status: 'generating' | 'completed' | 'failed';
  /** Legacy single prompt (kept for compat) */
  prompts: string[];
  /** Full prompt history */
  promptHistory?: PromptHistoryEntry[];
  /** Saved versions for rollback */
  versions?: ProjectVersion[];
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: string;
  completedAt?: string;
  /** Post-build runtime validation result. Populated asynchronously after
   *  generation finishes; absent until the validator runs. */
  runtimeValidation?: RuntimeValidationResult;
  /**
   * Stack selection mode for this project.
   *   - 'auto'   (default): pipeline chose the stack from the prompt.
   *   - 'manual': user explicitly picked the stack in the UI.
   * Missing fields on legacy records should be treated as 'auto'.
   */
  stackSelectionMode?: 'auto' | 'manual';
  /** Final technology stack chosen by the pipeline (mirror of `spec.techStack`). */
  techStack?: Record<string, string>;
  /** Decoupled preview-runtime lifecycle. Updated by the API's
   *  PreviewManager on every state transition; independent of `status`
   *  (which is generation-only). */
  preview?: {
    previewStatus: 'idle' | 'preparing' | 'installing' | 'building' | 'starting' | 'ready' | 'failed';
    previewReady: boolean;
    previewUrl?: string | null;
    previewStartedAt?: string | null;
    previewReadyAt?: string | null;
    previewError?: string | null;
    /** Discrete lifecycle events with timing + stdout/stderr tails. */
    timeline?: Array<{
      event:
        | 'runner-start' | 'install-start' | 'install-end'
        | 'build-start' | 'build-end' | 'devserver-start'
        | 'port-assigned' | 'http-probe-ok' | 'url-published'
        | 'iframe-ready' | 'failed';
      at: string;
      projectId: string;
      previewStatus:
        | 'idle' | 'preparing' | 'installing' | 'building'
        | 'starting' | 'ready' | 'failed';
      durationMs?: number;
      details?: Record<string, unknown>;
      stdoutTail?: string;
      stderrTail?: string;
    }>;
  };
}

export interface ProjectFileEntry {
  path: string;
  size: number;
}

export interface ProjectFileContent {
  path: string;
  content: string;
}

// ─── API responses ────────────────────────────────────────────────────────────

export interface GenerateResponse {
  projectId: string;
  sessionId: string;
  project: {
    id: string;
    name: string;
    status: string;
    fileCount: number;
    totalTokens: number;
    totalCostUsd: number;
    durationMs: number;
  };
}
