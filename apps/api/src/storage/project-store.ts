// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// File-based storage â€” JSON persistence for projects + sessions
// Works standalone, no DB required to start
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { mkdir, writeFile, readFile, readdir, rm, rename, unlink, open, copyFile, appendFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// Resolved at module load. Anchored to this source file so the mutation
// log lands at apps/api/src/testing/* regardless of which cwd the API
// process was launched from. (Without this we got logs landing at
// apps/api/apps/api/src/testing/* when the api ran with cwd=apps/api/.)
const __MUTATION_LOG_DIR__ = join(dirname(fileURLToPath(import.meta.url)), '..', 'testing');

// ─── Structured corruption error ──────────────────────────────
//
// Thrown by ProjectStore.get() when project.json fails to parse AND
// recovery from the last-known-good backup either wasn't possible or
// itself failed. Route handlers should catch this specifically and
// return a 500 with `{ projectId, code: 'PROJECT_RECORD_CORRUPT',
// recovery }` instead of leaking a generic JSON-parse stack trace.
//
//   recovery:
//     'recovered'  — backup parsed and was promoted; record is usable
//                    again. (We do NOT throw in this case; get() returns
//                    the recovered record. The class still exists for
//                    callers that want to surface a banner.)
//     'unavailable'— no .bak existed (e.g. project never written by the
//                    backup-aware code path).
//     'failed'     — .bak existed but also failed to parse.
//
export class ProjectRecordCorruptError extends Error {
  readonly code = 'PROJECT_RECORD_CORRUPT' as const;
  constructor(
    public readonly projectId: string,
    public readonly recovery: 'unavailable' | 'failed',
    public readonly detail: string,
    public readonly quarantinePath: string | null,
  ) {
    super(`project ${projectId} record is corrupt (recovery=${recovery}): ${detail}`);
    this.name = 'ProjectRecordCorruptError';
  }
}
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { Session, Task, AgentRole } from '../../../../packages/agent-core/src/types.js';
import { auditAndLog } from '../pipeline/file-integrity.js';

// â”€â”€ Version / Diff Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type FileDiffOp = 'added' | 'modified' | 'deleted' | 'unchanged';

export interface FileDiff {
  path: string;
  op: FileDiffOp;
  /** Lines added (for 'added' and 'modified'). */
  additions: number;
  /** Lines removed (for 'deleted' and 'modified'). */
  deletions: number;
}

/** Lightweight metadata stored inline in ProjectRecord.versionHistory. */
export interface VersionMeta {
  /** 1-based version number. */
  version: number;
  /** The prompts that triggered this version. */
  prompts: string[];
  /** Summary of file changes in this version. */
  diffs: FileDiff[];
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: string;
}

/** Full snapshot stored per-version on disk (not loaded into ProjectRecord). */
export interface ProjectSnapshot {
  version: number;
  prompts: string[];
  files: { path: string; content: string }[];
  diffs: FileDiff[];
  spec?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: string;
}

export interface ProjectRecord {
  id: string;
  sessionId: string;
  name: string;
  prompts: string[];
  status: 'generating' | 'completed' | 'failed';
  files: { path: string; content: string }[];
  spec?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  qaReport?: Record<string, unknown>;
  /**
   * Stack selection mode chosen for this project.
   *   - 'auto'   (default): the spec agent picked the stack from the prompt.
   *   - 'manual': the user explicitly chose technologies in the UI.
   * Missing / undefined is treated as 'auto' for backward compatibility.
   */
  stackSelectionMode?: 'auto' | 'manual';
  /**
   * Final technology stack the pipeline committed to (mirror of
   * `spec.techStack`). Materialised on the record so UI/validators don't have
   * to dive into the spec object.
   */
  techStack?: Record<string, string>;
  /** Intent-expansion output: features, UI expectations, quality standards. */
  expandedSpec?: Record<string, unknown>;
  /** Quality-enforcer output: scores, verdict, findings, patches summary. */
  qualityReport?: Record<string, unknown>;
  /** Final QA-gate report: UI, layout, e2e, preview, placeholders — see quality-assurance.ts. */
  qaAssurance?: {
    passed: boolean;
    score: number;
    autoFixCount: number;
    bars: Record<string, { passed: boolean; score: number; notes: string[] }>;
    blockers: { id: string; message: string; bar: string; file?: string }[];
  };
  /** Runtime validation summary from the post-build preview-validator + auto-fix loop.
   *
   *  IMPORTANT: this block describes a *post-completion* health probe, NOT
   *  the generation outcome. project.status is owned by the generation
   *  pipeline (spec → builder → qa-gate → integrity-gate); a failed
   *  runtime-validation can flag a warning here but MUST NOT downgrade
   *  project.status. UI consumers should render this as a separate
   *  "Validation: warning/failed" pill.
   */
  runtimeValidation?: {
    /** Lifecycle of the validator itself (separate from generation status). */
    status?: 'pending' | 'running' | 'passed' | 'warning' | 'failed';
    /** Legacy boolean verdict — kept for backward compatibility with old records. */
    finalVerdict: 'pass' | 'fail';
    iterations: number;
    issues: { category: string; message: string; hint?: string }[];
    totalDurationMs: number;
    completedAt: string;
    /** Human-readable summary used by the UI banner. */
    reason?: string;
  };
  /** Real-environment execution-runner verdict (npm install + build + dev).
   *
   *  Same contract as `runtimeValidation`: this block is informational
   *  only after generation has finished. A failed execution-validation
   *  records `status: 'failed'` (or `'warning'` when the live preview is
   *  reachable, indicating the validator disagrees with empirical truth)
   *  and never demotes project.status. The dashboard renders this as a
   *  separate "Validation" pill alongside BUILD and PREVIEW.
   */
  executionValidation?: {
    /** Lifecycle of the validator itself (separate from generation status). */
    status?: 'pending' | 'running' | 'passed' | 'warning' | 'failed';
    /** Legacy boolean verdict — kept for backward compatibility with old records. */
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
    /** Free-form structured details for dashboard postmortem. */
    details?: Record<string, unknown>;
  };
  /** Final-integrity-gate verdict. Runs after qa-gate but BEFORE
   *  execution / runtime validation; blocks projects whose generated
   *  source still has unresolved package imports or dangling internal
   *  imports from being marked `completed`. When `verdict === 'fail'`,
   *  `status` is `'failed'` and neither preview nor execution
   *  validators were invoked. */
  integrityReport?: {
    verdict: 'pass' | 'fail';
    completedAt: string;
    durationMs: number;
    missingPackages: Array<{
      name: string;
      importedFrom: string[];
      packageJson: string | null;
      reason: 'imported-not-declared' | 'no-host-package-json' | 'package-json-parse-failed';
    }>;
    unparseablePackageJsons: string[];
    danglingInternalImports: Array<{
      importer: string;
      specifier: string;
      triedPaths: string[];
    }>;
    counts: {
      sourceFilesScanned: number;
      bareImportsScanned: number;
      missingPackages: number;
      danglingInternalImports: number;
    };
  };
  tasks: TaskSummary[];
  totalTokens: number;
  totalCostUsd: number;
  optimization?: {
    cacheHit: boolean;
    cacheKey: string;
    pipelineCacheHits: number;
    pipelineCacheMisses: number;
    skippedSteps: number;
    estimatedApiCallsSaved: number;
    /** Number of QA→Builder loop iterations executed (1 = no loop). */
    qaIterations?: number;
  };
  durationMs: number;
  createdAt: string;
  completedAt?: string;
  /** Failure message when status === 'failed'. */
  error?: string;
  /** ISO timestamp of last update (set on update() calls, not initial generate). */
  updatedAt?: string;
  /**
   * Monotonically increasing counter bumped by every save()/update()/updatePreview()
   * inside ProjectStore. Used by the stale-write detector to spot writers that loaded
   * a snapshot, did work, and then tried to clobber a fresher on-disk record with their
   * stale in-memory copy. Older snapshots can never overwrite a newer state because the
   * store rebases their write onto the current on-disk record under the per-project lock.
   * Field is best-effort: zero-default for legacy records.
   */
  stateVersion?: number;
  /** Current version number (1 = initial generation, 2+ = updates). */
  version: number;
  /** Lightweight history of all versions. Oldest first. */
  versionHistory: VersionMeta[];
  /** Non-fatal warnings produced during the pipeline (e.g. partial output
   *  from a soft-deadline break). The project still finishes as 'completed'
   *  but consumers can surface these. */
  warnings?: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  /**
   * Live heartbeat used by external watchdogs to distinguish a *stuck*
   * pipeline from one that is genuinely making early-startup progress.
   * Updated at every meaningful transition (entering spec, before/after the
   * first LLM call, after slices planned, after each persistence write,
   * after each QA iteration). Never persisted by the updater — belongs to
   * the active generation only.
   */
  progress?: {
    /** High-level phase tag: 'init' | 'spec' | 'slice-N/M' | 'final-assembly' | 'qa-gate' | 'execution-validation'. */
    phase: string;
    /** ISO timestamp of the last meaningful update. */
    lastProgressAt: string;
    /** ISO timestamp when the background runner first started. */
    startedAt: string;
    /** Free-form label for the most recent meaningful step ("orchestrator:execute:start", "slice-2:files-persisted", etc.). */
    lastMeaningfulStep: string;
    /** Count of orchestrator step:started events observed so far (≈ LLM agent invocations). */
    llmCallCount: number;
    /** Cumulative count of files persisted to the project record. */
    filesWrittenCount: number;
    /** Number of slices planned by the spec phase (0 until spec returns). */
    slicesPlannedCount: number;
    /**
     * ISO timestamp at which `lastMeaningfulStep` started. Stamped by
     * `markProgress` whenever the caller passes `stepStartedAt`. Used
     * by polling clients to compute "time spent in current step".
     */
    stepStartedAt?: string;
    /**
     * ISO timestamp at which `lastMeaningfulStep` finished. Set by the
     * paired `completeFinalizeStep` / `runFinalizeStep` helpers. When
     * present alongside a still-current `lastMeaningfulStep` it means
     * the step is done but the next step has not yet started.
     */
    stepCompletedAt?: string;
    /** Wall-clock duration (ms) of the most recently completed step. */
    stepDurationMs?: number;
    /** The previous step label, before the current `lastMeaningfulStep`. */
    previousStep?: string;
  };
  /**
   * Preview-runtime lifecycle state. **Decoupled from `status`** — `status`
   * tracks generation only ('generating' | 'completed' | 'failed'); this
   * block tracks the post-generation Docker/local preview server. Mirrored
   * from PreviewManager state on every transition so polling clients can
   * show "Preview starting…" without conflating with generation progress.
   */
  preview?: {
    /** Public preview state vocabulary (decoupled from internal docker states). */
    previewStatus: 'idle' | 'preparing' | 'installing' | 'building' | 'starting' | 'ready' | 'failed';
    /** Convenience flag — true iff previewStatus === 'ready'. */
    previewReady: boolean;
    /** Preview iframe URL (relative). Populated as soon as a host port is allocated. */
    previewUrl?: string | null;
    /** ISO timestamp when start() was first invoked. */
    previewStartedAt?: string | null;
    /** ISO timestamp the moment previewStatus first hit 'ready'. */
    previewReadyAt?: string | null;
    /** ISO timestamp the moment previewStatus transitioned to 'failed'.
     *  Distinct from `previewTimeoutAt` because a `failed` outcome carries
     *  an explicit error from the runtime (process exit code, build
     *  stderr, overlay match), whereas `timeout` carries a deadline
     *  exceeded marker plus a frozen snapshot of the last known phase. */
    previewFailedAt?: string | null;
    /** ISO timestamp the moment the preview-boot watchdog tripped on
     *  this run. Only populated when the boot exceeded the
     *  `PREVIEW_BOOT_TIMEOUT_MS` budget without reaching ready/failed.
     *  When set, `previewStep === 'preview:timeout'` and the diagnostic
     *  dump file `apps/api/src/testing/last-preview-timeout.json`
     *  contains the full forensics for the run. */
    previewTimeoutAt?: string | null;
    /** Boot-budget that was in effect when the watchdog tripped (ms).
     *  Set in tandem with `previewTimeoutAt`. Lets the UI render the
     *  exact number ("Preview timed out after 150s") without hard-
     *  coding the budget client-side. */
    previewTimeoutDurationMs?: number | null;
    /** Liveness verdict for the dev-server child process at the moment
     *  the watchdog tripped — `true` = process still alive (stuck
     *  spinning), `false` = process already dead, `null` = unknown
     *  (no PID was captured). Surfaced as a forensic chip on the
     *  preview-failed card so the user can tell "stuck dev server"
     *  apart from "process died silently". */
    previewChildAlive?: boolean | null;
    /** Precise classification of WHERE in the boot pipeline a timeout
     *  stalled. Set in tandem with `previewTimeoutAt` by the
     *  boot-watchdog classifier. One of:
     *    install-hung | build-hung | server-not-spawned |
     *    server-not-listening | http-probe-failed | unknown
     *  Lets the dashboard render an exact category badge instead of
     *  parsing the free-form `previewError` string. */
    previewTimeoutCause?:
      | 'install-hung'
      | 'build-hung'
      | 'server-not-spawned'
      | 'server-not-listening'
      | 'http-probe-failed'
      | 'unknown'
      | null;
    /** Lifecycle booleans the timeout-cause classifier consumed.
     *  Persisted alongside `previewTimeoutCause` so the dashboard +
     *  triage tooling can show the raw signals the verdict was
     *  derived from. */
    previewTimeoutLifecycle?: {
      installStarted: boolean;
      installCompleted: boolean;
      buildStarted: boolean;
      buildCompleted: boolean;
      serverSpawned: boolean;
      portOpened: boolean;
      firstProbeAttempted: boolean;
    } | null;
    /** Server-process liveness snapshot — classifies a stuck/failed
     *  boot into one of: no-process / crashed / exited-clean /
     *  alive-hanging / alive-not-reachable / alive-healthy. Captured
     *  by the boot watchdog and the runtime-exit listener. Drives the
     *  "Process: …" chip on the preview-failed card. */
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
    /** Failure message when previewStatus === 'failed'. */
    previewError?: string | null;
    /** Live runtime-log snapshot captured during preview startup so a
     *  stuck preview can be diagnosed via the project record alone
     *  (without engineers needing to tail server logs). Updated
     *  periodically by the boot watchdog and verbatim into
     *  `last-preview-timeout.json` if the watchdog ever trips. */
    previewRuntimeLog?: {
      /** Child PID of the dev-server process. `null` before spawn or
       *  after the child has exited. */
      pid: number | null;
      /** Argv — e.g. `npm.cmd run dev` or `docker run …`. */
      cmd: string | null;
      /** Working directory the child was spawned in. */
      cwd: string | null;
      /** Host port allocated for the dev server. `null` until the port
       *  allocator has handed one out. */
      port: number | null;
      /** Last ≤3 KB of stdout. */
      stdoutTail: string | null;
      /** Last ≤3 KB of stderr. */
      stderrTail: string | null;
      /** ISO timestamp this snapshot was captured. */
      capturedAt: string;
    } | null;
    /** Per-start identifier (random short id) — distinct from projectId. */
    previewId?: string | null;
    /** Backend that produced (or attempted) this preview. `local-fallback`
     *  is a local runner that ran AFTER a docker attempt failed. */
    previewRuntime?: 'docker' | 'local' | 'local-fallback' | 'fullstack' | null;
    /** Last successful boot step before failure. */
    previewLastStep?: string | null;
    /** Forensic exit info attached on failure. */
    previewExit?: {
      exitCode?: number | null;
      signal?: string | null;
      oomKilled?: boolean;
      dockerError?: string | null;
      capturedAt?: string;
    } | null;
    /** Fine-grained boot phase. */
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
    /** ISO timestamp the current `previewStep` completed (preview:ready /
     *  preview:failed only). */
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
     *  Cleared on successful preview or on first attempt failure (only
     *  set after the fallback path has also been exhausted). */
    previewFallbackErrors?: {
      docker?: string | null;
      local?: string | null;
    } | null;
    /** Per-attempt history of the local-runner start() call. Capped at
     *  two entries: the initial attempt and an optional safe retry
     *  that fires only when the first attempt failed BEFORE any TCP
     *  probe connected (intermittent class only — peer-dep mismatches
     *  and post-bind crashes are NOT retried). Each row carries
     *  `attempt` (1|2), `ok`, `error`, `portOpened`, `durationMs`,
     *  and the start/end ISO timestamps. */
    previewLocalStartAttempts?: Array<{
      attempt: 1 | 2;
      ok: boolean;
      error: string | null;
      portOpened: boolean;
      durationMs: number;
      startedAtIso: string;
      endedAtIso: string;
    }> | null;
    /** Outcome of the safe retry. `true` = the second attempt
     *  succeeded (preview reached ready); `false` = the second
     *  attempt also failed; `null` = no retry was attempted (first
     *  attempt either succeeded or was ineligible for retry). */
    previewLocalRetrySucceeded?: boolean | null;
    /** Set by the readiness gate's content-health probe when the dev
     *  server responded 2xx but the rendered HTML carried a Next.js /
     *  Vite / generic build-error overlay. Whenever this is set, the
     *  preview is `failed` (never `ready`). The UI surfaces
     *  `detectedErrorType` as a category badge and `affectedModule`
     *  (when present) as a copy chip. */
    overlayDetection?: {
      detectedErrorType: string;
      detectedErrorMessage: string;
      affectedModule?: string;
      detectedAt?: string;
    } | null;
    /** Dependency-preflight fixes applied immediately before staging
     *  files for this preview run. Populated when imports in the
     *  persisted source tree referenced packages missing from
     *  package.json. Surfaced in the dashboard postmortem. */
    dependencyFixes?: Array<{
      packageName: string;
      version: string;
      reason: 'imported-not-declared';
      requiredBy: string[];
      packageJson: string;
      block: 'dependencies' | 'devDependencies';
      fixedAt: string;
    }> | null;
    /** Per-attempt boot history when the auto-fix retry loop was
     *  engaged. Each entry records the attempt outcome, classifier
     *  verdict, the fix (if any) applied between this attempt and
     *  the next, and whether a retry was triggered. Capped at the
     *  manager-side `MAX_PREVIEW_FIX_ATTEMPTS` constant (=2). */
    previewFixAttempts?: Array<{
      attempt: number;
      startedAt: string;
      finishedAt: string;
      outcome: 'ready' | 'failed';
      runtime?: 'docker' | 'local' | 'local-fallback' | 'fullstack';
      error?: string | null;
      classification?: {
        kind: 'missing-package' | 'unknown';
        missingPackage?: string;
        file?: string;
        message: string;
        autoFixable: boolean;
      };
      fixApplied?: {
        kind: 'add-missing-dependency';
        packageName: string;
        version: string;
        block: 'dependencies' | 'devDependencies';
        packageJson: string;
        appliedAt: string;
      };
      retryTriggered: boolean;
      retrySkippedReason?:
        | 'not-auto-fixable'
        | 'already-attempted'
        | 'fix-injector-no-op'
        | 'attempt-cap-reached';
    }> | null;
    /** Last N HTTP probes against the preview's host port during the
     *  readiness wait. Capped at 32 entries. Each attempt carries the
     *  full diagnostic shape (outcome, status, body sample, errno)
     *  so the dashboard / postmortem dump can answer "what kind of
     *  startup failure was this?" without re-parsing the timeline. */
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
    /** Roll-up classification of `probeAttempts`. Single-line verdict
     *  for the UI ("Port never opened" / "TCP opened but HTTP failed"
     *  / "HTTP responded with error status" / "HTTP not ready"). */
    probeRollup?: {
      kind: 'no-probes' | 'port-never-opened' | 'tcp-opened-no-http' | 'http-error-status' | 'http-not-ready';
      total: number;
      tcpEverConnected: boolean;
      httpEverResponded: boolean;
      lastStatus: number | null;
      capturedAt: string;
    } | null;
    /** Discrete lifecycle events with durations + stdout/stderr tails.
     *  Drives the dashboard “why is the preview taking so long?” view. */
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
  /** Detailed crash record (set alongside `error` when status === 'failed'). */
  failure?: {
    failedPhase: string;
    errorName: string;
    errorMessage: string;
    stack?: string;
    failedAt: string;
    /** Most recently completed phase before the crash. Helps post-mortem
     *  pinpoint how far the pipeline got. */
    lastSuccessfulPhase?: string;
    /** Number of LLM calls observed (via orchestrator step:started events)
     *  before the crash. 0 means the failure happened before any LLM
     *  invocation \u2014 typically a setup/config problem. */
    llmCallCount?: number;
    /** Granular step within `failedPhase` where the throw happened (e.g.
     *  'final-assembly:assembleProject', 'qa-gate:runQualityAssurance',
     *  'finalize:projectStore.save'). */
    failedStep?: string;
    /** Most recently completed step before the crash. */
    lastSuccessfulStep?: string;
    /** Alias for `stack` \u2014 some consumers expect the conventional name. */
    errorStack?: string;
  };
}

export interface TaskSummary {
  id: string;
  agentRole: AgentRole;
  status: string;
  durationMs: number;
  tokensUsed: number;
  costUsd: number;
  error?: string;
}

/**
 * Options accepted by ProjectStore.save() / update() / updatePreview() that
 * tune the stale-write detector. ALL fields are optional; the defaults are
 * the SAFE choice (preserve on-disk preview, block status downgrades).
 *
 *   - caller / reason: free-form labels written into the mutation log so
 *     repeated downgrade attempts can be attributed to a specific call site.
 *   - allowPreviewOverwrite: only PreviewManager.updatePreview() should
 *     ever set this. Other writers always get their next.preview rebased
 *     onto the on-disk record.
 *   - allowStatusDowngrade: required to flip 'completed' → anything else
 *     or 'failed' → 'generating'. Without it, the guard restores the
 *     on-disk status and logs STALE_WRITE.
 */
export interface WriteOpts {
  caller?: string;
  reason?: string;
  allowPreviewOverwrite?: boolean;
  allowStatusDowngrade?: boolean;
  /**
   * Marks the writer as part of the preview lifecycle (preflight,
   * runner, manager). Preview-side writers are STRUCTURALLY forbidden
   * from mutating `project.status` — the preview lifecycle must only
   * touch the `preview` block via `updatePreview()`. If a preview
   * writer accidentally produces a `next.status` that differs from
   * the on-disk value, the guard restores the disk value and emits a
   * loud STALE_WRITE log instead of allowing the mutation.
   *
   * This is the structural enforcement of the rule "preview failures
   * must never revert project.status back to generating": even if a
   * future preview code path forgets to preserve status in its
   * mutator, the store refuses to write the bad value.
   */
  previewWriter?: boolean;
}

interface MutationDiff {
  fields: Record<string, { prev: unknown; next: unknown }>;
  stateVersion: number;
}

interface MutationLogEntry {
  ts: string;
  projectId: string;
  caller: string;
  reason: string;
  op: 'save' | 'update' | 'updatePreview';
  stateVersion: number;
  fields: MutationDiff['fields'];
}

export class ProjectStore {
  private baseDir: string;
  private logger: Logger;
  /**
   * Per-project write serialization. Every mutation of a project.json
   * acquires a Promise on this map and chains the next write after
   * the previous resolves so two callers (e.g. pipeline `save()` AND
   * preview `updatePreview()`) can never interleave a read-modify-write
   * cycle and produce a half-written or partially-merged JSON blob.
   * The slot is cleared once its chain settles to keep the map bounded.
   */
  private writeLocks = new Map<string, Promise<void>>();

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  /**
   * Run `fn` while holding the per-project write lock. Subsequent
   * calls for the same projectId queue behind the in-flight call. The
   * lock NEVER throws back into the queue: even if `fn` rejects, the
   * chain advances so the next caller doesn't deadlock.
   *
   * Logs an `project-store:write-overlap` warning whenever a caller
   * has to wait for a previous write to finish. Repeated overlaps in
   * the logs point at racing writers that should be migrated to
   * `update()` (the canonical read-modify-write API).
   */
  private withProjectLock<T>(
    projectId: string,
    fn: () => Promise<T>,
    phase = 'unknown',
  ): Promise<T> {
    const prev = this.writeLocks.get(projectId);
    const overlapping = prev !== undefined;
    const queuedAt = Date.now();
    if (overlapping) {
      this.logger.warn('project-store: overlapping write detected (queued behind in-flight write)', {
        event: 'project-store:write-overlap',
        projectId,
        phase,
      });
    }
    let release!: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    // Chain after prev — swallowing prev's rejection so a previous
    // caller's failure can't leak into ours.
    const run = (prev ?? Promise.resolve()).catch(() => undefined).then(async () => {
      const waitMs = Date.now() - queuedAt;
      if (overlapping && waitMs > 50) {
        this.logger.info('project-store: write proceeded after queue wait', {
          event: 'project-store:write-resumed',
          projectId,
          phase,
          waitMs,
        });
      }
      try {
        return await fn();
      } finally {
        release();
        // GC the slot if we're still the tail of the chain. Comparing
        // by identity prevents us from clobbering a newer queued call.
        if (this.writeLocks.get(projectId) === next) {
          this.writeLocks.delete(projectId);
        }
      }
    });
    this.writeLocks.set(projectId, next);
    return run;
  }

  /**
   * Atomically write a JSON-serialisable value to `filePath`.
   *
   * Sequence:
   *   1. JSON.stringify the value (in-memory). If it throws (cyclic
   *      ref, BigInt, …) we abort BEFORE touching the filesystem so
   *      the existing on-disk file is preserved.
   *   2. Write the serialised text to a sibling `<file>.tmp.<uuid>`.
   *   3. Open the tmp file with O_RDWR and call `fdatasync` so the
   *      bytes are flushed to the platter before the rename.
   *   4. `rename(tmp, target)` — POSIX-atomic on the same filesystem,
   *      and atomic-replace on Windows when the target already exists
   *      (Node uses MoveFileEx with MOVEFILE_REPLACE_EXISTING).
   *   5. On any failure mid-write, unlink the tmp file (best-effort)
   *      and rethrow. The target file is NEVER truncated by us — a
   *      mid-process crash leaves either the OLD contents intact or
   *      a stray .tmp.<uuid> sibling that can be GC'd by housekeeping.
   *
   * Logs a single info event with caller phase, byte size, and tmp
   * path for both start AND finish so a malformed project.json can
   * be triaged from logs alone.
   */
  private async atomicWriteJson(
    filePath: string,
    value: unknown,
    ctx: { projectId: string; phase: string; backup?: boolean },
  ): Promise<void> {
    // Step 1: serialise BEFORE opening any fd. A failure here MUST NOT
    // touch the on-disk file.
    let serialized: string;
    try {
      serialized = JSON.stringify(value, null, 2);
    } catch (err) {
      this.logger.error('atomicWriteJson: serialization failed (preserving existing file)', {
        event: 'project-store:write-serialize-failed',
        projectId: ctx.projectId,
        phase: ctx.phase,
        filePath,
        error: (err as Error).message,
      });
      throw new Error(`atomicWriteJson: refusing to overwrite ${filePath} — JSON.stringify failed: ${(err as Error).message}`);
    }
    if (typeof serialized !== 'string' || serialized.length === 0) {
      // JSON.stringify returns undefined for `undefined`/symbols/functions.
      throw new Error(`atomicWriteJson: refusing to overwrite ${filePath} — serialized value is empty/undefined.`);
    }

    const bytes = Buffer.byteLength(serialized, 'utf8');
    const tmpPath = `${filePath}.tmp.${process.pid}.${randomUUID()}`;
    this.logger.debug('atomicWriteJson: start', {
      event: 'project-store:write-start',
      projectId: ctx.projectId,
      phase: ctx.phase,
      filePath,
      tmpPath,
      bytes,
    });

    let fh: import('node:fs/promises').FileHandle | null = null;
    try {
      // Step 2 + 3: write to tmp then fdatasync so the rename observes
      // the full payload even if the OS crashes mid-flight.
      await mkdir(dirname(filePath), { recursive: true });
      fh = await open(tmpPath, 'w');
      await fh.writeFile(serialized, { encoding: 'utf8' });
      await fh.sync();
      await fh.close();
      fh = null;
      // Step 3.5 (project.json only): keep one last-known-good backup.
      // Validate the EXISTING file before copying — we'd rather have
      // no backup than a backup of corruption. The .bak file is the
      // recovery target consulted by ProjectStore.get() when the
      // primary file fails to parse.
      if (ctx.backup && existsSync(filePath)) {
        try {
          const existingRaw = await readFile(filePath, 'utf-8');
          JSON.parse(existingRaw); // validate-only
          await copyFile(filePath, `${filePath}.bak`);
        } catch (bakErr) {
          // Existing file is unreadable/unparseable; preserve the
          // older .bak (if any) and proceed with the new write so a
          // corrupt record doesn't block forward progress.
          this.logger.warn('atomicWriteJson: skipped backup (existing file unreadable)', {
            event: 'project-store:backup-skipped',
            projectId: ctx.projectId,
            phase: ctx.phase,
            filePath,
            error: (bakErr as Error).message,
          });
        }
      }
      // Step 4: atomic rename. MoveFileEx-atomic on Windows when the
      // target exists; rename(2)-atomic on POSIX.
      await rename(tmpPath, filePath);
      this.logger.info('atomicWriteJson: ok', {
        event: 'project-store:write-ok',
        projectId: ctx.projectId,
        phase: ctx.phase,
        filePath,
        tmpPath,
        bytes,
      });
    } catch (err) {
      this.logger.error('atomicWriteJson: failed (existing file untouched)', {
        event: 'project-store:write-failed',
        projectId: ctx.projectId,
        phase: ctx.phase,
        filePath,
        tmpPath,
        bytes,
        error: (err as Error).message,
      });
      // Best-effort tmp cleanup. Re-throw the original.
      if (fh) await fh.close().catch(() => undefined);
      await unlink(tmpPath).catch(() => undefined);
      throw err;
    }
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  // ────────────────────────────────────────────────────────────
  // Stale-write detection + mutation log
  // ────────────────────────────────────────────────────────────
  //
  // Every write to project.json passes through `applyStateGuards()`. The
  // guard runs UNDER the per-project lock with a fresh on-disk read so
  // it can compare what the writer wants against what's actually on
  // disk RIGHT NOW (not what the writer saw when it started).
  //
  //   1. PREVIEW BLOCK PROTECTION
  //      ProjectRecord.preview is owned exclusively by PreviewManager
  //      via updatePreview(). Any other writer (markProgress, slice
  //      saves, finalize, project-updater) is presumed to be holding a
  //      stale snapshot — their `next.preview` is silently rebased
  //      onto the on-disk preview. Bypass with `allowPreviewOverwrite`.
  //
  //   2. STATUS DOWNGRADE GUARD
  //      Refuses transitions like `completed → generating` or
  //      `completed → failed` (without a fresher signal) unless the
  //      caller explicitly passes `allowStatusDowngrade: true` and a
  //      `reason`. Logs STALE_WRITE.
  //
  //   3. MONOTONIC stateVersion + updatedAt
  //      Every accepted write bumps `stateVersion = existing+1` and
  //      stamps `updatedAt = new Date().toISOString()`.
  //
  //   4. JSONL MUTATION LOG (dev / DIAGNOSTIC only)
  //      Each accepted write appends a single line to
  //      `apps/api/src/testing/project-state-mutations-<projectId>.jsonl`
  //      with { ts, caller, reason, fields, prev, next, stateVersion }.
  //
  //   The guard NEVER throws — it warns, rebases, and proceeds. The
  //   loudness is intentional: silent rejection would mean the writer
  //   silently observes a different state than it persisted, which is
  //   exactly the bug we're trying to prevent.

  private readonly mutationLogTrackedFields: ReadonlyArray<keyof ProjectRecord> = [
    'status', 'error', 'completedAt',
  ] as const;

  private get mutationLoggingEnabled(): boolean {
    return process.env.NODE_ENV !== 'production' || process.env.DIAGNOSTIC === '1';
  }

  /**
   * Apply preview-preserve, stale-write detection, and stateVersion/updatedAt
   * bump to `next` against the current on-disk record `existing`. Mutates
   * `next` in place. Returns the diff used for the mutation log.
   *
   * MUST be called under the per-project lock with `existing` freshly
   * read in the same locked region.
   */
  private applyStateGuards(
    existing: ProjectRecord | null,
    next: ProjectRecord,
    opts: WriteOpts,
  ): MutationDiff {
    const caller = opts.caller ?? 'unknown';
    const reason = opts.reason ?? '';
    const fields: MutationDiff['fields'] = {};

    // (1) Preview-block protection: preview is owned by updatePreview().
    // If the on-disk record has a preview block and we're not the
    // dedicated preview writer, rebase next.preview onto existing.preview
    // so this writer cannot regress it. Same logic for top-level fields
    // owned by the preview lifecycle (none currently — preview is the
    // only nested block we own).
    if (existing && !opts.allowPreviewOverwrite) {
      const existingPreview = existing.preview;
      const nextPreview = next.preview;
      const rebased =
        existingPreview !== undefined &&
        JSON.stringify(existingPreview) !== JSON.stringify(nextPreview);
      if (rebased) {
        const prevStatus = nextPreview?.previewStatus ?? null;
        const onDiskStatus = existingPreview.previewStatus;
        // Loud only when the writer's in-memory copy was MORE pessimistic
        // than disk (e.g. trying to write previewStatus=undefined over
        // 'ready'). Silent when they match (just a stale-but-equal copy).
        const downgrading =
          onDiskStatus === 'ready' && prevStatus !== 'ready';
        if (downgrading) {
          this.logger.warn('project-store: STALE_WRITE preview rebase (preserving on-disk preview block)', {
            event: 'project-store:stale-write-preview-rebase',
            projectId: next.id,
            caller,
            reason,
            onDiskPreviewStatus: onDiskStatus,
            wouldHaveOverwrittenWith: prevStatus,
          });
        }
        fields.preview_rebased = { prev: nextPreview ?? null, next: existingPreview };
      }
      next.preview = existingPreview;
    }

    // (2) Status-downgrade guard.
    if (existing && existing.status !== next.status) {
      const prev = existing.status;
      const cur = next.status;
      // (2a) Preview-side writers are FORBIDDEN from mutating status,
      // full stop. The preview lifecycle must only write the
      // `preview` block via updatePreview(). This is the structural
      // fix for "preview failures must never revert project.status".
      if (opts.previewWriter) {
        this.logger.error('project-store: STALE_WRITE preview writer attempted status mutation — BLOCKED', {
          event: 'project-store:preview-writer-status-blocked',
          projectId: next.id,
          caller,
          reason,
          onDisk: prev,
          attempted: cur,
        });
        next.status = prev;
        next.error = existing.error;
        next.completedAt = existing.completedAt;
        fields.status_blocked_preview_writer = { prev: cur, next: prev };
      } else {
        const downgrade =
          (prev === 'completed' && cur !== 'completed') ||
          (prev === 'failed' && cur === 'generating');
        if (downgrade && !opts.allowStatusDowngrade) {
          this.logger.error('project-store: STALE_WRITE status downgrade BLOCKED — preserving on-disk status', {
            event: 'project-store:stale-write-status-blocked',
            projectId: next.id,
            caller,
            reason,
            onDisk: prev,
            attempted: cur,
          });
          next.status = prev;
          // Also restore error/completedAt to disk values to keep the
          // record consistent with the preserved status.
          next.error = existing.error;
          next.completedAt = existing.completedAt;
          fields.status_blocked = { prev: cur, next: prev };
        } else {
          fields.status = { prev, next: cur };
          if (downgrade) {
            this.logger.warn('project-store: status downgrade ALLOWED (caller passed allowStatusDowngrade)', {
              event: 'project-store:status-downgrade-allowed',
              projectId: next.id,
              caller,
              reason,
              from: prev,
              to: cur,
            });
          }
        }
      }
    }

    // (3) Track other interesting fields for the mutation log.
    for (const field of this.mutationLogTrackedFields) {
      if (field === 'status') continue; // already tracked above
      const a = existing ? existing[field] : undefined;
      const b = next[field];
      if (JSON.stringify(a) !== JSON.stringify(b)) {
        fields[field] = { prev: a ?? null, next: b ?? null };
      }
    }

    // (3.5) Conflict detector: preview READY while project FAILED.
    // This is the exact split-truth case the diagnostic dashboard
    // surfaces. Loud-log it from the writer that produced the conflict
    // so the precise call site (caller / reason) is recorded alongside.
    const onDiskPreviewStatus = existing?.preview?.previewStatus ?? null;
    const nextPreviewStatus = next.preview?.previewStatus ?? null;
    const effectivePreviewStatus = nextPreviewStatus ?? onDiskPreviewStatus;
    if (next.status === 'failed' && effectivePreviewStatus === 'ready') {
      this.logger.error('project-store: CONFLICTING_TRUTH project.status=failed AND preview.previewStatus=ready', {
        event: 'project-store:conflicting-truth',
        projectId: next.id,
        caller,
        reason,
        statusPrev: existing?.status ?? null,
        statusNext: next.status,
        previewStatus: effectivePreviewStatus,
      });
      fields.conflicting_truth = {
        prev: { status: existing?.status ?? null, previewStatus: onDiskPreviewStatus },
        next: { status: next.status, previewStatus: effectivePreviewStatus },
      };
    }

    // (4) Monotonic version + timestamp.
    const prevVersion = existing?.stateVersion ?? 0;
    next.stateVersion = prevVersion + 1;
    next.updatedAt = new Date().toISOString();

    return { fields, stateVersion: next.stateVersion };
  }

  /**
   * Append a single line to the per-project mutation log. Best-effort —
   * a logging failure must never block a real write.
   */
  private async appendMutationLog(
    projectId: string,
    entry: MutationLogEntry,
  ): Promise<void> {
    if (!this.mutationLoggingEnabled) return;
    if (Object.keys(entry.fields).length === 0) return;
    try {
      await mkdir(__MUTATION_LOG_DIR__, { recursive: true });
      const file = join(__MUTATION_LOG_DIR__, `project-state-mutations-${projectId}.jsonl`);
      await appendFile(file, JSON.stringify(entry) + '\n', 'utf8');
    } catch {
      // intentionally swallowed
    }
  }

  /**
   * Reap projects left in 'generating' state from a previous process. The API
   * runs all pipelines in-memory, so any 'generating' project on disk at
   * startup is by definition orphaned (its background task died with the
   * previous process). Demote them to 'failed' so the UI doesn't show a
   * permanent spinner. Returns the number of records reaped.
   */
  async reapStaleGenerating(): Promise<number> {
    if (!existsSync(this.baseDir)) return 0;
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    let reaped = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(this.baseDir, entry.name, 'project.json');
      if (!existsSync(metaPath)) continue;
      try {
        // Acquire the per-project lock so we don't race with an
        // updatePreview() or save() in flight from a sibling worker.
        // Even though `reapStaleGenerating` runs at startup, defensive
        // locking is cheap and keeps the contract uniform.
        await this.withProjectLock(entry.name, async () => {
          const raw = await readFile(metaPath, 'utf-8');
          const project = JSON.parse(raw) as ProjectRecord;
          if (project.status !== 'generating') return;
          project.status = 'failed';
          project.completedAt = project.completedAt ?? new Date().toISOString();
          await this.atomicWriteJson(metaPath, project, {
            projectId: entry.name,
            phase: 'reapStaleGenerating',
            backup: true,
          });
          reaped++;
        }, 'reapStaleGenerating');
      } catch (err) {
        this.logger.warn(`reapStaleGenerating: skipped ${entry.name}: ${(err as Error).message}`);
      }
    }
    if (reaped > 0) this.logger.info(`Reaped ${reaped} orphaned 'generating' project(s) from previous run`);
    return reaped;
  }

  /** Save or update a project record */
  async save(project: ProjectRecord, opts: WriteOpts = {}): Promise<void> {
    // Ensure version fields are always present (handles records created before versioning)
    if (!project.version) project.version = 1;
    if (!project.versionHistory) project.versionHistory = [];
    const dir = join(this.baseDir, project.id);
    await mkdir(dir, { recursive: true });

    // Run the entire save (project.json + output/ tree) under the
    // per-project lock so a concurrent updatePreview() can't read a
    // stale project.json, merge its preview patch into it, and then
    // overwrite the freshly-saved record. Without this lock that race
    // is what produced the half-written / partially-merged JSON the
    // user observed in GET /api/projects/:id.
    let diff: MutationDiff = { fields: {}, stateVersion: 0 };
    await this.withProjectLock(project.id, async () => {
      // Read fresh on-disk record under the lock so the stale-write
      // detector can compare the writer's `project` against TRUTH.
      // Critical: this closes the get()→save() race that markProgress
      // and the slice-loop save()s can otherwise hit, where a sibling
      // updatePreview('ready') landed on disk and gets clobbered by
      // this save()'s in-memory `project.preview` (which is whatever
      // value the generator had before preview started).
      const metaPath = join(dir, 'project.json');
      let existing: ProjectRecord | null = null;
      if (existsSync(metaPath)) {
        try {
          const raw = await readFile(metaPath, 'utf-8');
          existing = JSON.parse(raw) as ProjectRecord;
        } catch {
          existing = null; // treat as first write
        }
      }
      diff = this.applyStateGuards(existing, project, opts);

      // Save project metadata atomically (tmp → fsync → rename) so a
      // crash mid-write can never leave a torn project.json behind.
      await this.atomicWriteJson(
        metaPath,
        project,
        { projectId: project.id, phase: 'save', backup: true },
      );
      // Save generated files to disk. Wipe the previous output/ tree first
      // so files removed since the last save (e.g. by layout consolidation
      // that strips apps/web/* duplicates) don't linger on disk and confuse
      // downstream tooling like the runtime validator or the live preview.
      if (project.files.length > 0) {
        const outputDir = join(dir, 'output');
        if (existsSync(outputDir)) {
          await rm(outputDir, { recursive: true, force: true });
        }
        await mkdir(outputDir, { recursive: true });

        for (const file of project.files) {
          // Defensive: refuse to write an entry whose content is not a string.
          // fs.writeFile would otherwise throw a low-level Node TypeError that
          // crashes the entire save and leaves the project in a half-persisted
          // state. We log the offending path + context so the introduction
          // step can be located via the file-integrity audit log.
          if (typeof file.content !== 'string') {
            this.logger.error(
              `[project-store.save] REFUSING to write file with non-string content: "${file.path}" (typeof=${typeof file.content})`,
              { event: 'project-store:invalid-file-content', projectId: project.id, path: file.path, typeofContent: typeof file.content },
            );
            throw new Error(
              `Cannot save project ${project.id}: file "${file.path}" has non-string content (typeof=${typeof file.content}). ` +
              'Check the file-integrity audit log to find the introducing step.',
            );
          }
          const filePath = join(outputDir, file.path);
          await mkdir(dirname(filePath), { recursive: true });
          await writeFile(filePath, file.content, 'utf-8');
        }
      }
    }, 'save');

    await this.appendMutationLog(project.id, {
      ts: new Date().toISOString(),
      projectId: project.id,
      caller: opts.caller ?? 'unknown',
      reason: opts.reason ?? '',
      op: 'save',
      stateVersion: diff.stateVersion,
      fields: diff.fields,
    });

    this.logger.debug(`Saved project ${project.id}`);
  }

  /** Load a project by ID */
  async get(projectId: string): Promise<ProjectRecord | null> {
    const metaPath = join(this.baseDir, projectId, 'project.json');
    if (!existsSync(metaPath)) return null;

    // Read under the project lock so a load can never observe an
    // in-flight write. Combined with the atomic rename, this means
    // we either see the full pre-write file or the full post-write
    // file — never a torn mid-write byte sequence.
    return this.withProjectLock(projectId, async () => {
      const raw = await readFile(metaPath, 'utf-8');
      let project: ProjectRecord;      try {
        project = JSON.parse(raw) as ProjectRecord;
      } catch (err) {
        // ── Malformed project.json — recover or quarantine ──
        // Step 1: quarantine the bad file so a subsequent successful
        // write doesn't erase the forensic evidence. Filename is safe
        // on Windows (no colons).
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        const corruptPath = `${metaPath}.corrupt.${stamp}`;
        let quarantinePath: string | null = null;
        try {
          await copyFile(metaPath, corruptPath);
          quarantinePath = corruptPath;
        } catch (copyErr) {
          this.logger.warn('failed to quarantine corrupt project.json', {
            event: 'project-store:quarantine-failed',
            projectId,
            metaPath,
            corruptPath,
            error: (copyErr as Error).message,
          });
        }
        this.logger.error('project.json is malformed (load failed)', {
          event: 'project-store:load-malformed',
          projectId,
          metaPath,
          quarantinePath,
          bytes: Buffer.byteLength(raw, 'utf8'),
          error: (err as Error).message,
          headSample: raw.slice(0, 200),
          tailSample: raw.slice(-200),
        });

        // Step 2: attempt recovery from the last-known-good backup.
        const bakPath = `${metaPath}.bak`;
        if (existsSync(bakPath)) {
          let bakRaw: string;
          let recovered: ProjectRecord;
          try {
            bakRaw = await readFile(bakPath, 'utf-8');
            recovered = JSON.parse(bakRaw) as ProjectRecord;
          } catch (bakErr) {
            this.logger.error('project.json backup also failed to parse — manual repair required', {
              event: 'project-store:recovery-failed',
              projectId,
              bakPath,
              quarantinePath,
              error: (bakErr as Error).message,
            });
            throw new ProjectRecordCorruptError(
              projectId,
              'failed',
              `primary parse failed (${(err as Error).message}); backup also unparseable (${(bakErr as Error).message})`,
              quarantinePath,
            );
          }
          // Promote the backup back into project.json. Skip making a
          // new .bak from the corrupt source (atomicWriteJson would
          // fail to validate it anyway). We're already inside the
          // per-project lock so atomicWriteJson is safe to invoke
          // directly without re-entering withProjectLock.
          try {
            await this.atomicWriteJson(metaPath, recovered, {
              projectId, phase: 'recover-from-backup', backup: false,
            });
            this.logger.warn('project.json recovered from .bak', {
              event: 'project-store:recovered-from-backup',
              projectId,
              metaPath,
              bakPath,
              quarantinePath,
              bytes: Buffer.byteLength(bakRaw, 'utf8'),
            });
          } catch (writeErr) {
            // The recovery write failed but we have a parsed backup
            // in memory — return it anyway so the caller gets a
            // usable record. The next write will overwrite the
            // corrupt file.
            this.logger.error('project.json recovery: backup parsed but rewrite failed', {
              event: 'project-store:recovery-rewrite-failed',
              projectId,
              error: (writeErr as Error).message,
            });
          }
          if (Array.isArray(recovered.files)) {
            auditAndLog(recovered.files, `persisted-project.recover:${projectId}`, this.logger);
          }
          return recovered;
        }

        // Step 3: no backup → structured failure.
        throw new ProjectRecordCorruptError(
          projectId,
          'unavailable',
          `project.json failed to parse (${(err as Error).message}); no .bak available for recovery`,
          quarantinePath,
        );
      }

      // ── File-integrity audit on load ──
      // JSON.stringify silently drops object keys whose value is `undefined`,
      // so a file persisted with `content: undefined` reappears here as an
      // entry whose `content` key is entirely missing. Log this with the
      // exact step label so the corruption can be attributed to persistence
      // roundtripping rather than to a downstream consumer.
      if (Array.isArray(project.files)) {
        auditAndLog(project.files, `persisted-project.load:${projectId}`, this.logger);
      }

      return project;
    }, 'get');
  }

  // ────────────────────────────────────────────────────────────
  // Concurrency-safe writer map
  //
  //   Persistent file       Writers (all routed through this.atomicWriteJson
  //                         under this.withProjectLock(projectId)):
  //   ─────────────────     ──────────────────────────────────────────────
  //   project.json          • save()                — full record replace
  //                         • updatePreview()       — preview block patch
  //                         • update()              — generic mutator (NEW)
  //                         • reapStaleGenerating() — startup reaper
  //   versions/vN.json      • saveSnapshot()
  //   output/<files>        • save()                — files tree (non-JSON)
  //
  //   Anything that needs to mutate ProjectRecord.* (status, error,
  //   executionValidation, runtimeValidation, warnings, totalTokens, …)
  //   MUST go through `update()` — never `save(await get())` from
  //   outside this class. The latter pattern is a lost-update bomb
  //   when it races with `updatePreview()` or another `save()`.
  // ────────────────────────────────────────────────────────────

  /**
   * Canonical read-modify-write helper. Loads the project, hands it
   * to `mutator`, and persists the result atomically — all under the
   * per-project lock. The mutator may either mutate the record in
   * place (and return `void`) or return a new record. Returning
   * `null`/`undefined` after mutating is fine; returning `false`
   * cancels the write.
   *
   * Use this for ANY caller that previously did:
   *     const fresh = await store.get(id);
   *     fresh.someField = newValue;
   *     await store.save(fresh);
   *
   * That sequence holds the lock only during `save()` — between
   * `get()` and `save()` a sibling write (e.g. updatePreview) can land
   * and be silently overwritten. `update()` closes that window.
   */
  async update(
    projectId: string,
    mutator: (current: ProjectRecord) => ProjectRecord | void | false | Promise<ProjectRecord | void | false>,
    opts?: { phase?: string; persistFiles?: boolean } & WriteOpts,
  ): Promise<ProjectRecord | null> {
    const phase = opts?.phase ?? 'update';
    const metaPath = join(this.baseDir, projectId, 'project.json');
    if (!existsSync(metaPath)) {
      this.logger.warn(`update(${projectId}): project.json missing — skipping`, {
        event: 'project-store:update-missing', projectId, phase,
      });
      return null;
    }
    let diff: MutationDiff = { fields: {}, stateVersion: 0 };
    const result = await this.withProjectLock(projectId, async () => {
      const raw = await readFile(metaPath, 'utf-8');
      let current: ProjectRecord;
      try {
        current = JSON.parse(raw) as ProjectRecord;
      } catch (err) {
        this.logger.error('update: project.json malformed', {
          event: 'project-store:update-malformed',
          projectId, phase, error: (err as Error).message,
        });
        throw err;
      }
      // Snapshot before mutator so the stale-write detector can compare.
      const beforeJson = JSON.stringify(current);
      const before = JSON.parse(beforeJson) as ProjectRecord;
      const mutated = await mutator(current);
      if (mutated === false) {
        // Mutator opted out — no write.
        return current;
      }
      const next = (mutated as ProjectRecord | void) ?? current;
      diff = this.applyStateGuards(before, next, opts ?? {});
      // Files tree is expensive to re-emit and most update() callers
      // are touching metadata only (status / validation results /
      // warnings). Default = metadata-only write. Callers that change
      // the file set should pass persistFiles: true so save()'s full
      // pipeline (including the rm -rf of the previous output/ tree)
      // runs.
      if (opts?.persistFiles) {
        // Direct save (already takes the lock — but reentrancy on the
        // same projectId would deadlock, so we inline its body here).
        if (!next.version) next.version = 1;
        if (!next.versionHistory) next.versionHistory = [];
        const dir = join(this.baseDir, next.id);
        await mkdir(dir, { recursive: true });
        await this.atomicWriteJson(join(dir, 'project.json'), next, { projectId, phase, backup: true });
        if (next.files.length > 0) {
          const outputDir = join(dir, 'output');
          if (existsSync(outputDir)) await rm(outputDir, { recursive: true, force: true });
          await mkdir(outputDir, { recursive: true });
          for (const file of next.files) {
            if (typeof file.content !== 'string') {
              throw new Error(
                `update(${projectId}): file "${file.path}" has non-string content (typeof=${typeof file.content}).`,
              );
            }
            const filePath = join(outputDir, file.path);
            await mkdir(dirname(filePath), { recursive: true });
            await writeFile(filePath, file.content, 'utf-8');
          }
        }
      } else {
        await this.atomicWriteJson(metaPath, next, { projectId, phase, backup: true });
      }
      return next;
    }, phase);

    await this.appendMutationLog(projectId, {
      ts: new Date().toISOString(),
      projectId,
      caller: opts?.caller ?? phase,
      reason: opts?.reason ?? '',
      op: 'update',
      stateVersion: diff.stateVersion,
      fields: diff.fields,
    });

    return result;
  }

  /**
   * Lightweight metadata-only update: rewrites project.json without
   * touching files on disk. Used by the PreviewManager to mirror its
   * state machine onto ProjectRecord.preview without paying the cost of
   * re-emitting the entire output/ tree.
   *
   * Best-effort: silently no-ops if the project.json is missing (e.g.
   * the project was deleted mid-flight).
   */
  async updatePreview(
    projectId: string,
    patch: NonNullable<ProjectRecord['preview']>,
    opts: WriteOpts = {},
  ): Promise<{
    ok: boolean;
    prevPreviewStatus: string | null;
    nextPreviewStatus: string | null;
    stateVersion: number;
    error?: string;
  }> {
    const metaPath = join(this.baseDir, projectId, 'project.json');
    if (!existsSync(metaPath)) {
      return { ok: false, prevPreviewStatus: null, nextPreviewStatus: null, stateVersion: 0, error: 'project.json missing' };
    }
    // Read-modify-write MUST be atomic w.r.t. save() and any other
    // updatePreview(). Without the lock two concurrent preview
    // transitions could each read the same baseline, apply different
    // patches, then race their atomic renames — the loser's payload
    // overwrites the winner's. The per-project lock serialises both.
    let prevPreviewStatus: string | null = null;
    let nextPreviewStatus: string | null = null;
    let stateVersion = 0;
    let writeError: string | undefined;
    await this.withProjectLock(projectId, async () => {
      try {
        const raw = await readFile(metaPath, 'utf-8');
        const project = JSON.parse(raw) as ProjectRecord;
        prevPreviewStatus = project.preview?.previewStatus ?? null;
        project.preview = { ...(project.preview ?? {}), ...patch };
        nextPreviewStatus = project.preview?.previewStatus ?? null;
        // Bump monotonic counters. updatePreview() is the LEGITIMATE
        // owner of the preview block so it bypasses preview-rebase /
        // status-downgrade guards (those guards exist to protect
        // preview/status FROM other writers).
        project.stateVersion = (project.stateVersion ?? 0) + 1;
        project.updatedAt = new Date().toISOString();
        stateVersion = project.stateVersion;
        await this.atomicWriteJson(metaPath, project, {
          projectId,
          phase: 'updatePreview',
          backup: true,
        });
      } catch (err) {
        writeError = (err as Error).message;
        this.logger.error('updatePreview: write failed — preview state may be stale', {
          event: 'project-store:update-preview-failed',
          projectId,
          error: writeError,
          attemptedPreviewStatus: patch.previewStatus ?? null,
        });
      }
    }, 'updatePreview');

    if (!writeError && prevPreviewStatus !== nextPreviewStatus) {
      await this.appendMutationLog(projectId, {
        ts: new Date().toISOString(),
        projectId,
        caller: opts.caller ?? 'preview-manager',
        reason: opts.reason ?? '',
        op: 'updatePreview',
        stateVersion,
        fields: {
          'preview.previewStatus': { prev: prevPreviewStatus, next: nextPreviewStatus },
        },
      });
    }

    return {
      ok: !writeError,
      prevPreviewStatus,
      nextPreviewStatus,
      stateVersion,
      error: writeError,
    };
  }

  /** List all projects (metadata only, no file contents) */
  async list(): Promise<Omit<ProjectRecord, 'files'>[]> {
    if (!existsSync(this.baseDir)) return [];

    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const projects: Omit<ProjectRecord, 'files'>[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(this.baseDir, entry.name, 'project.json');
      if (!existsSync(metaPath)) continue;

      try {
        const raw = await readFile(metaPath, 'utf-8');
        const project = JSON.parse(raw) as ProjectRecord;
        const { files: _, ...meta } = project;
        projects.push(meta);
      } catch {
        this.logger.warn(`Failed to read project ${entry.name}`);
      }
    }

    return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Delete a project. Acquires the per-project lock so an in-flight
   *  save()/updatePreview() cannot land on the directory after we've
   *  removed it (which would leave an orphan tmp file or recreate the
   *  project tree partially). */
  async delete(projectId: string): Promise<boolean> {
    const dir = join(this.baseDir, projectId);
    if (!existsSync(dir)) return false;
    return this.withProjectLock(projectId, async () => {
      if (!existsSync(dir)) return false;
      await rm(dir, { recursive: true, force: true });
      return true;
    }, 'delete');
  }

  /** Save a full version snapshot to disk. */
  async saveSnapshot(projectId: string, snapshot: ProjectSnapshot): Promise<void> {
    const dir = join(this.baseDir, projectId, 'versions');
    await mkdir(dir, { recursive: true });
    // Snapshots live under the project's directory so we serialise
    // them under the same project lock — keeps version writes
    // ordered relative to project.json updates and prevents a
    // saveSnapshot+save() interleave from corrupting either file.
    await this.withProjectLock(projectId, async () => {
      await this.atomicWriteJson(
        join(dir, `v${snapshot.version}.json`),
        snapshot,
        { projectId, phase: `saveSnapshot:v${snapshot.version}` },
      );
    }, `saveSnapshot:v${snapshot.version}`);
    this.logger.debug(`Saved snapshot v${snapshot.version} for project ${projectId}`);
  }

  /** Load a specific version snapshot by version number. */
  async getSnapshot(projectId: string, version: number): Promise<ProjectSnapshot | null> {
    const snapshotPath = join(this.baseDir, projectId, 'versions', `v${version}.json`);
    if (!existsSync(snapshotPath)) return null;
    const raw = await readFile(snapshotPath, 'utf-8');
    return JSON.parse(raw) as ProjectSnapshot;
  }

  /** List all version snapshot metadata for a project (without loading file contents). */
  async listSnapshots(projectId: string): Promise<{ version: number; path: string }[]> {
    const dir = join(this.baseDir, projectId, 'versions');
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    return entries
      .filter(f => /^v\d+\.json$/.test(f))
      .map(f => ({ version: parseInt(f.slice(1, -5), 10), path: join(dir, f) }))
      .sort((a, b) => a.version - b.version);
  }

  /** Get the output directory path for archiving */
  getOutputDir(projectId: string): string {
    return join(this.baseDir, projectId, 'output');
  }
}
