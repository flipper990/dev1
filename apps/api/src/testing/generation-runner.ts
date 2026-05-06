/**
 * Automated generation testing loop.
 *
 * Runs N project generations sequentially against the running API
 * (http://localhost:3003 by default). For each generation:
 *
 *   1. POST /api/projects/generate          (real pipeline)
 *   2. Poll GET /api/projects/:id           (until status != 'generating')
 *   3. Run REAL execution validation        (npm install + build + dev + HTTP probe)
 *   4. If failed → POST /api/projects/:id/update with error context
 *   5. Wait for the update to finish, re-validate (up to 3 fix iterations)
 *   6. Append the outcome to apps/api/src/testing/results.json
 *
 * Nothing here is simulated. `runExecutionValidation` spawns real
 * `npm install`, `npm run build`, and `npm run dev` against the
 * project's on-disk output directory under data/projects/<id>/output.
 *
 * Usage:
 *   npm run test:generations                # default 10 runs
 *   COUNT=3 npm run test:generations        # override count
 *   API_URL=http://host:3003 npm run …      # override API base
 */

import { mkdir, readFile, writeFile, stat, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runExecutionValidation,
  type ExecutionValidationResult,
} from '../pipeline/execution-runner.js';
import { detectDevOverlay } from '../preview/preview-content-health.js';

// ─────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────

const API_URL = process.env.API_URL ?? 'http://localhost:3003';
const RUN_COUNT = Number.parseInt(process.env.COUNT ?? '10', 10);

// Adaptive per-generation timeout: timeout = base + (sliceCount * 60s).
// `sliceCount` is observed from the live project record once spec is done;
// until then we use the base. The hard cap is recomputed on every poll as
// soon as `plan.featureSlices` becomes visible.
const BASE_GENERATION_TIMEOUT_MS = 5 * 60 * 1000;       // 5 min floor
const PER_SLICE_TIMEOUT_MS       = 60 * 1000;            // +60s per slice
const MAX_GENERATION_TIMEOUT_MS  = 30 * 60 * 1000;       // absolute ceiling
// Back-compat alias: a few helpers still reference this constant.
const PER_GENERATION_TIMEOUT_MS  = MAX_GENERATION_TIMEOUT_MS;

// Progress watchdog: abort early if no observable progress for this long.
const NO_PROGRESS_ABORT_MS = 120_000; // 2 min

// Spec-phase watchdog: if the spec phase hasn't even *started* within this
// window from the runner being kicked off, fail with a precise message
// rather than a generic no-progress timeout. Generation-runner observes
// progress.phase — 'init' means the runner hasn't entered spec yet.
const SPEC_NEVER_STARTED_MS = 60_000; // 1 min

// QA-loop watchdog: abort if QA iteration counter keeps rising past this cap.
const MAX_QA_ITERATIONS = 6;

const POLL_INTERVAL_MS = 3_000;
const MAX_FIX_ATTEMPTS = 3;

// ── Preview-readiness gate ─────────────────────────────────
// After the generation pipeline reports 'completed', we still must
// confirm the preview backend can actually install + build + serve the
// generated app. The full install/build/dev pipeline can run for over
// a minute on cold caches; cap the wait at 180s per the platform spec
// and treat anything past that as a hard TIMEOUT terminal condition.
const PREVIEW_READY_TIMEOUT_MS = 180_000;
const PREVIEW_POLL_INTERVAL_MS = 2_000;

// Rate-limit / budget protection.
// Strict sequential: only one generation may run at a time. The main loop is
// already a serial `for await`, but we also document the invariant here.
const MAX_CONCURRENT_GENERATIONS = 1; // never run two in parallel
const INTER_GENERATION_DELAY_MS = Number.parseInt(
  process.env.INTER_GENERATION_DELAY_MS ?? '30000',
  10,
); // 30s pause between generations to avoid provider rate limits
const MAX_TOTAL_COST_USD = Number.parseFloat(process.env.MAX_TOTAL_COST_USD ?? '50');

// 429 retry schedule: 5s → 10s → 20s → 40s, max 3 retries (4 attempts total).
const RATE_LIMIT_BACKOFF_MS: readonly number[] = [5_000, 10_000, 20_000, 40_000];
const MAX_RATE_LIMIT_RETRIES = 3;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..');
const RESULTS_PATH = join(__dirname, 'results.json');
const LOCK_PATH = join(__dirname, '.generation-runner.lock');
const DATA_PROJECTS_DIR = join(REPO_ROOT, 'data', 'projects');

// ─────────────────────────────────────────────────────────────
// Test prompts (10 distinct realistic projects)
// ─────────────────────────────────────────────────────────────

const TEST_PROMPTS: string[] = [
  'Build a counter app with increment, decrement, and reset buttons. Persist the count to localStorage.',
  'Build a markdown notes app where users can create, edit, and delete notes. Show a live preview of the rendered markdown.',
  'Build a recipe cookbook app that lists recipes with title, ingredients, and steps. Allow searching by name.',
  'Build a simple to-do list app with add, complete, and delete actions. Include a filter for active/completed tasks.',
  'Build a weather dashboard that shows current temperature and a 5-day forecast for a city the user enters.',
  'Build a personal finance tracker with categories, monthly summaries, and a chart of spending by category.',
  'Build a flashcard study app where users create decks of cards and flip through them in study mode.',
  'Build a habit tracker that records daily check-ins for up to 5 habits and shows a 30-day streak grid.',
  'Build a Pomodoro timer with 25/5 cycles, audible notifications, and a daily completed-cycles counter.',
  'Build a URL shortener that generates short codes for long URLs and lists recent shortenings.',
];

function getTestPrompt(i: number): string {
  return TEST_PROMPTS[i % TEST_PROMPTS.length] ?? TEST_PROMPTS[0]!;
}

// ─────────────────────────────────────────────────────────────
// Result schema
// ─────────────────────────────────────────────────────────────

interface AttemptLog {
  iteration: number;            // 0 = initial gen, 1..N = post-fix re-validation
  success: boolean;
  buildErrors: string[];
  runtimeErrors: string[];
  failedSteps: string[];
  failureReasons: string[];
  httpStatus: number | null;
  bodyBytes: number | null;
  durationMs: number;
}

interface GenerationResult {
  index: number;
  projectId: string | null;
  prompt: string;
  startedAt: string;
  completedAt: string;
  totalDurationMs: number;
  status:
    | 'pass'
    | 'fail-validation'
    | 'fail-generation-timeout'
    | 'fail-generation-error'
    | 'fail-generation-no-progress'
    | 'fail-generation-spec-never-started'
    | 'fail-generation-qa-stuck'
    | 'fail-update-timeout'
    | 'fail-update-error'
    | 'fail-update-no-progress'
    | 'fail-update-spec-never-started'
    | 'fail-update-qa-stuck'
    | 'fail-runtime'
    | 'fail-preview-failed'
    | 'fail-preview-timeout'
    | 'fail-preview-overlay'
    | 'fail-metadata-corruption';
  fixAttempts: number;
  attempts: AttemptLog[];
  finalError?: string;
  /** Preview-readiness gate result. Populated whenever generation reached
   *  'completed' (the gate is skipped for projects that never completed). */
  preview?: PreviewOutcome;
  /** QA-side preview content-health gate. Runs AFTER the preview reaches
   *  `ready` and re-fetches the preview proxy URL to scan the rendered
   *  HTML for dev-error-overlay markers ("Module not found", "Build
   *  Error", "Unhandled Runtime Error", "Cannot resolve", Next.js
   *  overlay sentinels). A pass means the generated app boots AND
   *  serves a healthy first response. A fail flips run status to
   *  `fail-preview-overlay` regardless of the upstream pipeline's
   *  `previewStatus: 'ready'` verdict — the diagnostic gate is
   *  intentionally redundant with the manager-side content health
   *  probe so a single regression in either layer can't mask the
   *  other. */
  previewContentHealth?: PreviewContentHealthResult;
  /** Project-record integrity gate result. Populated whenever the
   *  preview gate finished with `ready` (or `no-backend` — the record
   *  must still be readable even when no preview backend is available).
   *  Three sequential GET /api/projects/:id calls must all return 200,
   *  parseable JSON, with readable `status` and `preview` fields. Any
   *  failure flips the run status to `fail-metadata-corruption`. */
  recordIntegrity?: RecordIntegrityResult;
  /** Diagnostic block extracted from project.failure (if persisted by the
   *  API). Populated whenever the project ended in `status: 'failed'`. */
  diagnostics?: {
    failedPhase: string;
    lastSuccessfulPhase?: string;
    errorName: string;
    errorMessage: string;
    stack?: string;
    failedAt: string;
    /** Number of LLM calls observed before the crash. 0 = failure happened
     *  before any LLM invocation (config / setup problem). */
    llmCallCount: number;
    /** Whether ANY LLM call was made during this generation. */
    anyLlmCallMade: boolean;
  };
}

interface ResultsFile {
  schemaVersion: 1;
  startedAt: string;
  completedAt: string | null;
  apiUrl: string;
  count: number;
  results: GenerationResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    averageFixAttempts: number;
    failureBreakdown: Record<string, number>;
    /** Preview-readiness gate aggregate. Counts every run that REACHED the
     *  preview gate (i.e. generation completed). Runs that failed before
     *  the gate are excluded from the denominator so the percentage isn't
     *  diluted by upstream failures. */
    preview: {
      attempted: number;
      ready: number;
      failed: number;
      timedOut: number;
      noBackend: number;
      averageReadyMs: number | null;
      maxReadyMs: number | null;
      minReadyMs: number | null;
    };
    /** Project-record integrity gate aggregate. Counts only runs that
     *  REACHED the integrity gate (i.e. preview ended ready/no-backend).
     *  `failed` here means the run was marked
     *  `fail-metadata-corruption`. */
    recordIntegrity: {
      attempted: number;
      passed: number;
      failed: number;
    };
    /** QA-side preview content-health gate aggregate. Denominator is
     *  the count of runs whose preview gate concluded `ready` (the
     *  only outcome that triggers a content-health probe). `failed`
     *  here is the count of runs marked `fail-preview-overlay`. */
    previewContentHealth: {
      attempted: number;
      passed: number;
      failed: number;
      /** Breakdown of `failureReason` across the failed runs.
       *  Keys are the `PreviewContentHealthResult.failureReason` enum. */
      failureBreakdown: Record<string, number>;
    };
  } | null;
}

// ─────────────────────────────────────────────────────────────
// Tiny logger (so the CLI output is readable)
// ─────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toISOString().slice(11, 19);
}
const log = {
  info: (m: string) => console.log(`[${ts()}] ${m}`),
  warn: (m: string) => console.warn(`[${ts()}] WARN  ${m}`),
  error: (m: string) => console.error(`[${ts()}] ERROR ${m}`),
};

// ─────────────────────────────────────────────────────────────
// HTTP helper
// ─────────────────────────────────────────────────────────────

async function http<T = unknown>(
  method: 'GET' | 'POST' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<{ status: number; body: T | null; raw: string }> {
  // Retry on HTTP 429 with exponential backoff (5s → 10s → 20s → 40s).
  // Honours `Retry-After` header when present (seconds or HTTP-date).
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await fetch(`${API_URL}${path}`, {
      method,
      headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const raw = await res.text();

    if (res.status === 429 && attempt < MAX_RATE_LIMIT_RETRIES) {
      const retryAfterHeader = res.headers.get('retry-after');
      const headerMs = parseRetryAfter(retryAfterHeader);
      const backoffMs = headerMs ?? RATE_LIMIT_BACKOFF_MS[attempt] ?? 40_000;
      log.warn(
        `429 from ${method} ${path} — retry ${attempt + 1}/${MAX_RATE_LIMIT_RETRIES} in ${(backoffMs / 1000).toFixed(1)}s`,
      );
      await sleep(backoffMs);
      attempt++;
      continue;
    }

    let parsed: T | null = null;
    if (raw.length > 0) {
      try {
        parsed = JSON.parse(raw) as T;
      } catch {
        parsed = null;
      }
    }
    return { status: res.status, body: parsed, raw };
  }
}

function parseRetryAfter(value: string | null): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = Date.parse(value);
  if (Number.isFinite(date)) {
    const delta = date - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// Lock file (prevents parallel runs)
// ─────────────────────────────────────────────────────────────

async function acquireLock(): Promise<void> {
  await mkdir(__dirname, { recursive: true });
  if (existsSync(LOCK_PATH)) {
    const content = await readFile(LOCK_PATH, 'utf8').catch(() => '');
    let stale = false;
    try {
      const parsed = JSON.parse(content) as { pid?: number; startedAt?: string };
      if (parsed.pid && parsed.pid !== process.pid) {
        try {
          // Signal 0 just probes whether the PID exists. ESRCH = stale.
          process.kill(parsed.pid, 0);
        } catch {
          stale = true;
        }
      }
    } catch {
      stale = true;
    }
    if (!stale) {
      throw new Error(
        `Another generation-runner is already running (lock=${LOCK_PATH}, content=${content.slice(0, 200)}). ` +
          `Delete the lock file if you are sure no other run is active.`,
      );
    }
    log.warn(`Removing stale lock at ${LOCK_PATH}`);
    await rm(LOCK_PATH, { force: true });
  }
  await writeFile(
    LOCK_PATH,
    JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

async function releaseLock(): Promise<void> {
  await rm(LOCK_PATH, { force: true }).catch(() => undefined);
}

// ─────────────────────────────────────────────────────────────
// API helpers (real endpoints, no simulation)
// ─────────────────────────────────────────────────────────────

interface CreatedProject {
  projectId: string;
  sessionId: string;
}

async function createProject(prompt: string): Promise<CreatedProject> {
  const res = await http<{ projectId: string; sessionId: string }>(
    'POST',
    '/api/projects/generate',
    { prompts: [prompt] },
  );
  if (res.status !== 202 || !res.body?.projectId) {
    throw new Error(`createProject failed: status=${res.status} body=${res.raw.slice(0, 400)}`);
  }
  return { projectId: res.body.projectId, sessionId: res.body.sessionId };
}

interface ProjectRecordLite {
  id: string;
  status: 'generating' | 'completed' | 'failed' | string;
  error?: string;
  files?: Array<{ path: string; content: string }>;
  totalCostUsd?: number;
  totalTokens?: number;
  // Used for adaptive-timeout + progress detection.
  plan?: { featureSlices?: unknown[] } & Record<string, unknown>;
  spec?: { featureSlices?: unknown[] } & Record<string, unknown>;
  tasks?: unknown[];
  optimization?: { qaIterations?: number } & Record<string, unknown>;
  /** Live heartbeat emitted by ProjectGenerator.markProgress(). Authoritative
   * signal for the watchdog — falls back to file/task counts when absent. */
  progress?: {
    phase: string;
    lastProgressAt: string;
    startedAt: string;
    lastMeaningfulStep: string;
    llmCallCount: number;
    filesWrittenCount: number;
    slicesPlannedCount: number;
    stepStartedAt?: string;
    stepCompletedAt?: string;
    stepDurationMs?: number;
    previousStep?: string;
  };
  failure?: {
    failedPhase: string;
    errorName: string;
    errorMessage: string;
    stack?: string;
    failedAt: string;
    lastSuccessfulPhase?: string;
    llmCallCount?: number;
  };
  /** Mirrors GeneratedProject.preview from packages/types. Persisted by
   *  PreviewManager on every state transition. Independent of `status`. */
  preview?: {
    previewStatus: 'idle' | 'preparing' | 'installing' | 'building' | 'starting' | 'ready' | 'failed';
    previewReady: boolean;
    previewUrl?: string | null;
    previewStartedAt?: string | null;
    previewReadyAt?: string | null;
    previewError?: string | null;
    /** Set by PreviewManager when the readiness gate detected a dev
     *  server overlay/error page (Module not found, Build Error, …).
     *  Distinct from `previewError` because it carries the structured
     *  category + module so the postmortem can render a focused
     *  failure card. */
    overlayDetection?: {
      detectedErrorType: string;
      detectedErrorMessage: string;
      affectedModule?: string;
      detectedAt?: string;
    } | null;
    /** Auto-fixes applied by the dependency-preflight gate — missing
     *  package.json entries inferred from import statements. */
    dependencyFixes?: Array<{
      packageName: string;
      version: string;
      reason: string;
      requiredBy: string[];
      packageJson: string;
      block: 'dependencies' | 'devDependencies';
      fixedAt: string;
    }> | null;
    timeline?: Array<{
      event: string;
      at: string;
      previewStatus: string;
      durationMs?: number;
      details?: Record<string, unknown>;
    }>;
  };
}

/** Live snapshot returned by GET /api/projects/:id/preview/status. The
 *  state vocabulary here is the PreviewManager runtime alphabet (slightly
 *  wider than the persisted `previewStatus` — adds 'detecting', 'fallback',
 *  'stopped'). We map both into a single terminal answer in waitForPreview. */
interface PreviewStatusEndpoint {
  projectId: string;
  state:
    | 'idle' | 'preparing' | 'detecting' | 'installing' | 'building'
    | 'starting' | 'ready' | 'failed' | 'fallback' | 'stopped';
  url: string | null;
  hostPort: number | null;
  error: string | null;
  uptimeMs?: number;
  fallback?: boolean;
  fallbackReason?: string | null;
  /** Mirrors PreviewRecord.overlayDetection — set when readiness was
   *  rejected because the rendered HTML carried a dev overlay. */
  overlayDetection?: {
    detectedErrorType: string;
    detectedErrorMessage: string;
    affectedModule?: string;
    detectedAt?: string;
  } | null;
  /** Mirrors PreviewRecord.dependencyFixes. */
  dependencyFixes?: Array<{
    packageName: string;
    version: string;
    reason: string;
    requiredBy: string[];
    packageJson: string;
    block: 'dependencies' | 'devDependencies';
    fixedAt: string;
  }> | null;
}

/** One sample of the project-record integrity probe. Three of these
 *  are taken back-to-back after the preview gate passes. */
interface RecordIntegrityProbe {
  /** 1-based index (1, 2, 3). */
  attempt: number;
  /** ISO timestamp at which this probe was issued. */
  startedAt: string;
  /** Wall-clock duration of the GET. */
  durationMs: number;
  /** HTTP status code observed. `null` only if the transport itself
   *  threw before a response arrived. */
  httpStatus: number | null;
  /** Whether the response body parsed as JSON. */
  parsed: boolean;
  /** Whether `body.status` was a non-empty string. */
  statusReadable: boolean;
  /** Whether `body.preview` was either absent (acceptable) or an
   *  object (acceptable). A non-object/non-undefined value flags as
   *  unreadable. The `previewStatus` sub-field, when present, must
   *  also be a string. */
  previewReadable: boolean;
  /** Verbatim copy of `body.code` when the API returned a structured
   *  500. Lets the corruption code (`PROJECT_RECORD_CORRUPT`) flow up
   *  into the result file. */
  errorCode: string | null;
  /** First-200-chars of the raw response body when the probe failed.
   *  Helpful for postmortem when JSON parsing/structure check fails. */
  rawSample: string | null;
  /** Whether this probe satisfied ALL of: status 2xx, parsed, status
   *  readable, preview readable. */
  ok: boolean;
  /** Short reason string when `ok` is false. */
  failureReason: string | null;
}

/** Final integrity-gate verdict attached to GenerationResult. */
interface RecordIntegrityResult {
  /** `pass` only when ALL three probes were `ok`. Otherwise `fail`. */
  outcome: 'pass' | 'fail';
  /** Total wall clock for the three probes plus inter-probe delays. */
  durationMs: number;
  /** All three samples, in order. Always length 3. */
  probes: RecordIntegrityProbe[];
  /** Convenience: count of probes whose `ok` was true. */
  okCount: number;
  /** Aggregate failure reason — first non-null `failureReason` from the
   *  probes. `null` when outcome === 'pass'. */
  reason: string | null;
  /** First non-null `errorCode` from the probes (typically
   *  `PROJECT_RECORD_CORRUPT`). */
  errorCode: string | null;
}

/** Final preview-validation outcome attached to GenerationResult. */
interface PreviewOutcome {
  outcome: 'ready' | 'failed' | 'timeout' | 'no-backend';
  durationMs: number;
  /** Persisted `previewStatus` at the moment the gate concluded. */
  previewStatus: string;
  previewUrl: string | null;
  previewError: string | null;
  previewStartedAt: string | null;
  previewReadyAt: string | null;
  /** Wall-clock observed by the runner when state first became 'failed'. */
  previewFailedAt: string | null;
  /** Number of distinct preview state transitions seen during the wait. */
  transitionsObserved: number;
  /** Mirrored from PreviewStatus.overlayDetection — set when the gate
   *  failed because the rendered HTML carried a dev overlay. Lets the
   *  failure summary show "Module not found: 'class-variance-authority'"
   *  instead of the generic composed error. */
  overlayDetection?: {
    detectedErrorType: string;
    detectedErrorMessage: string;
    affectedModule?: string;
  } | null;
  /** Mirrored from PreviewStatus.dependencyFixes — surfaces the
   *  packages the preflight gate auto-added (e.g. class-variance-
   *  authority, @radix-ui/*) so the postmortem and dashboard can
   *  show "auto-fixed N dependencies" with the per-package
   *  importedBy[] breakdown. Empty / absent when the codebase was
   *  already self-consistent. */
  dependencyFixes?: Array<{
    packageName: string;
    version: string;
    requiredBy: string[];
    block: 'dependencies' | 'devDependencies';
  }> | null;
}

/**
 * QA-side content-health gate result. Always populated when the preview
 * gate concludes with `outcome: 'ready'`. The gate fetches the preview
 * proxy URL through the API (`GET ${API_URL}/preview/${projectId}/`),
 * caps the body at 256 KB, and runs the SAME `detectDevOverlay` scanner
 * the live preview manager uses — so the diagnostic verdict cannot
 * disagree with the runtime verdict on the patterns themselves, only
 * on the moment-in-time at which they were observed.
 *
 * `verdict: 'pass'` requires:
 *   • HTTP status 200-399 from the proxy (no transport / 5xx).
 *   • No dev-overlay sentinel match (Module not found / Build Error /
 *     Unhandled Runtime Error / Cannot resolve / Next.js overlay anchor).
 *
 * Anything else is `'fail'` with `failureReason` populated. Skipped
 * with `verdict: 'skipped'` when the preview gate never reached `ready`
 * (no-backend / failed / timeout) — the parent run status already
 * captures those cases.
 */
interface PreviewContentHealthResult {
  /** `'pass'` only when the proxy responded healthily AND no overlay
   *  sentinel matched. `'skipped'` when the preview gate didn't reach
   *  `ready`. */
  verdict: 'pass' | 'fail' | 'skipped';
  /** Wall-clock duration of the gate (fetch + scan). 0 when skipped. */
  durationMs: number;
  /** Preview URL the gate fetched (relative). Always set unless skipped. */
  previewUrl: string | null;
  /** HTTP status returned by the proxy. `null` when transport failed. */
  httpStatus: number | null;
  /** Body size (bytes) the gate examined. Capped at 256 KB. */
  bodyBytes: number;
  /** Categorical reason `verdict === 'fail'`. Mirrors the
   *  `detectedErrorType` enum from preview-content-health for overlay
   *  matches; uses `transport-failed` / `http-${status}` for transport
   *  / status failures. */
  failureReason?:
    | 'module-not-found'
    | 'cannot-resolve'
    | 'build-error'
    | 'unhandled-runtime-error'
    | 'application-error'
    | 'hydration-failed'
    | 'chunk-load-error'
    | 'nextjs-dev-overlay'
    | 'transport-failed'
    | 'transport-timeout'
    | 'http-status'
    | 'preview-not-ready';
  /** Headline message extracted from the overlay match (when applicable),
   *  capped at ~240 chars. Empty string when the failure was non-overlay
   *  (transport / status). */
  failureMessage?: string;
  /** Module specifier extracted from "Module not found: 'X'" / "Can't
   *  resolve 'X'" patterns when present. Absent for non-resolve
   *  overlays and non-overlay failures. */
  affectedModule?: string;
  /** First 2 KB of the response body — surfaced in the postmortem
   *  dump for human triage. Always set when a fetch returned bytes. */
  bodySample?: string;
}

function extractSliceCount(p: ProjectRecordLite | null): number | null {
  if (!p) return null;
  const fromPlan = Array.isArray(p.plan?.featureSlices) ? p.plan!.featureSlices!.length : 0;
  const fromSpec = Array.isArray(p.spec?.featureSlices) ? p.spec!.featureSlices!.length : 0;
  const n = Math.max(fromPlan, fromSpec);
  return n > 0 ? n : null;
}

function adaptiveTimeoutMs(sliceCount: number | null): number {
  const slices = sliceCount ?? 0;
  const computed = BASE_GENERATION_TIMEOUT_MS + slices * PER_SLICE_TIMEOUT_MS;
  return Math.min(MAX_GENERATION_TIMEOUT_MS, Math.max(BASE_GENERATION_TIMEOUT_MS, computed));
}

/** Snapshot of observable progress signals — used to detect stalls.
 *
 * The authoritative signal is `progress.lastProgressAt` written by
 * ProjectGenerator.markProgress(). When that's present we ignore the
 * legacy file/task/qa fingerprint entirely — a brand-new project with
 * files=0/slices=0 is NOT "stuck" if its heartbeat updated in the last
 * NO_PROGRESS_ABORT_MS window. */
function progressFingerprint(p: ProjectRecordLite | null): string {
  if (!p) return 'none';
  if (p.progress) {
    return [
      `status=${p.status}`,
      `phase=${p.progress.phase}`,
      `step=${p.progress.lastMeaningfulStep}`,
      `llm=${p.progress.llmCallCount}`,
      `files=${p.progress.filesWrittenCount}`,
      `slices=${p.progress.slicesPlannedCount}`,
      // Include stepStartedAt so a long-running substep that doesn't
      // change `lastMeaningfulStep` STILL changes the fingerprint when
      // the helper rewrites stepStartedAt (it doesn't — it's sticky
      // until the step name changes — but completion does change
      // stepCompletedAt + stepDurationMs, which DO move the fingerprint
      // and reset the no-progress watchdog).
      `stepStarted=${p.progress.stepStartedAt ?? '-'}`,
      `stepCompleted=${p.progress.stepCompletedAt ?? '-'}`,
    ].join('|');
  }
  // Fallback when no heartbeat field is present (older records).
  const fileCount = Array.isArray(p.files) ? p.files.length : 0;
  const taskCount = Array.isArray(p.tasks) ? p.tasks.length : 0;
  const qa = p.optimization?.qaIterations ?? 0;
  const slices = extractSliceCount(p) ?? 0;
  return `${p.status}|files=${fileCount}|tasks=${taskCount}|qa=${qa}|slices=${slices}`;
}

async function getProject(id: string): Promise<ProjectRecordLite | null> {
  const res = await http<ProjectRecordLite>('GET', `/api/projects/${id}`);
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.body) {
    throw new Error(`getProject(${id}) failed: status=${res.status} body=${res.raw.slice(0, 400)}`);
  }
  return res.body;
}

/** Fetch the live PreviewManager status for a project. Returns null on
 *  404 (the manager has no record yet — equivalent to 'idle'). The
 *  endpoint NEVER throws on missing-record (it returns synthetic 'idle'
 *  or 'fallback'), so the only error path is transport failure. */
async function getPreviewLiveStatus(id: string): Promise<PreviewStatusEndpoint | null> {
  const res = await http<PreviewStatusEndpoint>('GET', `/api/projects/${id}/preview/status`);
  if (res.status === 404) return null;
  if (res.status !== 200 || !res.body) {
    throw new Error(
      `getPreviewLiveStatus(${id}) failed: status=${res.status} body=${res.raw.slice(0, 400)}`,
    );
  }
  return res.body;
}

/**
 * Preview-readiness gate.
 *
 * After project.status === 'completed' the generation pipeline is done,
 * but the preview backend (Docker container or local-runner) still has
 * to install dependencies, build, and serve the app. This function
 * blocks until ONE of three terminal conditions holds:
 *
 *   • SUCCESS  — live state === 'ready' (or persisted previewStatus === 'ready')
 *   • FAIL     — live state === 'failed' (preview backend gave up)
 *   • TIMEOUT  — neither happened within PREVIEW_READY_TIMEOUT_MS
 *
 * The function fires `POST /preview/start` once at the top (fire-and-
 * forget; the route's own await would otherwise block the entire
 * install/build/dev pipeline as a single HTTP call) then polls
 * `/preview/status` every PREVIEW_POLL_INTERVAL_MS. The persisted
 * `project.preview` block is also fetched on every poll so we can
 * surface previewStartedAt / previewReadyAt / previewError exactly as
 * PreviewManager wrote them.
 *
 * No backend available (Docker down + no local runner) → outcome
 * 'no-backend' so the runner can distinguish "preview can't run here"
 * from a real preview failure.
 */
async function waitForPreview(projectId: string): Promise<PreviewOutcome> {
  const t0 = Date.now();
  log.info(`  ↳ preview gate: requesting start (timeout ${PREVIEW_READY_TIMEOUT_MS / 1000}s)`);

  // Fire start in the background. The route awaits PreviewManager.start()
  // which itself drives the full pipeline; if we awaited it here, this
  // single fetch would tie up the polling loop and we'd lose visibility
  // into intermediate states. Errors are logged but not thrown — the
  // poll loop is the source of truth.
  void http('POST', `/api/projects/${projectId}/preview/start`).catch((err) => {
    log.warn(`  ↳ preview/start fetch errored (poll loop will continue): ${(err as Error).message}`);
  });

  let lastState: string | null = null;
  let transitions = 0;
  let firstFailedAt: string | null = null;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const elapsed = Date.now() - t0;

    // Read both the live status and the persisted record. We trust the
    // live status for state transitions and use the persisted record
    // for stable diagnostic timestamps (previewStartedAt / ReadyAt).
    let live: PreviewStatusEndpoint | null = null;
    let persisted: ProjectRecordLite | null = null;
    try {
      live = await getPreviewLiveStatus(projectId);
    } catch (err) {
      log.warn(`  ↳ preview/status fetch failed (will retry): ${(err as Error).message}`);
    }
    try {
      persisted = await getProject(projectId);
    } catch (err) {
      log.warn(`  ↳ project fetch failed during preview gate: ${(err as Error).message}`);
    }

    const liveState = live?.state ?? 'idle';
    const persistedStatus = persisted?.preview?.previewStatus ?? 'idle';

    if (liveState !== lastState) {
      transitions++;
      log.info(
        `  ↳ preview state: ${liveState}` +
          (live?.url ? ` url=${live.url}` : '') +
          (live?.error ? ` err=${live.error.slice(0, 200)}` : '') +
          ` (persisted=${persistedStatus}, +${(elapsed / 1000).toFixed(1)}s)`,
      );
      lastState = liveState;
    }

    // No-backend short-circuit. The preview-status route returns
    // state='fallback' with fallbackReason='docker-unavailable' when
    // neither Docker nor the local runner is available. Treat as a
    // distinct, NON-terminal-fail outcome so a workstation without
    // Docker doesn't poison the failure breakdown.
    if (live?.fallback === true && live.fallbackReason === 'docker-unavailable') {
      log.warn(`  ↳ preview gate: no backend available (${live.fallbackReason})`);
      return {
        outcome: 'no-backend',
        durationMs: Date.now() - t0,
        previewStatus: persistedStatus,
        previewUrl: persisted?.preview?.previewUrl ?? live.url ?? null,
        previewError: persisted?.preview?.previewError ?? live.error ?? null,
        previewStartedAt: persisted?.preview?.previewStartedAt ?? null,
        previewReadyAt: persisted?.preview?.previewReadyAt ?? null,
        previewFailedAt: null,
        transitionsObserved: transitions,
      };
    }

    // SUCCESS: the live preview backend reports 'ready'. We trust the
    // live signal (some PreviewManager paths emit 'ready' before the
    // persistence flush completes).
    if (liveState === 'ready' || persistedStatus === 'ready') {
      const fixes = persisted?.preview?.dependencyFixes ?? live?.dependencyFixes ?? null;
      log.info(
        `  ↳ preview READY in ${((Date.now() - t0) / 1000).toFixed(1)}s ` +
          `(url=${persisted?.preview?.previewUrl ?? live?.url ?? '?'})`,
      );
      if (fixes && fixes.length > 0) {
        log.info(
          `  ↳ preview dep-preflight auto-added ${fixes.length} package(s): ` +
            fixes.slice(0, 6).map((f) => f.packageName).join(', ') +
            (fixes.length > 6 ? `, +${fixes.length - 6} more` : ''),
        );
      }
      return {
        outcome: 'ready',
        durationMs: Date.now() - t0,
        previewStatus: persistedStatus === 'ready' ? 'ready' : liveState,
        previewUrl: persisted?.preview?.previewUrl ?? live?.url ?? null,
        previewError: persisted?.preview?.previewError ?? null,
        previewStartedAt: persisted?.preview?.previewStartedAt ?? null,
        previewReadyAt: persisted?.preview?.previewReadyAt ?? null,
        previewFailedAt: null,
        transitionsObserved: transitions,
        dependencyFixes: fixes
          ? fixes.map((f) => ({
              packageName: f.packageName,
              version: f.version,
              requiredBy: f.requiredBy,
              block: f.block,
            }))
          : null,
      };
    }

    // FAIL: terminal. Capture the wall-clock instant the runner first
    // observed 'failed' (the persisted record has no previewFailedAt
    // field — we synthesise it from the timeline event when present
    // and otherwise from this observation).
    if (liveState === 'failed' || persistedStatus === 'failed') {
      if (firstFailedAt === null) firstFailedAt = new Date().toISOString();
      const timelineFailed = persisted?.preview?.timeline?.find((t) => t.event === 'failed');
      const failedAt = timelineFailed?.at ?? firstFailedAt;
      const errorMsg = persisted?.preview?.previewError ?? live?.error ?? 'preview failed (no error message persisted)';
      const overlay =
        persisted?.preview?.overlayDetection ??
        live?.overlayDetection ??
        null;
      if (overlay) {
        log.error(
          `  ↳ preview FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s — ` +
            `dev overlay detected (${overlay.detectedErrorType})` +
            (overlay.affectedModule ? ` module="${overlay.affectedModule}"` : ''),
        );
        log.error(`  ↳ overlay message: ${overlay.detectedErrorMessage.slice(0, 240)}`);
      } else {
        log.error(
          `  ↳ preview FAILED in ${((Date.now() - t0) / 1000).toFixed(1)}s — ${errorMsg.slice(0, 240)}`,
        );
      }
      return {
        outcome: 'failed',
        durationMs: Date.now() - t0,
        previewStatus: 'failed',
        previewUrl: persisted?.preview?.previewUrl ?? live?.url ?? null,
        previewError: errorMsg,
        previewStartedAt: persisted?.preview?.previewStartedAt ?? null,
        previewReadyAt: persisted?.preview?.previewReadyAt ?? null,
        previewFailedAt: failedAt,
        transitionsObserved: transitions,
        overlayDetection: overlay,
        dependencyFixes: (persisted?.preview?.dependencyFixes ?? live?.dependencyFixes ?? null)?.map((f) => ({
          packageName: f.packageName,
          version: f.version,
          requiredBy: f.requiredBy,
          block: f.block,
        })) ?? null,
      };
    }

    // TIMEOUT.
    if (elapsed >= PREVIEW_READY_TIMEOUT_MS) {
      log.error(
        `  ↳ preview TIMEOUT after ${(elapsed / 1000).toFixed(0)}s ` +
          `(last state=${liveState}, persisted=${persistedStatus})`,
      );
      return {
        outcome: 'timeout',
        durationMs: elapsed,
        previewStatus: persistedStatus,
        previewUrl: persisted?.preview?.previewUrl ?? live?.url ?? null,
        previewError: persisted?.preview?.previewError ?? live?.error ?? null,
        previewStartedAt: persisted?.preview?.previewStartedAt ?? null,
        previewReadyAt: persisted?.preview?.previewReadyAt ?? null,
        previewFailedAt: null,
        transitionsObserved: transitions,
      };
    }

    await sleep(PREVIEW_POLL_INTERVAL_MS);
  }
}

/**
 * QA-side preview content-health gate. Issues a single `GET
 * ${API_URL}/preview/${projectId}/` through the API's preview proxy,
 * caps the response body at 256 KB, and runs `detectDevOverlay`
 * against the bytes. Returns a structured verdict the caller maps to
 * either `pass` or `fail-preview-overlay`.
 *
 * Why a SECOND check after the manager's content-health probe?
 *   • Defence in depth — a single regression in the manager-side
 *     probe (silent skip / incorrect path / timeout) cannot
 *     mask a broken app from the diagnostic run.
 *   • The manager probes the dev-server directly on its host port; the
 *     diagnostic gate goes through the same proxy URL the dashboard
 *     would use, exercising the entire end-to-end path.
 *   • Some dev servers stream the build error overlay only after
 *     the first user-agent GET — running an extra probe here closes
 *     that race.
 *
 * Never throws. Transport / timeout failures are encoded into the
 * verdict so the parent gate can record them in the postmortem.
 */
async function runPreviewContentHealthGate(
  projectId: string,
  previewUrl: string | null,
): Promise<PreviewContentHealthResult> {
  const t0 = Date.now();
  const probePath = previewUrl && previewUrl.length > 0
    ? previewUrl
    : `/preview/${projectId}/`;
  const fullUrl = `${API_URL}${probePath}`;

  // 256 KB cap — same constant as preview-content-health.ts. A
  // misconfigured proxy could otherwise stream an unbounded body.
  const MAX_BODY_BYTES = 256 * 1024;
  const TIMEOUT_MS = 10_000;

  let httpStatus: number | null = null;
  let bodyBytes = 0;
  let bodySample = '';

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(fullUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'devteam-diagnostic-content-health/1.0',
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
        signal: ctl.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    httpStatus = res.status;
    // Read body up to cap. Using arrayBuffer keeps us within memory
    // even when the upstream sets `transfer-encoding: chunked` with no
    // Content-Length.
    const buf = Buffer.from(await res.arrayBuffer());
    bodyBytes = Math.min(buf.length, MAX_BODY_BYTES);
    bodySample = buf.subarray(0, bodyBytes).toString('utf8');
  } catch (err) {
    const e = err as Error & { name?: string };
    const reason: PreviewContentHealthResult['failureReason'] =
      e.name === 'AbortError' ? 'transport-timeout' : 'transport-failed';
    return {
      verdict: 'fail',
      durationMs: Date.now() - t0,
      previewUrl: probePath,
      httpStatus: null,
      bodyBytes: 0,
      failureReason: reason,
      failureMessage: e.message?.slice(0, 240) ?? 'transport error',
    };
  }

  // HTTP-level failure: any 5xx or transport-level non-response is a
  // hard fail. The manager-side probe accepts 200-399; mirror that.
  if (httpStatus < 200 || httpStatus >= 400) {
    return {
      verdict: 'fail',
      durationMs: Date.now() - t0,
      previewUrl: probePath,
      httpStatus,
      bodyBytes,
      failureReason: 'http-status',
      failureMessage: `Preview proxy returned HTTP ${httpStatus}`,
      bodySample: bodySample.slice(0, 2_048),
    };
  }

  // Overlay scan — single source of truth, shared with the runtime
  // probe in preview-content-health.ts.
  const detected = detectDevOverlay(bodySample);
  if (detected) {
    return {
      verdict: 'fail',
      durationMs: Date.now() - t0,
      previewUrl: probePath,
      httpStatus,
      bodyBytes,
      failureReason: detected.detectedErrorType,
      failureMessage: detected.detectedErrorMessage,
      affectedModule: detected.affectedModule,
      bodySample: bodySample.slice(0, 2_048),
    };
  }

  return {
    verdict: 'pass',
    durationMs: Date.now() - t0,
    previewUrl: probePath,
    httpStatus,
    bodyBytes,
    bodySample: bodySample.slice(0, 2_048),
  };
}

// ─────────────────────────────────────────────────────────────
// Resilient polling
// ─────────────────────────────────────────────────────────────
//
// Network blips (TCP reset, ECONNREFUSED during a tsx-watch reload,
// transient 502, slow API GC pause) used to abort the whole
// diagnostic run on the FIRST `fetch failed`. Now we:
//   1. Retry getProject up to MAX_POLL_FETCH_RETRIES with exponential
//      backoff (1s, 2s, 4s, 8s, 15s).
//   2. Between retries, probe /health.
//      • /health OK → keep retrying getProject; the API is alive,
//        the failure was transient or transport-level.
//      • /health fails N times in a row → escalate to "API
//        unavailable" and abort.
//   3. Track the API pid across health probes so we can tell whether
//      a successful retry happened against the SAME process or a
//      restarted one. A pid change indicates tsx-watch reloaded mid
//      generation (separate failure mode from a hang).
// ─────────────────────────────────────────────────────────────

const POLL_FETCH_BACKOFF_MS: readonly number[] = [1_000, 2_000, 4_000, 8_000, 15_000];
const MAX_POLL_FETCH_RETRIES = POLL_FETCH_BACKOFF_MS.length;
const MAX_HEALTH_FAILURES = 3;

interface HealthSnapshot {
  ok: boolean;
  pid: number | null;
  restartCounter: number | null;
  uptime: number | null;
  status: number;
  error?: string;
}

async function getHealth(): Promise<HealthSnapshot> {
  try {
    // Use raw fetch (not http()) so we never trigger 429 retry inside
    // the recovery path itself. Short timeout so a hung event loop is
    // detected as a health failure, not as an indefinite wait.
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5_000);
    let res: Response;
    try {
      res = await fetch(`${API_URL}/health`, { method: 'GET', signal: ctl.signal });
    } finally {
      clearTimeout(timer);
    }
    const raw = await res.text();
    let body: Record<string, unknown> | null = null;
    try { body = raw ? (JSON.parse(raw) as Record<string, unknown>) : null; } catch { /* ignore */ }
    return {
      ok: res.status >= 200 && res.status < 300,
      pid: typeof body?.pid === 'number' ? (body.pid as number) : null,
      restartCounter: typeof body?.restartCounter === 'number' ? (body.restartCounter as number) : null,
      uptime: typeof body?.uptime === 'number' ? (body.uptime as number) : null,
      status: res.status,
    };
  } catch (e) {
    return { ok: false, pid: null, restartCounter: null, uptime: null, status: 0, error: (e as Error).message };
  }
}

interface PollResilienceStats {
  pollFetchFailures: number;
  pollFetchRetries: number;
  healthChecksAttempted: number;
  healthChecksFailed: number;
  healthEverReachable: boolean;
  pidChanges: number;
  restartCounterIncrements: number;
  observedPids: number[];
  observedRestartCounters: number[];
  /** Last error message from getProject, kept for the abort report. */
  lastFetchError: string | null;
  /** Last health probe result. */
  lastHealthSnapshot: HealthSnapshot | null;
}

function makePollStats(): PollResilienceStats {
  return {
    pollFetchFailures: 0,
    pollFetchRetries: 0,
    healthChecksAttempted: 0,
    healthChecksFailed: 0,
    healthEverReachable: false,
    pidChanges: 0,
    restartCounterIncrements: 0,
    observedPids: [],
    observedRestartCounters: [],
    lastFetchError: null,
    lastHealthSnapshot: null,
  };
}

function recordHealthSnapshot(stats: PollResilienceStats, snap: HealthSnapshot): void {
  stats.healthChecksAttempted++;
  stats.lastHealthSnapshot = snap;
  if (!snap.ok) {
    stats.healthChecksFailed++;
    return;
  }
  stats.healthEverReachable = true;
  if (snap.pid != null) {
    if (stats.observedPids.length > 0 && stats.observedPids[stats.observedPids.length - 1] !== snap.pid) {
      stats.pidChanges++;
    }
    if (!stats.observedPids.includes(snap.pid)) {
      stats.observedPids.push(snap.pid);
    }
  }
  if (snap.restartCounter != null) {
    const last = stats.observedRestartCounters[stats.observedRestartCounters.length - 1];
    if (last != null && snap.restartCounter > last) {
      stats.restartCounterIncrements++;
    }
    if (!stats.observedRestartCounters.includes(snap.restartCounter)) {
      stats.observedRestartCounters.push(snap.restartCounter);
    }
  }
}

/**
 * Resilient wrapper around getProject(). Returns the project (or null
 * for 404) on success. On failure, escalates either to a transient
 * retry, a /health-based outage diagnosis, or — only as a last resort —
 * throws an aggregated error that the caller turns into an abort.
 *
 * `consecutiveHealthFailures` is tracked on the stats object across
 * calls so that *sustained* /health unreachability (not a single blip)
 * is the abort criterion.
 */
async function resilientGetProject(
  projectId: string,
  stats: PollResilienceStats,
  consecutiveHealthFailuresRef: { value: number },
): Promise<ProjectRecordLite | null> {
  let lastErr: Error | null = null;
  for (let attempt = 0; attempt <= MAX_POLL_FETCH_RETRIES; attempt++) {
    try {
      const proj = await getProject(projectId);
      // Success — reset the consecutive health-failure counter.
      consecutiveHealthFailuresRef.value = 0;
      return proj;
    } catch (err) {
      lastErr = err as Error;
      stats.pollFetchFailures++;
      stats.lastFetchError = lastErr.message;
      if (attempt >= MAX_POLL_FETCH_RETRIES) break;

      stats.pollFetchRetries++;
      const backoffMs = POLL_FETCH_BACKOFF_MS[attempt] ?? 15_000;
      log.warn(
        `  ⚠ getProject failed (${lastErr.message}) — attempt ${attempt + 1}/${MAX_POLL_FETCH_RETRIES + 1}, ` +
        `retrying in ${(backoffMs / 1000).toFixed(0)}s`,
      );

      // Probe /health. If it answers, the API is alive; the
      // getProject failure was transient — keep retrying. If /health
      // also fails repeatedly, escalate immediately rather than
      // sitting through the full backoff schedule.
      const snap = await getHealth();
      recordHealthSnapshot(stats, snap);
      if (snap.ok) {
        consecutiveHealthFailuresRef.value = 0;
        log.info(
          `    ↳ /health OK (pid=${snap.pid ?? '?'} restart=${snap.restartCounter ?? '?'} ` +
          `uptime=${snap.uptime ?? '?'}s) — API alive, treating as transient`,
        );
      } else {
        consecutiveHealthFailuresRef.value++;
        log.warn(
          `    ↳ /health FAILED (${snap.error ?? `status=${snap.status}`}) — ` +
          `consecutive failures: ${consecutiveHealthFailuresRef.value}/${MAX_HEALTH_FAILURES}`,
        );
        if (consecutiveHealthFailuresRef.value >= MAX_HEALTH_FAILURES) {
          throw new Error(
            `API unavailable: /health failed ${consecutiveHealthFailuresRef.value} consecutive times. ` +
            `Last getProject error: ${lastErr.message}`,
          );
        }
      }

      await sleep(backoffMs);
    }
  }

  throw new Error(
    `getProject exhausted ${MAX_POLL_FETCH_RETRIES + 1} attempts. ` +
    `Last error: ${lastErr?.message ?? 'unknown'}. ` +
    `Health was ${stats.healthEverReachable ? 'reachable' : 'NEVER reachable'} during retries.`,
  );
}

/**
 * Poll the project until status is no longer 'generating'.
 *
 * Implements four abort conditions:
 *   1. Adaptive hard timeout: base 5min + 60s per slice (capped at 30min),
 *      recomputed on every poll once slice count becomes observable.
 *   2. Spec-never-started: if the project's progress.phase stays 'init' for
 *      longer than SPEC_NEVER_STARTED_MS, abort with a precise error.
 *   3. No-progress watchdog: abort if no observable change for 120s
 *      (preferring the heartbeat field when present — a new project with
 *      files=0/slices=0 is NOT stuck if its phase or step is advancing).
 *   4. QA-loop watchdog: abort if `optimization.qaIterations` exceeds the cap.
 *
 * Aborts throw an Error tagged with `code` so callers can classify it.
 */
async function waitForCompletion(
  projectId: string,
  _timeoutMs = MAX_GENERATION_TIMEOUT_MS,
  label = 'generation',
): Promise<ProjectRecordLite> {
  const startedAt = Date.now();
  let lastStatus: string | undefined;
  let lastStep: string | undefined;
  let lastFingerprint = progressFingerprint(null);
  let lastProgressAt = startedAt;
  let sliceCount: number | null = null;
  let currentDeadline = startedAt + adaptiveTimeoutMs(null);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const project = await getProject(projectId);
    if (!project) throw new Error(`waitForCompletion: project ${projectId} not found`);

    // Recompute adaptive deadline as soon as slice count is observable.
    const observed = extractSliceCount(project);
    if (observed !== null && observed !== sliceCount) {
      sliceCount = observed;
      const newTimeout = adaptiveTimeoutMs(sliceCount);
      currentDeadline = startedAt + newTimeout;
      log.info(
        `  ↳ ${label} adaptive timeout → ${(newTimeout / 1000).toFixed(0)}s ` +
          `(base ${BASE_GENERATION_TIMEOUT_MS / 1000}s + ${sliceCount} slice(s) × ${PER_SLICE_TIMEOUT_MS / 1000}s)`,
      );
    }

    if (project.status !== lastStatus) {
      log.info(`  ↳ ${label} status: ${project.status} phase=${project.progress?.phase ?? '?'}`);
      lastStatus = project.status;
    }
    // Substep visibility \u2014 print every time `lastMeaningfulStep` changes
    // so a long finalize:* substep is visible in the poll log even when
    // the high-level status stays 'generating'. Also prints stepDurationMs
    // when the previous substep completed so the slowest substep is
    // immediately obvious in the poll output.
    if (project.progress?.lastMeaningfulStep && project.progress.lastMeaningfulStep !== lastStep) {
      const dur = project.progress.stepDurationMs;
      const prev = project.progress.previousStep;
      const durSuffix = prev && typeof dur === 'number'
        ? ` (prev ${prev} took ${dur}ms)`
        : '';
      log.info(
        `  ↳ ${label} step: ${project.progress.lastMeaningfulStep} ` +
        `(phase=${project.progress.phase}, files=${project.progress.filesWrittenCount})${durSuffix}`,
      );
      lastStep = project.progress.lastMeaningfulStep;
    }
    if (project.status !== 'generating') return project;

    // Spec-never-started watchdog. Only fires while we're still in 'init'
    // phase — once the runner enters 'spec' or beyond, the regular
    // no-progress watchdog takes over.
    const phase = project.progress?.phase ?? 'init';
    const elapsedSinceStart = Date.now() - startedAt;
    if (phase === 'init' && elapsedSinceStart >= SPEC_NEVER_STARTED_MS) {
      throw Object.assign(
        new Error(
          `spec phase never started for ${label} ${projectId} after ${(elapsedSinceStart / 1000).toFixed(0)}s ` +
            `(progress=${JSON.stringify(project.progress ?? null)})`,
        ),
        { code: 'SPEC_NEVER_STARTED' },
      );
    }

    // No-progress watchdog (heartbeat-aware).
    // Authoritative signal: progress.lastProgressAt. We compare against the
    // wall clock so a stale on-disk timestamp is what surfaces a stall.
    const heartbeatAt = project.progress?.lastProgressAt
      ? Date.parse(project.progress.lastProgressAt)
      : NaN;
    let isProgressing = false;
    if (Number.isFinite(heartbeatAt)) {
      isProgressing = Date.now() - heartbeatAt < NO_PROGRESS_ABORT_MS;
    }

    const fingerprint = progressFingerprint(project);
    if (fingerprint !== lastFingerprint) {
      lastFingerprint = fingerprint;
      lastProgressAt = Date.now();
    } else if (!isProgressing && Date.now() - lastProgressAt >= NO_PROGRESS_ABORT_MS) {
      throw Object.assign(
        new Error(
          `No progress in ${(NO_PROGRESS_ABORT_MS / 1000).toFixed(0)}s for ${label} ${projectId} ` +
            `(state=${fingerprint}, heartbeatAge=${
              Number.isFinite(heartbeatAt) ? `${((Date.now() - heartbeatAt) / 1000).toFixed(0)}s` : 'none'
            })`,
        ),
        { code: 'NO_PROGRESS' },
      );
    }

    // QA-loop watchdog.
    const qa = project.optimization?.qaIterations ?? 0;
    if (qa > MAX_QA_ITERATIONS) {
      throw Object.assign(
        new Error(
          `QA loop appears stuck for ${label} ${projectId}: qaIterations=${qa} > cap ${MAX_QA_ITERATIONS}`,
        ),
        { code: 'QA_STUCK' },
      );
    }

    // Adaptive hard timeout.
    if (Date.now() >= currentDeadline) {
      throw Object.assign(
        new Error(
          `Timeout waiting for ${label} of ${projectId} after ${(
            (Date.now() - startedAt) / 1000
          ).toFixed(0)}s ` +
            `(adaptive cap ${(adaptiveTimeoutMs(sliceCount) / 1000).toFixed(0)}s, slices=${sliceCount ?? '?'})`,
        ),
        { code: 'TIMEOUT' },
      );
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

async function waitForUpdate(projectId: string): Promise<ProjectRecordLite> {
  return waitForCompletion(projectId, MAX_GENERATION_TIMEOUT_MS, 'update');
}

/**
 * Trigger an auto-fix update against an existing project, threading
 * the build/runtime errors into the prompt so the agents have a real
 * signal to fix. Uses the canonical /update endpoint.
 */
async function triggerAutoFix(
  projectId: string,
  errors: { buildErrors: string[]; runtimeErrors: string[]; failedSteps: string[]; failureReasons: string[] },
): Promise<void> {
  const buildSlice = errors.buildErrors.slice(0, 8).join('\n');
  const runtimeSlice = errors.runtimeErrors.slice(0, 8).join('\n');
  const stepSlice = errors.failedSteps.join(', ') || 'none';
  const reasonSlice = errors.failureReasons.join(', ') || 'unknown';
  const prompt =
    `The previously generated project failed local execution validation. ` +
    `Fix the issues so the project installs, builds, and serves a non-empty HTML page on '/'.\n\n` +
    `Failure reasons: ${reasonSlice}\n` +
    `Failed steps: ${stepSlice}\n` +
    (buildSlice ? `\nBuild errors (top of output):\n${buildSlice}\n` : '') +
    (runtimeSlice ? `\nRuntime / probe errors:\n${runtimeSlice}\n` : '') +
    `\nDo NOT change unrelated files. Address only the listed errors.`;

  const res = await http<{ projectId: string; sessionId: string }>(
    'POST',
    `/api/projects/${projectId}/update`,
    { prompts: [prompt], scope: 'code' },
  );
  if (res.status !== 202) {
    throw new Error(
      `triggerAutoFix(${projectId}) failed: status=${res.status} body=${res.raw.slice(0, 400)}`,
    );
  }
}

// ─────────────────────────────────────────────────────────────
// Real execution validation
// ─────────────────────────────────────────────────────────────

/**
 * Build → run → HTTP-probe the project's on-disk output directory.
 * Validates the strict pass criteria from the spec:
 *   • install + build + dev all succeed
 *   • HTTP GET '/' returns 200–399
 *   • body contains '<html' or '<body'
 *   • body is not empty (≥ 200 bytes)
 */
async function runValidation(projectId: string): Promise<{
  result: ExecutionValidationResult;
  attempt: AttemptLog;
}> {
  const projectDir = join(DATA_PROJECTS_DIR, projectId, 'output');
  const exists = existsSync(projectDir);
  if (!exists) {
    const attempt: AttemptLog = {
      iteration: 0,
      success: false,
      buildErrors: [`project output directory missing: ${projectDir}`],
      runtimeErrors: [],
      failedSteps: ['install', 'build', 'dev'],
      failureReasons: ['no project output directory'],
      httpStatus: null,
      bodyBytes: null,
      durationMs: 0,
    };
    // Synthesise an empty result so the caller has a consistent shape.
    return {
      result: {
        success: false,
        failureReasons: attempt.failureReasons,
        buildErrors: attempt.buildErrors,
        runtimeErrors: [],
        logs: '',
        steps: [],
        httpProbes: [],
        projectDir,
      },
      attempt,
    };
  }
  const t0 = Date.now();
  const result = await runExecutionValidation({
    projectDir,
    packageManager: 'npm',
    startDevServer: true,
    timeouts: { install: 180_000, build: 120_000, dev: 60_000 },
    httpProbes: {
      routes: ['/'],
      expectStatusRange: [200, 399],
      // Don't pass expectMarkers — the runner falls back to its built-in
      // ANY-of [`<html`, `<body`, `<div`, `<main`] markers, which matches
      // our spec ("contains <html or <body").
      minBodyBytes: 200,
      requestTimeoutMs: 10_000,
    },
    logger: {
      info: () => undefined,
      warn: (m) => log.warn(`    [exec] ${m}`),
      error: (m) => log.error(`    [exec] ${m}`),
    },
  });
  const probe = result.httpProbes[0];
  const failedSteps = result.steps.filter((s) => s.ran && !s.ok).map((s) => s.step);
  const attempt: AttemptLog = {
    iteration: 0,
    success: result.success,
    buildErrors: result.buildErrors.slice(0, 12),
    runtimeErrors: result.runtimeErrors.slice(0, 12),
    failedSteps,
    failureReasons: result.failureReasons.slice(0, 12),
    httpStatus: probe?.status ?? null,
    bodyBytes: probe?.bodyBytes ?? null,
    durationMs: Date.now() - t0,
  };
  return { result, attempt };
}

// ─────────────────────────────────────────────────────────────
// Results persistence
// ─────────────────────────────────────────────────────────────

async function loadOrInitResults(): Promise<ResultsFile> {
  if (existsSync(RESULTS_PATH)) {
    try {
      const raw = await readFile(RESULTS_PATH, 'utf8');
      const parsed = JSON.parse(raw) as ResultsFile;
      if (parsed.schemaVersion === 1) return parsed;
    } catch {
      /* fall through to fresh */
    }
  }
  return {
    schemaVersion: 1,
    startedAt: new Date().toISOString(),
    completedAt: null,
    apiUrl: API_URL,
    count: RUN_COUNT,
    results: [],
    summary: null,
  };
}

async function persistResults(results: ResultsFile): Promise<void> {
  await mkdir(__dirname, { recursive: true });
  await writeFile(RESULTS_PATH, JSON.stringify(results, null, 2), 'utf8');
}

function summarise(results: GenerationResult[]): ResultsFile['summary'] {
  const total = results.length;
  const succeeded = results.filter((r) => r.status === 'pass').length;
  const failed = total - succeeded;
  const totalFixes = results.reduce((sum, r) => sum + r.fixAttempts, 0);
  const breakdown: Record<string, number> = {};
  for (const r of results) breakdown[r.status] = (breakdown[r.status] ?? 0) + 1;

  // Preview gate aggregate. Only runs that REACHED the gate count toward
  // the denominator, so generation-timeouts / generation-errors don't
  // dilute the percentage.
  const previewRuns = results.filter((r) => r.preview);
  const ready = previewRuns.filter((r) => r.preview!.outcome === 'ready');
  const previewFailed = previewRuns.filter((r) => r.preview!.outcome === 'failed').length;
  const previewTimedOut = previewRuns.filter((r) => r.preview!.outcome === 'timeout').length;
  const previewNoBackend = previewRuns.filter((r) => r.preview!.outcome === 'no-backend').length;
  const readyDurations = ready.map((r) => r.preview!.durationMs);
  const averageReadyMs = readyDurations.length === 0
    ? null
    : Math.round(readyDurations.reduce((a, b) => a + b, 0) / readyDurations.length);
  const maxReadyMs = readyDurations.length === 0 ? null : Math.max(...readyDurations);
  const minReadyMs = readyDurations.length === 0 ? null : Math.min(...readyDurations);

  // Record-integrity gate aggregate. Same denominator policy as the
  // preview gate — only count runs that reached the gate.
  const integrityRuns = results.filter((r) => r.recordIntegrity);
  const integrityPassed = integrityRuns.filter((r) => r.recordIntegrity!.outcome === 'pass').length;
  const integrityFailed = integrityRuns.filter((r) => r.recordIntegrity!.outcome === 'fail').length;

  // QA-side content-health gate aggregate. Denominator: only the runs
  // whose preview gate reached 'ready' AND therefore actually produced
  // a content-health verdict (skipped runs don't count toward
  // attempted because there was nothing to probe).
  const contentHealthRuns = results.filter(
    (r) => r.previewContentHealth && r.previewContentHealth.verdict !== 'skipped',
  );
  const contentHealthPassed = contentHealthRuns.filter(
    (r) => r.previewContentHealth!.verdict === 'pass',
  ).length;
  const contentHealthFailed = contentHealthRuns.filter(
    (r) => r.previewContentHealth!.verdict === 'fail',
  ).length;
  const contentHealthBreakdown: Record<string, number> = {};
  for (const r of contentHealthRuns) {
    if (r.previewContentHealth!.verdict !== 'fail') continue;
    const k = r.previewContentHealth!.failureReason ?? 'unknown';
    contentHealthBreakdown[k] = (contentHealthBreakdown[k] ?? 0) + 1;
  }

  return {
    total,
    succeeded,
    failed,
    averageFixAttempts: total === 0 ? 0 : Number((totalFixes / total).toFixed(2)),
    failureBreakdown: breakdown,
    preview: {
      attempted: previewRuns.length,
      ready: ready.length,
      failed: previewFailed,
      timedOut: previewTimedOut,
      noBackend: previewNoBackend,
      averageReadyMs,
      maxReadyMs,
      minReadyMs,
    },
    recordIntegrity: {
      attempted: integrityRuns.length,
      passed: integrityPassed,
      failed: integrityFailed,
    },
    previewContentHealth: {
      attempted: contentHealthRuns.length,
      passed: contentHealthPassed,
      failed: contentHealthFailed,
      failureBreakdown: contentHealthBreakdown,
    },
  };
}

// ─────────────────────────────────────────────────────────────
// Project-record integrity gate
// ─────────────────────────────────────────────────────────────

/** Spacing between the three integrity probes. Long enough that a
 *  transient FS hiccup or in-flight writer flush has a chance to settle
 *  between samples, short enough that the gate adds <1s to a passing
 *  run. */
const RECORD_INTEGRITY_PROBE_SPACING_MS = 250;

/**
 * Project-record stability check.
 *
 * Run AFTER the preview gate concludes ready (or no-backend — the record
 * still has to be readable on this workstation). Issues 3 sequential
 * GETs on /api/projects/:id and verifies, on every probe:
 *
 *   1. HTTP 200 (no 500 — the structured corruption error
 *      `code: 'PROJECT_RECORD_CORRUPT'` returns 500 and counts as a
 *      failure here).
 *   2. Body parses as JSON.
 *   3. `body.status` is a non-empty string (the build-status field the
 *      dashboard relies on).
 *   4. `body.preview` is either undefined OR a plain object whose
 *      `previewStatus` (when present) is a string.
 *
 * Any deviation flips the run to `fail-metadata-corruption` with the
 * full per-probe trace persisted on `result.recordIntegrity` so the
 * postmortem can pinpoint which read failed and why.
 */
async function checkRecordIntegrity(projectId: string): Promise<RecordIntegrityResult> {
  const t0 = Date.now();
  const probes: RecordIntegrityProbe[] = [];

  for (let i = 1; i <= 3; i++) {
    if (i > 1) await sleep(RECORD_INTEGRITY_PROBE_SPACING_MS);
    const startedAt = new Date().toISOString();
    const probeT0 = Date.now();
    let httpStatus: number | null = null;
    let parsed = false;
    let statusReadable = false;
    let previewReadable = false;
    let errorCode: string | null = null;
    let rawSample: string | null = null;
    let failureReason: string | null = null;

    try {
      const res = await http<Record<string, unknown>>('GET', `/api/projects/${projectId}`);
      httpStatus = res.status;

      if (res.status >= 500) {
        // Structured corruption error from project-store recovery path
        // surfaces here. `code: 'PROJECT_RECORD_CORRUPT'` is the canonical
        // shape; we still flag any 5xx as integrity failure.
        const code = typeof res.body === 'object' && res.body !== null
          ? (res.body as { code?: unknown }).code
          : undefined;
        if (typeof code === 'string') errorCode = code;
        failureReason = `HTTP ${res.status}` + (errorCode ? ` (${errorCode})` : '');
        rawSample = res.raw.slice(0, 200);
      } else if (res.status !== 200) {
        failureReason = `unexpected HTTP ${res.status}`;
        rawSample = res.raw.slice(0, 200);
      } else if (!res.body) {
        failureReason = 'response body did not parse as JSON';
        rawSample = res.raw.slice(0, 200);
      } else {
        parsed = true;
        const body = res.body as { status?: unknown; preview?: unknown };
        statusReadable = typeof body.status === 'string' && body.status.length > 0;
        if (!statusReadable) {
          failureReason = `status field unreadable (got ${typeof body.status})`;
        }
        const preview = body.preview;
        if (preview === undefined || preview === null) {
          // Acceptable: project may not have started a preview yet.
          previewReadable = true;
        } else if (typeof preview === 'object') {
          const ps = (preview as { previewStatus?: unknown }).previewStatus;
          // previewStatus is optional. When present it MUST be a string.
          previewReadable = ps === undefined || typeof ps === 'string';
          if (!previewReadable && !failureReason) {
            failureReason = `preview.previewStatus unreadable (got ${typeof ps})`;
          }
        } else {
          previewReadable = false;
          if (!failureReason) {
            failureReason = `preview field unreadable (got ${typeof preview})`;
          }
        }
      }
    } catch (err) {
      failureReason = `transport error: ${(err as Error).message}`;
    }

    const ok = httpStatus === 200 && parsed && statusReadable && previewReadable;
    probes.push({
      attempt: i,
      startedAt,
      durationMs: Date.now() - probeT0,
      httpStatus,
      parsed,
      statusReadable,
      previewReadable,
      errorCode,
      rawSample,
      ok,
      failureReason: ok ? null : failureReason ?? 'unknown failure',
    });

    if (!ok) {
      log.warn(
        `  ↳ integrity probe ${i}/3 FAILED — http=${httpStatus} parsed=${parsed} ` +
          `status=${statusReadable} preview=${previewReadable} reason=${failureReason}`,
      );
    } else {
      log.info(`  ↳ integrity probe ${i}/3 ok (http=200, ${probes[i - 1]!.durationMs}ms)`);
    }
  }

  const okCount = probes.filter((p) => p.ok).length;
  const firstFailure = probes.find((p) => !p.ok);
  const firstErrorCode = probes.find((p) => p.errorCode)?.errorCode ?? null;
  return {
    outcome: okCount === 3 ? 'pass' : 'fail',
    durationMs: Date.now() - t0,
    probes,
    okCount,
    reason: firstFailure?.failureReason ?? null,
    errorCode: firstErrorCode,
  };
}

// ─────────────────────────────────────────────────────────────
// Main loop
// ─────────────────────────────────────────────────────────────

async function runOne(index: number, prompt: string): Promise<GenerationResult> {
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  const attempts: AttemptLog[] = [];
  let projectId: string | null = null;
  let status: GenerationResult['status'] = 'pass';
  let finalError: string | undefined;
  // Hoisted so both the success and the catch path can reference the
  // preview gate's outcome (the gate may have already concluded with
  // 'failed' or 'timeout' before a downstream throw).
  let previewOutcome: PreviewOutcome | undefined;
  // Hoisted for the same reason — the integrity gate runs after the
  // preview gate but before execution validation, so it may already
  // have a verdict when a downstream step throws.
  let recordIntegrity: RecordIntegrityResult | undefined;
  // Hoisted so both the success and the catch path can include the
  // QA-side content-health verdict in the result file.
  let previewContentHealth: PreviewContentHealthResult | undefined;

  try {
    log.info(`▶ [${index + 1}/${RUN_COUNT}] creating project for prompt: ${prompt.slice(0, 70)}…`);
    const created = await createProject(prompt);
    projectId = created.projectId;
    log.info(`  ↳ projectId=${projectId} sessionId=${created.sessionId}`);

    let final: ProjectRecordLite;
    try {
      final = await waitForCompletion(projectId);
    } catch (err) {
      const e = err as Error & { code?: string };
      status =
        e.code === 'TIMEOUT'             ? 'fail-generation-timeout' :
        e.code === 'SPEC_NEVER_STARTED'  ? 'fail-generation-spec-never-started' :
        e.code === 'NO_PROGRESS'         ? 'fail-generation-no-progress' :
        e.code === 'QA_STUCK'            ? 'fail-generation-qa-stuck' :
                                           'fail-generation-error';
      finalError = e.message;
      throw err;
    }

    if (final.status === 'failed') {
      status = 'fail-generation-error';
      finalError = `Project status=failed; error=${final.error ?? 'unknown'}`;
      // Still attempt validation against partial output so the result is useful.
    }

    // ── Preview-readiness gate ────────────────────────────────
    // Only run when generation actually reached 'completed'. A failed
    // project skips the gate entirely (no preview to validate). The
    // gate runs BEFORE execution validation: if the preview backend
    // can't even start the app, there's no point spawning yet another
    // local install/build/dev cycle in runValidation. Ready/failed/
    // timeout are all terminal — only 'ready' lets us proceed.
    if (final.status === 'completed') {
      previewOutcome = await waitForPreview(projectId);
      if (previewOutcome.outcome === 'failed') {
        status = 'fail-preview-failed';
        finalError = `Preview failed: ${previewOutcome.previewError ?? 'unknown'}`;
        return {
          index,
          projectId,
          prompt,
          startedAt,
          completedAt: new Date().toISOString(),
          totalDurationMs: Date.now() - t0,
          status,
          fixAttempts: 0,
          attempts,
          finalError,
          preview: previewOutcome,
          previewContentHealth,
          diagnostics: await collectDiagnostics(projectId),
        };
      }
      if (previewOutcome.outcome === 'timeout') {
        status = 'fail-preview-timeout';
        finalError =
          `Preview did not reach ready/failed within ${PREVIEW_READY_TIMEOUT_MS / 1000}s ` +
          `(last persisted previewStatus=${previewOutcome.previewStatus})`;
        return {
          index,
          projectId,
          prompt,
          startedAt,
          completedAt: new Date().toISOString(),
          totalDurationMs: Date.now() - t0,
          status,
          fixAttempts: 0,
          attempts,
          finalError,
          preview: previewOutcome,
          previewContentHealth,
          diagnostics: await collectDiagnostics(projectId),
        };
      }
      // 'ready' or 'no-backend' → proceed to execution validation.
      // 'no-backend' is a workstation-config issue, not a pipeline
      // failure: log a warning and let the existing validation path
      // exercise the code via the local runner instead.
      if (previewOutcome.outcome === 'no-backend') {
        log.warn(
          `  ↳ preview gate skipped (no backend available); proceeding to execution validation`,
        );
      }

      // ── QA-side preview content-health gate ─────────────────
      // Defence-in-depth check that runs ONLY when the preview gate
      // actually produced a reachable preview (`outcome: 'ready'`).
      // Re-fetches the preview proxy URL and scans the rendered HTML
      // for dev-error-overlay markers ("Module not found", "Build
      // Error", "Unhandled Runtime Error", "Cannot resolve", Next.js
      // overlay sentinels). A diagnostic run is only `pass` if BOTH
      // the upstream preview verdict AND this independent scan agree
      // the preview is healthy.
      //
      // Skipped (recorded as `verdict: 'skipped'`) when the preview
      // gate finished with `no-backend` — there is no proxy URL to
      // probe. The parent run remains eligible to pass via the
      // execution-validation path that follows.
      if (previewOutcome.outcome === 'ready') {
        log.info(`  ↳ QA preview content-health gate: GET ${previewOutcome.previewUrl ?? `/preview/${projectId}/`}`);
        previewContentHealth = await runPreviewContentHealthGate(
          projectId,
          previewOutcome.previewUrl,
        );
        if (previewContentHealth.verdict === 'fail') {
          status = 'fail-preview-overlay';
          const headline =
            previewContentHealth.failureReason === 'transport-failed' ||
            previewContentHealth.failureReason === 'transport-timeout' ||
            previewContentHealth.failureReason === 'http-status'
              ? `Preview proxy unreachable: ${previewContentHealth.failureReason}` +
                (previewContentHealth.httpStatus !== null
                  ? ` (status=${previewContentHealth.httpStatus})`
                  : '')
              : `Preview rendered dev overlay: ${previewContentHealth.failureReason}` +
                (previewContentHealth.affectedModule
                  ? ` for module "${previewContentHealth.affectedModule}"`
                  : '');
          finalError =
            `${headline}. ` +
            (previewContentHealth.failureMessage
              ? `Detail: ${previewContentHealth.failureMessage.slice(0, 240)}`
              : '');
          log.error(`  ↳ QA content-health FAIL — ${headline}`);
          if (previewContentHealth.failureMessage) {
            log.error(`  ↳ overlay message: ${previewContentHealth.failureMessage.slice(0, 240)}`);
          }
          return {
            index,
            projectId,
            prompt,
            startedAt,
            completedAt: new Date().toISOString(),
            totalDurationMs: Date.now() - t0,
            status,
            fixAttempts: 0,
            attempts,
            finalError,
            preview: previewOutcome,
            previewContentHealth,
            diagnostics: await collectDiagnostics(projectId),
          };
        }
        log.info(
          `  ↳ QA content-health PASS (HTTP ${previewContentHealth.httpStatus}, ` +
            `${previewContentHealth.bodyBytes} bytes, ${previewContentHealth.durationMs}ms)`,
        );
      } else {
        previewContentHealth = {
          verdict: 'skipped',
          durationMs: 0,
          previewUrl: null,
          httpStatus: null,
          bodyBytes: 0,
          failureReason: 'preview-not-ready',
          failureMessage:
            `Preview gate outcome was '${previewOutcome.outcome}' — content-health gate skipped`,
        };
        log.warn(`  ↳ QA content-health gate SKIPPED (preview outcome=${previewOutcome.outcome})`);
      }

      // ── Project-record integrity gate ────────────────────────
      // Diagnostic mode now validates not only build+preview, but
      // also that the on-disk project record stays readable AFTER the
      // preview becomes ready. Three back-to-back GETs must all
      // succeed (200 + parseable JSON + readable status + readable
      // preview fields). A single 500 / corruption here flips the
      // run to `fail-metadata-corruption` so downstream consumers
      // (dashboard, postmortem) can distinguish a clean build with
      // a broken record from a healthy run.
      log.info(`  ↳ project-record integrity gate: 3 sequential GETs…`);
      recordIntegrity = await checkRecordIntegrity(projectId);
      if (recordIntegrity.outcome === 'fail') {
        status = 'fail-metadata-corruption';
        finalError =
          `Project-record integrity check failed: ` +
          `${recordIntegrity.okCount}/3 probes ok` +
          (recordIntegrity.errorCode ? ` (${recordIntegrity.errorCode})` : '') +
          `; reason=${recordIntegrity.reason ?? 'unknown'}`;
        log.error(`  ↳ ${finalError}`);
        return {
          index,
          projectId,
          prompt,
          startedAt,
          completedAt: new Date().toISOString(),
          totalDurationMs: Date.now() - t0,
          status,
          fixAttempts: 0,
          attempts,
          finalError,
          preview: previewOutcome,
          previewContentHealth,
          recordIntegrity,
          diagnostics: await collectDiagnostics(projectId),
        };
      }
      log.info(`  ↳ project-record integrity gate PASS (3/3)`);
    }
    log.info(`  ↳ running execution validation #1 …`);
    let { result, attempt } = await runValidation(projectId);
    attempt.iteration = 0;
    attempts.push(attempt);
    log.info(
      `  ↳ validation: success=${attempt.success} reasons=[${attempt.failureReasons.join('|')}] steps-failed=[${attempt.failedSteps.join(',')}] http=${attempt.httpStatus ?? 'n/a'}`,
    );

    let fixAttempt = 0;
    while (!result.success && fixAttempt < MAX_FIX_ATTEMPTS) {
      fixAttempt++;
      log.info(`  ↳ triggering auto-fix #${fixAttempt}/${MAX_FIX_ATTEMPTS} …`);
      try {
        await triggerAutoFix(projectId, {
          buildErrors: attempt.buildErrors,
          runtimeErrors: attempt.runtimeErrors,
          failedSteps: attempt.failedSteps,
          failureReasons: attempt.failureReasons,
        });
      } catch (err) {
        status = 'fail-update-error';
        finalError = (err as Error).message;
        break;
      }
      try {
        await waitForUpdate(projectId);
      } catch (err) {
        const e = err as Error & { code?: string };
        status =
          e.code === 'TIMEOUT'             ? 'fail-update-timeout' :
          e.code === 'SPEC_NEVER_STARTED'  ? 'fail-update-spec-never-started' :
          e.code === 'NO_PROGRESS'         ? 'fail-update-no-progress' :
          e.code === 'QA_STUCK'            ? 'fail-update-qa-stuck' :
                                             'fail-update-error';
        finalError = e.message;
        break;
      }
      log.info(`  ↳ running execution validation #${fixAttempt + 1} …`);
      const next = await runValidation(projectId);
      result = next.result;
      attempt = next.attempt;
      attempt.iteration = fixAttempt;
      attempts.push(attempt);
      log.info(
        `  ↳ validation: success=${attempt.success} reasons=[${attempt.failureReasons.join('|')}] steps-failed=[${attempt.failedSteps.join(',')}] http=${attempt.httpStatus ?? 'n/a'}`,
      );
    }

    if (!result.success && status === 'pass') {
      status = 'fail-validation';
      finalError = `Validation never converged after ${fixAttempt} fix attempt(s). ` +
        `Last failed steps: [${attempt.failedSteps.join(',')}]; build err count=${attempt.buildErrors.length}, runtime err count=${attempt.runtimeErrors.length}`;
    }

    // Pull the persisted diagnostics block off the project record, if any.
    const diagnostics = await collectDiagnostics(projectId);

    return {
      index,
      projectId,
      prompt,
      startedAt,
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - t0,
      status,
      fixAttempts: fixAttempt,
      attempts,
      finalError,
      preview: previewOutcome,
      previewContentHealth,
      recordIntegrity,
      diagnostics,
    };
  } catch (err) {
    const diagnostics = await collectDiagnostics(projectId);
    return {
      index,
      projectId,
      prompt,
      startedAt,
      completedAt: new Date().toISOString(),
      totalDurationMs: Date.now() - t0,
      status: status === 'pass' ? 'fail-generation-error' : status,
      fixAttempts: attempts.filter((a) => a.iteration > 0).length,
      attempts,
      finalError: finalError ?? (err as Error).message,
      preview: previewOutcome,
      previewContentHealth,
      recordIntegrity,
      diagnostics,
    };
  }
}

/**
 * Pull the structured `failure` block + `progress.llmCallCount` off the
 * persisted project record. Returns undefined when the project is null,
 * still generating, or has no failure metadata.
 */
async function collectDiagnostics(
  projectId: string | null,
): Promise<GenerationResult['diagnostics']> {
  if (!projectId) return undefined;
  let project: ProjectRecordLite | null = null;
  try {
    project = await getProject(projectId);
  } catch {
    return undefined;
  }
  if (!project) return undefined;
  const llmCallCount = project.progress?.llmCallCount ?? project.failure?.llmCallCount ?? 0;
  if (!project.failure) {
    // Successful runs still emit diagnostics so results.json shows
    // anyLlmCallMade for both passes and fails.
    if (project.status === 'completed') {
      return {
        failedPhase: 'none',
        lastSuccessfulPhase: project.progress?.phase,
        errorName: 'none',
        errorMessage: '',
        failedAt: '',
        llmCallCount,
        anyLlmCallMade: llmCallCount > 0,
      };
    }
    return undefined;
  }
  return {
    failedPhase: project.failure.failedPhase,
    lastSuccessfulPhase: project.failure.lastSuccessfulPhase,
    errorName: project.failure.errorName,
    errorMessage: project.failure.errorMessage,
    stack: project.failure.stack,
    failedAt: project.failure.failedAt,
    llmCallCount,
    anyLlmCallMade: llmCallCount > 0,
  };
}

async function runGenerationLoop(): Promise<void> {
  log.info(`Starting generation loop: count=${RUN_COUNT}, api=${API_URL}`);

  // Sanity: API up?
  try {
    const health = await http('GET', '/health');
    if (health.status !== 200) {
      throw new Error(`API health check returned status ${health.status}`);
    }
  } catch (err) {
    throw new Error(
      `API unavailable at ${API_URL}/health — start it with 'npm run dev' first. (${(err as Error).message})`,
    );
  }

  const file = await loadOrInitResults();
  // If we're resuming a previous (incomplete) run we keep its results;
  // otherwise reset.
  const resuming =
    file.completedAt === null && file.results.length > 0 && file.count === RUN_COUNT && file.apiUrl === API_URL;
  if (!resuming) {
    file.startedAt = new Date().toISOString();
    file.results = [];
    file.count = RUN_COUNT;
    file.apiUrl = API_URL;
    file.completedAt = null;
    file.summary = null;
  } else {
    log.info(`Resuming from existing results.json (${file.results.length} prior result(s))`);
  }

  // Strict sequential: MAX_CONCURRENT_GENERATIONS = 1. The serial `for` loop
  // (with `await runOne`) is the enforcement; we also assert it here so the
  // invariant is impossible to violate by accident.
  if (MAX_CONCURRENT_GENERATIONS !== 1) {
    throw new Error('MAX_CONCURRENT_GENERATIONS must be 1 (strict sequential)');
  }

  let totalCostUsd = 0;
  let budgetAborted = false;

  for (let i = file.results.length; i < RUN_COUNT; i++) {
    // Cost-budget gate (checked BEFORE starting each generation).
    if (totalCostUsd > MAX_TOTAL_COST_USD) {
      log.error(
        `Cost budget exceeded: spent $${totalCostUsd.toFixed(2)} > cap $${MAX_TOTAL_COST_USD.toFixed(2)} — aborting loop`,
      );
      budgetAborted = true;
      break;
    }

    const prompt = getTestPrompt(i);
    const startedAt = Date.now();

    const result = await Promise.race([
      runOne(i, prompt),
      new Promise<GenerationResult>((resolve) =>
        setTimeout(() => {
          resolve({
            index: i,
            projectId: null,
            prompt,
            startedAt: new Date(startedAt).toISOString(),
            completedAt: new Date().toISOString(),
            totalDurationMs: Date.now() - startedAt,
            status: 'fail-generation-timeout',
            fixAttempts: 0,
            attempts: [],
            finalError: `Generation #${i + 1} exceeded ${PER_GENERATION_TIMEOUT_MS}ms hard cap`,
          });
        }, PER_GENERATION_TIMEOUT_MS + 60_000),
      ),
    ]);

    file.results.push(result);
    file.summary = summarise(file.results);
    await persistResults(file);

    // Accumulate cost from the persisted project record (best-effort).
    if (result.projectId) {
      try {
        const persisted = await getProject(result.projectId);
        const cost = persisted?.totalCostUsd ?? 0;
        if (Number.isFinite(cost) && cost > 0) {
          totalCostUsd += cost;
        }
      } catch (err) {
        log.warn(`cost lookup failed for ${result.projectId}: ${(err as Error).message}`);
      }
    }

    log.info(
      `◀ [${i + 1}/${RUN_COUNT}] ${result.status.toUpperCase()} in ${(result.totalDurationMs / 1000).toFixed(1)}s ` +
        `(fixes=${result.fixAttempts}, spent=$${totalCostUsd.toFixed(2)}/$${MAX_TOTAL_COST_USD.toFixed(2)}` +
        (result.diagnostics
          ? `, phase=${result.diagnostics.failedPhase}, llm=${result.diagnostics.llmCallCount}` +
            (result.diagnostics.lastSuccessfulPhase
              ? `, lastOk=${result.diagnostics.lastSuccessfulPhase}`
              : '')
          : '') +
        (result.preview
          ? `, preview=${result.preview.outcome}${
              result.preview.outcome === 'ready'
                ? ` (${(result.preview.durationMs / 1000).toFixed(1)}s)`
                : ''
            }`
          : '') +
        `)` +
        (result.finalError ? ` — ${result.finalError.slice(0, 200)}` : ''),
    );

    // Per-run preview diagnostics block. Always printed when the gate
    // ran so a human reading the CLI output sees every preview field
    // the spec calls out, regardless of pass/fail.
    if (result.preview) {
      const p = result.preview;
      log.info(`  ↳ preview diagnostics:`);
      log.info(`      outcome           : ${p.outcome}`);
      log.info(`      previewStatus     : ${p.previewStatus}`);
      log.info(`      previewUrl        : ${p.previewUrl ?? '(none)'}`);
      log.info(`      previewError      : ${p.previewError ? p.previewError.slice(0, 240) : '(none)'}`);
      log.info(`      previewStartedAt  : ${p.previewStartedAt ?? '(none)'}`);
      log.info(`      previewReadyAt    : ${p.previewReadyAt ?? '(none)'}`);
      log.info(`      previewFailedAt   : ${p.previewFailedAt ?? '(none)'}`);
      log.info(`      gateDurationMs    : ${p.durationMs}`);
      log.info(`      transitions       : ${p.transitionsObserved}`);
    }

    // Post-generation cooldown to avoid hitting provider rate limits.
    // Skip the wait after the final iteration.
    const isLast = i === RUN_COUNT - 1;
    if (!isLast && INTER_GENERATION_DELAY_MS > 0) {
      log.info(`  ↳ cooldown ${(INTER_GENERATION_DELAY_MS / 1000).toFixed(0)}s before next generation`);
      await sleep(INTER_GENERATION_DELAY_MS);
    }
  }

  if (budgetAborted) {
    log.warn(
      `Loop aborted after ${file.results.length}/${RUN_COUNT} generations due to cost budget`,
    );
  }

  file.completedAt = new Date().toISOString();
  file.summary = summarise(file.results);
  await persistResults(file);

  // ── Final report ─────────────────────────────────────────
  log.info('═══════════════ SUMMARY ═══════════════');
  log.info(`total:     ${file.summary!.total}`);
  log.info(`succeeded: ${file.summary!.succeeded}`);
  log.info(`failed:    ${file.summary!.failed}`);
  log.info(`avg fixes: ${file.summary!.averageFixAttempts}`);
  log.info(`spent:     $${totalCostUsd.toFixed(2)} (cap $${MAX_TOTAL_COST_USD.toFixed(2)})`);
  log.info(`breakdown: ${JSON.stringify(file.summary!.failureBreakdown)}`);
  // Preview-readiness aggregate. Surfaces the same numbers persisted in
  // results.json under summary.preview so CI logs alone are enough to
  // see whether the platform is actually serving generated apps.
  const pv = file.summary!.preview;
  log.info(`─── preview gate ───`);
  log.info(`  attempted:        ${pv.attempted}`);
  log.info(`  ready:            ${pv.ready}`);
  log.info(`  failed:           ${pv.failed}`);
  log.info(`  timed-out:        ${pv.timedOut}`);
  log.info(`  no-backend:       ${pv.noBackend}`);
  log.info(
    `  ready time (ms):  ` +
      (pv.averageReadyMs === null
        ? 'n/a'
        : `avg=${pv.averageReadyMs} min=${pv.minReadyMs} max=${pv.maxReadyMs}`),
  );
  // Project-record integrity aggregate. Distinct from preview: this
  // measures whether the on-disk record stayed readable after the
  // preview reported ready.
  const ri = file.summary!.recordIntegrity;
  log.info(`─── record-integrity gate ───`);
  log.info(`  attempted:        ${ri.attempted}`);
  log.info(`  passed:           ${ri.passed}`);
  log.info(`  failed:           ${ri.failed}`);
  log.info(`results:   ${RESULTS_PATH}`);
  if (budgetAborted) log.warn('LOOP ABORTED: cost budget exceeded');
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// Diagnostic mode (DIAGNOSTIC=1)
// ─────────────────────────────────────────────────────────────
//
// Single-project, verbose, stop-on-first-failure debugging mode for
// auditing the pipeline startup path. Unlike the main loop this:
//   • runs exactly ONE generation (no fix-attempt loop, no validation,
//     no results.json, no lock file)
//   • uses a fixed minimal prompt
//   • polls every 1s and logs every phase / progress transition
//   • on the first sign of failure dumps the full project state and exits 1
//
// Activation:  DIAGNOSTIC=1 npm run test:generations
// ─────────────────────────────────────────────────────────────

const DIAGNOSTIC_PROMPT =
  'Build a counter app with increment, decrement, and reset buttons.';
const DIAGNOSTIC_POLL_INTERVAL_MS = 1_000;
const DIAGNOSTIC_HARD_TIMEOUT_MS = 30 * 60 * 1000;

function dumpPollStats(s: PollResilienceStats): void {
  log.info(`──────── POLL RESILIENCE STATS ────────`);
  log.info(`  poll fetch failures:        ${s.pollFetchFailures}`);
  log.info(`  poll fetch retries:         ${s.pollFetchRetries}`);
  log.info(`  health checks attempted:    ${s.healthChecksAttempted}`);
  log.info(`  health checks failed:       ${s.healthChecksFailed}`);
  log.info(`  health ever reachable:      ${s.healthEverReachable ? 'yes' : 'NO'}`);
  log.info(`  api pid changes observed:   ${s.pidChanges} (pids: ${s.observedPids.join(', ') || 'none'})`);
  log.info(`  api restartCounter bumps:   ${s.restartCounterIncrements} (values: ${s.observedRestartCounters.join(', ') || 'none'})`);
  if (s.lastFetchError) log.info(`  last fetch error:           ${s.lastFetchError}`);
  if (s.lastHealthSnapshot) {
    const h = s.lastHealthSnapshot;
    log.info(`  last health snapshot:       ok=${h.ok} pid=${h.pid ?? '?'} restart=${h.restartCounter ?? '?'} uptime=${h.uptime ?? '?'}s status=${h.status}${h.error ? ' err=' + h.error : ''}`);
  }
  log.info(`────────────────────────────────────────`);
  // Persist a JSON copy alongside the API crash dump so the failure
  // mode is auditable after the runner exits.
  void writeFile(
    join(__dirname, 'last-poll-resilience.json'),
    JSON.stringify({ timestamp: new Date().toISOString(), ...s }, null, 2),
    'utf8',
  ).catch(() => { /* best-effort */ });
}

function dumpProjectSnapshot(label: string, p: ProjectRecordLite | null): void {
  log.info(`──────── ${label} ────────`);
  if (!p) {
    log.info('  (project not found / null)');
    log.info('────────────────────────────────');
    return;
  }
  const fileCount = Array.isArray(p.files) ? p.files.length : 0;
  const taskCount = Array.isArray(p.tasks) ? p.tasks.length : 0;
  const slices = extractSliceCount(p) ?? 0;
  const phase = p.progress?.phase ?? '(no progress block)';
  const step = p.progress?.lastMeaningfulStep ?? '(none)';
  const llm = p.progress?.llmCallCount ?? 0;
  const filesWritten = p.progress?.filesWrittenCount ?? fileCount;
  log.info(`  id              : ${p.id}`);
  // Generation-pipeline status. MUST be reported separately from
  // `previewStatus` below — these are independent state machines:
  // `projectStatus: completed` + `previewStatus: failed` is the
  // expected terminal shape when the build succeeded but the dev
  // server later failed to boot. Earlier versions printed only a
  // single `status:` line, which made it look as if a preview
  // failure had regressed the generation status.
  log.info(`  projectStatus   : ${p.status}`);
  const pv = p.preview;
  if (pv) {
    log.info(`  previewStatus   : ${pv.previewStatus}`);
    log.info(`  previewReady    : ${pv.previewReady}`);
    if (pv.previewError) {
      log.info(`  previewError    : ${pv.previewError.slice(0, 240)}`);
    }
  } else {
    log.info(`  previewStatus   : (no preview block persisted)`);
  }
  log.info(`  phase           : ${phase}`);
  log.info(`  lastMeaningful  : ${step}`);
  log.info(`  taskCount       : ${taskCount}`);
  log.info(`  slicesPlanned   : ${slices}`);
  log.info(`  filesWritten    : ${filesWritten}`);
  log.info(`  llmCallCount    : ${llm}`);
  log.info(`  firstLlmCall?   : ${llm > 0 ? 'YES' : 'NO  ← never reached LLM'}`);
  log.info(`  totalCostUsd    : $${(p.totalCostUsd ?? 0).toFixed(4)}`);
  log.info(`  totalTokens     : ${p.totalTokens ?? 0}`);
  log.info(`  error           : ${p.error ? `'${p.error}'` : '(empty)'}`);
  if (p.failure) {
    log.info(`  failure.phase   : ${p.failure.failedPhase}`);
    log.info(`  failure.lastOk  : ${p.failure.lastSuccessfulPhase ?? '(none)'}`);
    log.info(`  failure.name    : ${p.failure.errorName}`);
    log.info(`  failure.message : ${p.failure.errorMessage}`);
    log.info(`  failure.failedAt: ${p.failure.failedAt}`);
    if (p.failure.stack) {
      log.info(`  failure.stack   :`);
      for (const line of p.failure.stack.split('\n').slice(0, 12)) {
        log.info(`    ${line}`);
      }
    }
  } else {
    log.info(`  failure         : (none persisted)`);
  }
  log.info('────────────────────────────────');
}

async function runDiagnostic(): Promise<void> {
  log.info('═════════════════════════════════════════════════════════════');
  log.info(' DIAGNOSTIC MODE — single generation, verbose, stop-on-fail');
  log.info('═════════════════════════════════════════════════════════════');
  log.info(`API_URL : ${API_URL}`);
  log.info(`prompt  : "${DIAGNOSTIC_PROMPT}"`);

  // Stage 1: API health.
  log.info('');
  log.info('▶ Stage 1/6 — API health check');
  const t0 = Date.now();
  let health;
  try {
    health = await http('GET', '/health');
  } catch (err) {
    log.error(`  ✗ API unreachable at ${API_URL}: ${(err as Error).message}`);
    process.exit(1);
  }
  if (health.status !== 200) {
    log.error(`  ✗ /health returned ${health.status}`);
    process.exit(1);
  }
  log.info(`  ✓ /health OK in ${Date.now() - t0}ms`);

  // Stage 2: POST /api/projects/generate.
  log.info('');
  log.info('▶ Stage 2/6 — POST /api/projects/generate');
  const tGen = Date.now();
  let createRes;
  try {
    createRes = await http<{ projectId?: string; sessionId?: string; error?: string }>(
      'POST',
      '/api/projects/generate',
      { prompt: DIAGNOSTIC_PROMPT },
    );
  } catch (err) {
    log.error(`  ✗ POST failed: ${(err as Error).message}`);
    process.exit(1);
  }
  log.info(`  ← status=${createRes.status} in ${Date.now() - tGen}ms`);
  log.info(`  ← body=${createRes.raw.slice(0, 500)}`);
  if (createRes.status !== 200 && createRes.status !== 202) {
    log.error(`  ✗ generate endpoint returned ${createRes.status} — aborting`);
    process.exit(1);
  }
  const projectId = createRes.body?.projectId;
  const sessionId = createRes.body?.sessionId;
  if (!projectId) {
    log.error('  ✗ response had no projectId — aborting');
    process.exit(1);
  }
  log.info(`  ✓ projectId=${projectId} sessionId=${sessionId ?? '(none)'}`);

  // Stage 3: poll progress.
  log.info('');
  log.info('▶ Stage 3/6 — polling project status (1s interval, verbose)');
  const tPoll = Date.now();
  let lastFingerprint = '';
  let firstLlmLogged = false;
  let lastSeen: ProjectRecordLite | null = null;
  let poll = 0;
  const pollStats = makePollStats();
  const consecutiveHealthFailuresRef = { value: 0 };
  // Seed the pid/restart tracker with one health snapshot up front so
  // a mid-poll restart shows up as a delta rather than a fresh value.
  const seedHealth = await getHealth();
  recordHealthSnapshot(pollStats, seedHealth);
  if (seedHealth.ok) {
    log.info(
      `  · seed /health: pid=${seedHealth.pid ?? '?'} restart=${seedHealth.restartCounter ?? '?'} ` +
      `uptime=${seedHealth.uptime ?? '?'}s`,
    );
  }
  while (true) {
    poll++;
    const elapsed = Date.now() - tPoll;
    if (elapsed > DIAGNOSTIC_HARD_TIMEOUT_MS) {
      log.error(`  ✗ hard timeout (${(elapsed / 1000).toFixed(0)}s) — aborting`);
      dumpProjectSnapshot('FINAL STATE (timeout)', lastSeen);
      dumpPollStats(pollStats);
      process.exit(1);
    }
    let proj: ProjectRecordLite | null;
    try {
      proj = await resilientGetProject(projectId, pollStats, consecutiveHealthFailuresRef);
    } catch (err) {
      log.error(`  ✗ getProject unrecoverable: ${(err as Error).message}`);
      dumpProjectSnapshot('FINAL STATE (poll-error)', lastSeen);
      dumpPollStats(pollStats);
      process.exit(1);
    }
    lastSeen = proj;
    const fp = progressFingerprint(proj);
    if (fp !== lastFingerprint) {
      log.info(
        `  · poll #${poll} (+${(elapsed / 1000).toFixed(1)}s) — ${fp}`,
      );
      lastFingerprint = fp;
    }
    // First-LLM-call milestone
    if (!firstLlmLogged && (proj?.progress?.llmCallCount ?? 0) > 0) {
      log.info(`  ★ FIRST LLM CALL observed at poll #${poll} (+${(elapsed / 1000).toFixed(1)}s)`);
      firstLlmLogged = true;
    }
    if (!proj) {
      log.info(`  · poll #${poll} (+${(elapsed / 1000).toFixed(1)}s) — project not yet visible`);
      await sleep(DIAGNOSTIC_POLL_INTERVAL_MS);
      continue;
    }
    if (proj.status === 'failed') {
      log.error(`  ✗ status=failed at poll #${poll} (+${(elapsed / 1000).toFixed(1)}s) — STOPPING`);
      dumpProjectSnapshot('FINAL STATE (failed)', proj);
      if (!firstLlmLogged) {
        log.error('  ✗ failure happened BEFORE any LLM call — likely a setup/config bug');
      }
      dumpPollStats(pollStats);
      process.exit(1);
    }
    if (proj.status !== 'generating') {
      // 'completed' / 'optimizing' / etc. → exit polling loop
      break;
    }
    await sleep(DIAGNOSTIC_POLL_INTERVAL_MS);
  }

  // Stage 4: preview readiness gate. Runs only if generation actually
  // reached 'completed' — a 'failed' status has nothing to preview.
  // Mirrors the gate used in the full loop (waitForPreview), so the
  // single-shot DIAGNOSTIC=1 mode validates the same end-to-end path.
  log.info('');
  log.info('▶ Stage 4/6 — preview readiness gate');
  let previewOutcome: PreviewOutcome | null = null;
  if (lastSeen?.status === 'completed') {
    previewOutcome = await waitForPreview(projectId);
    log.info(`  preview outcome     : ${previewOutcome.outcome}`);
    log.info(`  previewStatus       : ${previewOutcome.previewStatus}`);
    log.info(`  previewUrl          : ${previewOutcome.previewUrl ?? '(none)'}`);
    log.info(`  previewError        : ${previewOutcome.previewError ? previewOutcome.previewError.slice(0, 240) : '(none)'}`);
    log.info(`  previewStartedAt    : ${previewOutcome.previewStartedAt ?? '(none)'}`);
    log.info(`  previewReadyAt      : ${previewOutcome.previewReadyAt ?? '(none)'}`);
    log.info(`  previewFailedAt     : ${previewOutcome.previewFailedAt ?? '(none)'}`);
    log.info(`  gateDurationMs      : ${previewOutcome.durationMs}`);
    log.info(`  transitionsObserved : ${previewOutcome.transitionsObserved}`);
    if (previewOutcome.overlayDetection) {
      const o = previewOutcome.overlayDetection;
      log.error(`  detectedErrorType   : ${o.detectedErrorType}`);
      if (o.affectedModule) log.error(`  affectedModule      : ${o.affectedModule}`);
      log.error(`  detectedErrorMsg    : ${o.detectedErrorMessage.slice(0, 240)}`);
    }
    if (previewOutcome.dependencyFixes && previewOutcome.dependencyFixes.length > 0) {
      log.info(`  dependencyFixes     : ${previewOutcome.dependencyFixes.length} package(s) auto-added`);
      for (const f of previewOutcome.dependencyFixes.slice(0, 12)) {
        const importers = f.requiredBy.length > 0
          ? ` (imported by ${f.requiredBy.slice(0, 2).join(', ')}${f.requiredBy.length > 2 ? `, +${f.requiredBy.length - 2}` : ''})`
          : '';
        log.info(`    - ${f.block}: ${f.packageName}@${f.version}${importers}`);
      }
      if (previewOutcome.dependencyFixes.length > 12) {
        log.info(`    \u2026 +${previewOutcome.dependencyFixes.length - 12} more`);
      }
    }
    if (previewOutcome.outcome === 'failed') {
      // Distinguish a content-health (overlay) failure from a transport-
      // level boot failure so the diagnostic exit reason is precise.
      // Re-fetch so projectStatus / previewStatus reported on the
      // exit line come from the SAME read (avoids any race where
      // the headline disagrees with the snapshot dumped below).
      const finalProj = await getProject(projectId).catch(() => null);
      const projectStatus = finalProj?.status ?? lastSeen?.status ?? 'unknown';
      const previewStatus = finalProj?.preview?.previewStatus ?? previewOutcome.previewStatus;
      const tail =
        ` — projectStatus=${projectStatus}, previewStatus=${previewStatus} — STOPPING`;
      if (previewOutcome.overlayDetection) {
        log.error(
          `  ✗ preview FAILED — dev overlay detected ` +
            `(${previewOutcome.overlayDetection.detectedErrorType})${tail}`,
        );
      } else {
        log.error(`  ✗ preview FAILED${tail}`);
      }
      dumpProjectSnapshot('FINAL STATE (preview-failed)', finalProj);
      dumpPollStats(pollStats);
      process.exit(1);
    }
    if (previewOutcome.outcome === 'timeout') {
      // Re-fetch the persisted record so the headline reports the
      // CURRENT projectStatus (must still be 'completed') alongside
      // the failed previewStatus. Conflating the two — i.e. logging
      // a single "status: generating" line — was the historical bug
      // this section is hardened against.
      const finalProj = await getProject(projectId).catch(() => null);
      const projectStatus = finalProj?.status ?? lastSeen?.status ?? 'unknown';
      const previewStatus = finalProj?.preview?.previewStatus ?? previewOutcome.previewStatus;
      log.error(
        `  ✗ preview TIMEOUT (${PREVIEW_READY_TIMEOUT_MS / 1000}s) — ` +
        `projectStatus=${projectStatus}, previewStatus=${previewStatus} — STOPPING`,
      );
      dumpProjectSnapshot('FINAL STATE (preview-timeout)', finalProj);
      dumpPollStats(pollStats);
      process.exit(1);
    }
  } else {
    log.warn(`  ↳ skipping preview gate (project status=${lastSeen?.status ?? 'unknown'})`);
  }

  // Stage 5: project-record integrity check. Runs only when the
  // preview gate finished cleanly (ready or no-backend) — there's no
  // point probing the on-disk record if a known upstream failure
  // already explains the run. Three sequential GETs verify the record
  // file stays parseable and the dashboard-critical fields stay
  // readable AFTER all the post-completion writers (preview status,
  // verdicts, optimization markers) have flushed.
  log.info('');
  log.info('▶ Stage 5/6 — project-record integrity check (3 sequential GETs)');
  let integrityOutcome: RecordIntegrityResult | null = null;
  if (
    previewOutcome &&
    (previewOutcome.outcome === 'ready' || previewOutcome.outcome === 'no-backend')
  ) {
    integrityOutcome = await checkRecordIntegrity(projectId);
    log.info(`  outcome   : ${integrityOutcome.outcome}`);
    log.info(`  okCount   : ${integrityOutcome.okCount}/3`);
    log.info(`  duration  : ${integrityOutcome.durationMs}ms`);
    if (integrityOutcome.errorCode) {
      log.info(`  errorCode : ${integrityOutcome.errorCode}`);
    }
    for (const probe of integrityOutcome.probes) {
      const tag = probe.ok ? '✓' : '✗';
      log.info(
        `  ${tag} probe #${probe.attempt} http=${probe.httpStatus ?? 'err'} ` +
          `parsed=${probe.parsed} status=${probe.statusReadable} ` +
          `preview=${probe.previewReadable} (${probe.durationMs}ms)` +
          (probe.failureReason ? ` reason=${probe.failureReason}` : ''),
      );
      if (probe.rawSample && !probe.ok) {
        log.info(`     raw: ${probe.rawSample}`);
      }
    }
    if (integrityOutcome.outcome === 'fail') {
      log.error(
        `  ✗ project-record integrity FAILED — marking run as metadata-corruption failure`,
      );
      // Persist a focused diagnostic dump alongside the standard
      // testing/last-*.json files so the postmortem can pick it up.
      try {
        const dumpPath = join(__dirname, 'last-record-integrity-failure.json');
        await writeFile(
          dumpPath,
          JSON.stringify(
            {
              projectId,
              recordedAt: new Date().toISOString(),
              integrity: integrityOutcome,
              previewOutcome,
              projectSnapshot: lastSeen,
            },
            null,
            2,
          ),
          'utf8',
        );
        log.info(`  ↳ persisted dump to ${dumpPath}`);
      } catch (err) {
        log.warn(`  ↳ could not persist integrity dump: ${(err as Error).message}`);
      }
      dumpProjectSnapshot(
        'FINAL STATE (record-integrity-failure)',
        await getProject(projectId).catch(() => null),
      );
      dumpPollStats(pollStats);
      process.exit(1);
    }
  } else {
    log.warn(
      `  ↳ skipping integrity gate (preview outcome=${previewOutcome?.outcome ?? 'n/a'})`,
    );
  }

  // Stage 6: terminal state dump.
  log.info('');
  log.info('▶ Stage 6/6 — terminal state');
  dumpProjectSnapshot('FINAL STATE (terminal)', lastSeen);
  dumpPollStats(pollStats);
  log.info(`✓ DIAGNOSTIC RUN COMPLETED in ${((Date.now() - tGen) / 1000).toFixed(1)}s`);
  process.exit(0);
}

// ─────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Diagnostic mode bypasses the lock file, results.json, and validation
  // loop entirely — it's a pure single-shot pipeline observation tool.
  if (process.env.DIAGNOSTIC === '1' || process.argv.includes('--diagnostic')) {
    try {
      await runDiagnostic();
    } catch (err) {
      log.error(`Diagnostic fatal: ${(err as Error).message}`);
      if ((err as Error).stack) log.error((err as Error).stack ?? '');
      process.exit(1);
    }
    return;
  }
  await acquireLock();
  let exitCode = 0;
  try {
    await runGenerationLoop();
  } catch (err) {
    log.error(`Fatal: ${(err as Error).message}`);
    if ((err as Error).stack) log.error((err as Error).stack ?? '');
    exitCode = 1;
  } finally {
    await releaseLock();
  }
  process.exit(exitCode);
}

// Graceful shutdown — release lock if killed.
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    log.warn(`Received ${sig}, releasing lock and exiting`);
    void releaseLock().finally(() => process.exit(130));
  });
}

void main();

// Suppress unused-warning for stat import (kept for forward compat).
void stat;
