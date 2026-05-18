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
  executionPhase?:
    | 'queued'
    | 'planning'
    | 'architecting'
    | 'backend_generation'
    | 'frontend_generation'
    | 'verification'
    | 'preview_build'
    | 'artifact_packaging'
    | 'completed'
    | 'failed'
    | 'timed_out'
    | 'provider_unavailable'
    | 'retrying';
  providerStatus?: Record<string, boolean>;
  retryAttempt?: number;
  activeWorker?: string | null;
  lastHeartbeatAt?: string;
  timeoutAt?: string | null;
  timeoutRemainingMs?: number | null;
  failureReason?: string | null;
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
  /** Validator lifecycle, decoupled from project.status. */
  status?: 'pending' | 'running' | 'passed' | 'warning' | 'failed';
  finalVerdict: 'pass' | 'fail';
  iterations: number;
  issues: { category: string; message: string; hint?: string }[];
  totalDurationMs: number;
  completedAt: string;
  reason?: string;
  details?: Record<string, unknown>;
}

/**
 * Execution-validator (real npm install + build + dev) verdict. Like
 * `RuntimeValidationResult`, the `status` field is the canonical UI
 * signal (pending | running | passed | warning | failed) and is
 * INDEPENDENT of project.status. Generation is considered done after
 * the integrity gate; this block records the post-completion health
 * probe and never demotes the build itself.
 */
export interface ExecutionValidationResult {
  status?: 'pending' | 'running' | 'passed' | 'warning' | 'failed';
  finalVerdict: 'pass' | 'fail';
  iterations: number;
  buildErrors: string[];
  runtimeErrors: string[];
  httpProbes?: Array<{
    path: string;
    ok: boolean;
    status: number | null;
    bodyBytes: number;
    durationMs: number;
    error?: string;
  }>;
  totalDurationMs: number;
  completedAt: string;
  reason?: string;
  details?: Record<string, unknown>;
}

/** Canonical preview lifecycle status shared by backend and frontend. */
export type PreviewLifecycleStatus =
  | 'idle'
  | 'preparing'
  | 'installing'
  | 'building'
  | 'starting'
  | 'reachable'
  | 'ready'
  | 'failed';

/** Canonical preview health model. */
export type PreviewHealthStatus =
  | 'unknown'
  | 'healthy'
  | 'placeholder'
  | 'broken';

/** Generation lifecycle (code creation only, not runtime verification). */
export type ProjectLifecycleStatus =
  | 'generating'
  | 'generated'
  | 'failed';

/** Post-generation verification lifecycle. */
export type VerificationStatus =
  | 'pending'
  | 'running'
  | 'passed'
  | 'failed'
  | 'warning';

export interface GeneratedProject {
  id: string;
  sessionId: string;
  name: string;
  /** Legacy field kept for compatibility; mirrors `projectStatus`. */
  status: ProjectLifecycleStatus;
  /** Canonical generation lifecycle status. */
  projectStatus?: ProjectLifecycleStatus;
  /** Canonical verification lifecycle status (execution/runtime checks). */
  verificationStatus?: VerificationStatus;
  /** Canonical top-level preview health projection (mirrors preview.previewHealth). */
  previewHealthStatus?: PreviewHealthStatus;
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
  /** Real-environment execution validator (npm install + build + dev).
   *  Populated asynchronously after the integrity gate passes. Like
   *  `runtimeValidation`, this is a post-completion health probe and is
   *  rendered as a separate "Validation" pill in the UI. It NEVER
   *  demotes `status`. */
  executionValidation?: ExecutionValidationResult;
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
    previewStatus: PreviewLifecycleStatus;
    /** Canonical content-health verdict for the current preview evidence. */
    previewHealth?: PreviewHealthStatus;
    previewReady: boolean;
    previewUrl?: string | null;
    previewStartedAt?: string | null;
    previewReadyAt?: string | null;
    /** ISO timestamp the moment previewStatus transitioned to 'failed'. */
    previewFailedAt?: string | null;
    /** ISO timestamp the moment the boot-watchdog forced this run into
     *  preview:timeout. Distinct from previewFailedAt because timeouts
     *  carry no explicit error from the runtime — only a snapshot of
     *  the last known phase + stdout/stderr tails. */
    previewTimeoutAt?: string | null;
    /** Boot-budget that was in effect when the watchdog tripped (ms).
     *  Used by the UI to show "Preview timed out after Ns" without
     *  hard-coding the budget client-side. */
    previewTimeoutDurationMs?: number | null;
    /** Liveness verdict for the dev-server child at the moment the
     *  watchdog tripped (true=alive, false=dead, null=unknown). */
    previewChildAlive?: boolean | null;
    /** Server-process liveness snapshot. Classifies a stuck/failed boot
     *  as no-process / crashed / exited-clean / alive-hanging /
     *  alive-not-reachable / alive-healthy. */
    previewProcessLifecycle?: {
      startedAt: string | null;
      exitedAt: string | null;
      exitCode: number | null;
      signal: string | null;
      alive: boolean | null;
      pid: number | null;
      uptimeMs: number | null;
      classification: 'no-process' | 'crashed' | 'exited-clean' | 'alive-hanging' | 'alive-not-reachable' | 'alive-healthy';
      capturedAt: string;
    } | null;
    previewError?: string | null;
    /** Live runtime-log snapshot — pid, cmd, cwd, assigned port, and
     *  tail of stdout / stderr. Updated by the boot watchdog so a
     *  stuck preview can be diagnosed via the project record alone. */
    previewRuntimeLog?: {
      pid: number | null;
      cmd: string | null;
      cwd: string | null;
      port: number | null;
      stdoutTail: string | null;
      stderrTail: string | null;
      capturedAt: string;
    } | null;
    /** Per-start identifier — distinct from projectId; lets the UI
     *  correlate a failure card to a specific runtime attempt. */
    previewId?: string | null;
    /** Which backend produced (or attempted) this preview. Surfaced on
     *  the failure card so the user knows whether they're looking at a
     *  docker container exit or a host `npm run dev` crash.
     *  `local-fallback` indicates a local runner that ran after the
     *  docker attempt failed (one-shot fallback chain). */
    previewRuntime?: 'docker' | 'local' | 'local-fallback' | 'fullstack' | null;
    /** Most recent successful step before failure ("install completed",
     *  "tcp listening", "compose stack started", …). */
    previewLastStep?: string | null;
    /** Forensic exit info for the preview-failed UI card. */
    previewExit?: {
      exitCode?: number | null;
      signal?: string | null;
      oomKilled?: boolean;
      dockerError?: string | null;
      capturedAt?: string;
    } | null;
    /** Fine-grained boot phase. Linear progression from preview:queued
     *  to preview:ready; terminates at preview:failed if any phase
     *  errors, or preview:timeout if the boot-budget watchdog tripped
     *  before any terminal verdict was reached. */
    previewStep?:
      | 'preview:queued'
      | 'preview:staging-files'
      | 'preview:installing'
      | 'preview:building'
      | 'preview:spawning-server'
      | 'preview:waiting-for-port'
      | 'preview:http-probing'
      | 'preview:ready'
      | 'preview:failed'
      | 'preview:timeout'
      | null;
    /** ISO timestamp the current `previewStep` started. */
    previewStepStartedAt?: string | null;
    /** ISO timestamp the current `previewStep` completed (only set once
     *  the phase ends — either preview:ready or preview:failed). */
    previewStepCompletedAt?: string | null;
    /** Append-only per-phase duration log. */
    previewStepDurations?: Array<{
      step:
        | 'preview:queued'
        | 'preview:staging-files'
        | 'preview:installing'
        | 'preview:building'
        | 'preview:spawning-server'
        | 'preview:waiting-for-port'
        | 'preview:http-probing'
        | 'preview:ready'
        | 'preview:failed'
        | 'preview:timeout';
      startedAt: string;
      completedAt: string;
      durationMs: number;
    }>;
    /** Both errors when a docker→local fallback chain ended in failure.
     *  Only present after BOTH attempts have been exhausted. */
    previewFallbackErrors?: {
      docker?: string | null;
      local?: string | null;
    } | null;
    /** Set by the readiness gate's content-health probe when the dev
     *  server replied 2xx but the rendered HTML carried a Next.js /
     *  Vite / generic build-error overlay. When this is set, the
     *  preview is `failed` (never `ready`); the UI uses
     *  `detectedErrorType` for the failure category and
     *  `affectedModule` (when present) for a copy-to-clipboard chip. */
    overlayDetection?: {
      detectedErrorType: string;
      detectedErrorMessage: string;
      affectedModule?: string;
      detectedAt?: string;
    } | null;
    /** Dependency-preflight fixes applied immediately before the
     *  preview backend started. Each entry records a package that
     *  was auto-added to package.json because a source file imported
     *  it but it was not declared. Empty / absent when the codebase
     *  was already self-consistent. */
    dependencyFixes?: Array<{
      packageName: string;
      version: string;
      reason: 'imported-not-declared';
      requiredBy: string[];
      packageJson: string;
      block: 'dependencies' | 'devDependencies';
      fixedAt: string;
    }> | null;
    /** Last N HTTP probe attempts during the readiness wait. Each entry
     *  has the full diagnostic shape; capped at 32. Used by the dashboard
     *  to render a per-attempt status grid and by the postmortem dump
     *  to classify "what kind of startup failure occurred?". */
    probeAttempts?: Array<{
      at: string;
      durationMs: number;
      url: string;
      method: 'HEAD' | 'GET';
      outcome: 'success' | 'tcp-failed' | 'tcp-timeout' | 'http-timeout' | 'http-error-status';
      tcpConnected: boolean;
      ok: boolean;
      status: number | null;
      bodySample: string | null;
      errorCode: string | null;
      errorMessage: string | null;
    }> | null;
    /** Roll-up classification of `probeAttempts`. */
    probeRollup?: {
      kind: 'no-probes' | 'port-never-opened' | 'tcp-opened-no-http' | 'http-error-status' | 'http-not-ready';
      total: number;
      tcpEverConnected: boolean;
      httpEverResponded: boolean;
      lastStatus: number | null;
      capturedAt: string;
    } | null;
    /** Discrete lifecycle events with timing + stdout/stderr tails. */
    timeline?: Array<{
      event:
        | 'runner-start' | 'install-start' | 'install-end'
        | 'build-start' | 'build-end' | 'devserver-start'
        | 'port-assigned' | 'http-probe-ok' | 'url-published'
        | 'iframe-ready' | 'failed';
      at: string;
      projectId: string;
      previewStatus: PreviewLifecycleStatus;
      durationMs?: number;
      details?: Record<string, unknown>;
      stdoutTail?: string;
      stderrTail?: string;
    }>;
  };
  diagnostics?: {
    pipelineLedger?: Record<string, unknown>;
    generationBudget?: Record<string, unknown>;
    previewValidationArtifacts?: {
      schemaVersion: 1;
      updatedAt: string;
      runtimeType: 'docker' | 'local' | 'local-fallback' | 'fullstack' | 'unknown' | null;
      routeProbes: Array<{
        source: 'preview-readiness' | 'execution-validator';
        at: string | null;
        method: 'HEAD' | 'GET';
        path: string;
        status: number | null;
        ok: boolean;
        durationMs: number;
        error?: string;
      }>;
      httpStatusResults: {
        total: number;
        ok: number;
        failed: number;
        byStatus: Record<string, number>;
      };
      previewStatusTransitions: Array<{
        at: string;
        previewStatus: PreviewLifecycleStatus;
        event: string;
      }>;
      sanitizedStreams: {
        capturedAt: string | null;
        stdoutSnippet: string | null;
        stderrSnippet: string | null;
      };
      dependencyErrors: string[];
      packageInstallResult: {
        ran: boolean;
        ok: boolean | null;
        exitCode: number | null;
        timedOut: boolean | null;
        durationMs: number | null;
        errors: string[];
      };
      buildResult: {
        ran: boolean;
        ok: boolean | null;
        exitCode: number | null;
        timedOut: boolean | null;
        durationMs: number | null;
        errors: string[];
      };
      devServerResult: {
        ran: boolean;
        ok: boolean | null;
        exitCode: number | null;
        timedOut: boolean | null;
        durationMs: number | null;
        errors: string[];
      };
      bodySampleSummary: {
        source: 'runtime-validator' | 'execution-validator' | null;
        sampleChars: number;
        snippet: string | null;
        looksPlaceholder: boolean;
        hasFrameworkOverlaySignals: boolean;
      };
      placeholderDetection: {
        detected: boolean;
        source: 'qa-assurance' | 'runtime-sample' | 'unknown';
        details: string[];
      };
      frameworkErrorOverlayDetection: {
        detected: boolean;
        detectedErrorType?: string;
        detectedErrorMessage?: string;
        affectedModule?: string;
        detectedAt?: string;
      };
    };
    [key: string]: unknown;
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
