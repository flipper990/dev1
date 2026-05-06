// ─────────────────────────────────────────────────────────────
// Preview runner types
// ─────────────────────────────────────────────────────────────

export type StackKind = 'nextjs' | 'vite-react' | 'plain-react' | 'node-express' | 'fullstack' | 'unknown';

export interface StackInfo {
  kind: StackKind;
  /** Container port the dev server listens on. */
  port: number;
  /** Optional path to GET for health (defaults to '/'). */
  healthPath: string;
  /** Reason / hint surfaced in the UI when kind === 'unknown'. */
  detectionNote: string;
  /** True if package.json exists at root and has a "dev" script. */
  hasDevScript: boolean;
}

export type PreviewState =
  | 'idle'
  | 'detecting'
  | 'preparing'    // staging files, evicting old containers, choosing backend
  | 'installing'   // npm install (local-runner) or image build deps phase
  | 'building'      // docker build (npm install runs inside)
  | 'starting'     // docker run, awaiting health
  | 'ready'
  | 'failed'
  | 'fallback'     // Docker not available — caller should render frontend-only preview
  | 'stopped';

/**
 * Fine-grained preview boot phase. Persisted alongside `previewStatus`
 * so the UI can answer "exactly where did the preview die?". Distinct
 * from `PreviewState` because:
 *   • `PreviewState` is the *internal* docker/local lifecycle vocabulary
 *     (also includes terminal/fallback states like `stopped`).
 *   • `PreviewStep` is a *boot-flow* phase. It progresses linearly from
 *     `queued` to `ready` (or terminates at `failed`) and is what the
 *     failure card surfaces ("died during preview:installing").
 *
 * Phase ordering:
 *   queued → staging-files → installing → building → spawning-server
 *          → waiting-for-port → http-probing → ready
 *   any phase → failed | timeout
 *
 * Phase boundary semantics for the local-runner-backed preview:
 *   • `spawning-server`   = `child_process.spawn(npm run dev …)` issued,
 *     awaiting the OS to actually create the child PID.
 *   • `waiting-for-port`  = child PID exists, polling the allocated
 *     TCP port until the dev server starts listening (or dies).
 *   • `http-probing`      = TCP listening, issuing GET / and waiting
 *     for a non-error response.
 *   • `timeout`           = the boot-budget watchdog tripped while in
 *     ANY of the above phases. Distinct from `failed` because
 *     `failed` carries an explicit error message from the runtime,
 *     `timeout` carries a deadline-exceeded marker plus a snapshot
 *     of the last known phase / stdout-tail / stderr-tail.
 */
export type PreviewStep =
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

/**
 * Discrete timeline event emitted by the PreviewManager. The set of event
 * names is fixed so downstream UIs / log scrapers can build a deterministic
 * timeline. Pair semantics:
 *   - install-end pairs with install-start (durationMs = end-start)
 *   - build-end   pairs with build-start
 *   - http-probe-ok pairs with devserver-start
 *   - url-published pairs with runner-start (whole-flow duration)
 */
export type PreviewTimelineEventName =
  | 'runner-start'
  | 'install-start'
  | 'install-end'
  | 'build-start'
  | 'build-end'
  | 'devserver-start'
  | 'port-assigned'
  | 'http-probe-ok'
  | 'url-published'
  | 'iframe-ready'
  | 'failed';

export interface PreviewTimelineEvent {
  /** Event name from the fixed vocabulary. */
  event: PreviewTimelineEventName;
  /** ISO timestamp of the event. */
  at: string;
  /** Owning project. */
  projectId: string;
  /** Snapshot of the public preview status at the moment of the event. */
  previewStatus: 'idle' | 'preparing' | 'installing' | 'building' | 'starting' | 'ready' | 'failed';
  /** For "-end" events: ms since the matching "-start". For url-published: ms since runner-start. */
  durationMs?: number;
  /** Free-form structured detail (port, imageTag, error message, etc.). */
  details?: Record<string, unknown>;
  /** Tail of stdout captured during the step (max 2 KB). */
  stdoutTail?: string;
  /** Tail of stderr captured during the step (max 2 KB). */
  stderrTail?: string;
}

export interface PreviewRecord {
  projectId: string;
  /** Stable per-start identifier — distinct from projectId because a single
   *  project can be (re)started many times and each runtime instance needs
   *  its own identity for logs / diagnostic dumps. Generated at the top of
   *  doStart()/doStartLocal()/doStartFullstack(). */
  previewId: string;
  state: PreviewState;
  stack: StackInfo | null;
  imageTag: string | null;
  containerId: string | null;
  hostPort: number | null;
  startedAt: number;
  lastAccessedAt: number;
  error: string | null;
  /** Captured build/run stderr — surfaced to UI on failure. */
  log: string;
  /** Fullstack only: docker compose project name (scopes containers/networks/volumes). */
  composeProject?: string | null;
  /** Fullstack only: host port the api service is published on. */
  apiHostPort?: number | null;
  /** Which backend produced this preview — used by stop() to know what to clean up.
   *  `local-fallback` is a local runner that was attempted AFTER a docker
   *  preview failure (one-shot fallback path); it cleans up the same way
   *  as `local`. */
  mode?: 'docker' | 'local' | 'local-fallback';
  /** Runtime-startup metadata captured for diagnostic logging. Populated as
   *  the boot progresses (cmd/cwd at spawn, port once allocated, etc). */
  runtime?: {
    type: 'docker' | 'local' | 'local-fallback' | 'fullstack';
    cmd?: string;
    args?: string[];
    cwd?: string;
    port?: number | null;
    /** Sanitised env vars passed to the child. Only NON-secret keys
     *  (PORT, HOST, NODE_ENV, …) — see SAFE_ENV_KEYS in preview-manager. */
    envSafe?: Record<string, string>;
    /** docker only — image tag built for this run. */
    imageTag?: string;
    /** docker only — container name + id (id only known after `docker run`). */
    containerName?: string;
    containerId?: string;
  };
  /** Exit / failure forensics. Populated whenever the runtime terminates
   *  unexpectedly OR when fail() is invoked. Surfaces the raw exit code +
   *  signal + truncated stdio tails directly to the UI and the persisted
   *  diagnostic file (apps/api/src/testing/last-preview-runtime-failure.json). */
  exitInfo?: {
    exitCode?: number | null;
    signal?: string | null;
    /** Whether the docker daemon recorded an OOMKill. */
    oomKilled?: boolean;
    /** docker inspect's State.Error string. */
    dockerError?: string | null;
    /** Last 4 KB of process stdout (separated from stderr — distinct from
     *  the legacy combined `log` field so downstream tooling can show
     *  errors without compile spam). */
    stdoutTail?: string;
    stderrTail?: string;
    /** Most recent successful step before exit (mirrors lastMeaningfulStep
     *  but captured AT the moment of failure so it's not overwritten by a
     *  subsequent state transition). */
    lastSuccessfulStep?: string;
    /** Stack of any thrown JS error during boot (formatted Error.stack). */
    errorStack?: string;
    /** ISO timestamp the failure was recorded. */
    capturedAt: string;
  };
  /** ISO timestamp when start() was first invoked for this record. */
  startedAtIso?: string;
  /** ISO timestamp the moment state first transitioned to 'ready'. */
  readyAtIso?: string | null;
  /** ISO timestamp the moment state first transitioned to 'failed'.
   *  Distinct from `timeoutAtIso` — `failed` is an explicit error from
   *  the runtime (exit code, build stderr, overlay match); `timeout`
   *  is the boot-watchdog tripping with no terminal verdict. */
  failedAtIso?: string | null;
  /** ISO timestamp the moment the boot-watchdog forced this run into
   *  `preview:timeout`. Set in tandem with `step: 'preview:timeout'`
   *  and `state: 'failed'` (the timeout is surfaced to the public
   *  vocabulary as a failed preview, but the structured `step` lets
   *  the UI / diagnostic dump distinguish a deadline-exceeded boot
   *  from a runtime crash). */
  timeoutAtIso?: string | null;
  /** Boot-budget (ms) that was in effect when the watchdog tripped.
   *  Mirrored to ProjectRecord.preview.previewTimeoutDurationMs. */
  timeoutDurationMs?: number | null;
  /** Whether the dev-server child process was alive at the moment the
   *  watchdog tripped (true=alive, false=dead, null=unknown). */
  childAliveAtTimeout?: boolean | null;
  /** Precise classification of WHERE in the boot pipeline a timeout
   *  stalled. Set in tandem with `timeoutAtIso` by the boot-watchdog
   *  classifier. Distinct from `step` (which records the *named*
   *  phase the record was in) because the classifier folds in the
   *  install/build/spawn/probe lifecycle booleans to produce a
   *  single-token verdict that survives downstream string
   *  formatting. Mirrored to ProjectRecord.preview.previewTimeoutCause.
   *
   *   - `install-hung`         npm install started but never finished
   *   - `build-hung`           build phase started but never finished
   *                            (docker only — local skips build)
   *   - `server-not-spawned`   no PID was ever handed back by the OS
   *                            (or boot stalled before reaching spawn)
   *   - `server-not-listening` PID exists but no TCP probe ever
   *                            connected
   *   - `http-probe-failed`    TCP opened but HTTP never returned a
   *                            usable response
   *   - `unknown`              record didn't expose enough lifecycle
   *                            signal to pick a category (extremely
   *                            rare; investigate via the dump)
   */
  timeoutCause?:
    | 'install-hung'
    | 'build-hung'
    | 'server-not-spawned'
    | 'server-not-listening'
    | 'http-probe-failed'
    | 'unknown'
    | null;
  /** Lifecycle booleans the timeout-cause classifier consumed. Carried
   *  on the record so the dump + the persisted project block can
   *  surface the raw signals the verdict was derived from (instead of
   *  asking an engineer to re-derive them from the timeline). */
  timeoutLifecycle?: {
    installStarted: boolean;
    installCompleted: boolean;
    buildStarted: boolean;
    buildCompleted: boolean;
    serverSpawned: boolean;
    portOpened: boolean;
    firstProbeAttempted: boolean;
  } | null;
  /** Server-process liveness snapshot — populated whenever the
   *  manager observes the child process state (boot watchdog,
   *  runtime-exit, fail()). Distinct from `runtimeLog` because this
   *  carries the CLASSIFIED lifecycle verdict ("crashed" / "alive-
   *  hanging" / "alive-not-reachable" / "no-process" / "exited-clean")
   *  along with the raw timing fields the classifier was derived
   *  from. The dashboard renders this as the "Process: …" chip on
   *  the preview-failed card. */
  processLifecycle?: {
    /** ISO timestamp the child was successfully spawned. `null` when
     *  spawn never succeeded (no-process). */
    startedAt: string | null;
    /** ISO timestamp the `exit` event fired. `null` while alive. */
    exitedAt: string | null;
    /** Exit code from the child (typically 0=clean, non-zero=crash). */
    exitCode: number | null;
    /** Signal that terminated the child (SIGKILL, SIGTERM, …). */
    signal: string | null;
    /** Liveness verdict at observation time (`true`=alive,
     *  `false`=exited, `null`=unknown — no PID was captured). */
    alive: boolean | null;
    /** PID of the child. `null` before spawn or after it could not
     *  be determined. */
    pid: number | null;
    /** Wall-clock duration (ms) the process ran before the snapshot.
     *  Computed from `startedAt`. `null` when startedAt is null. */
    uptimeMs: number | null;
    /** Single-line classification of the lifecycle state:
     *   - `no-process`           ── spawn never succeeded; PID never
     *                              materialised.
     *   - `crashed`              ── process exited with a non-zero
     *                              code or a fatal signal.
     *   - `exited-clean`         ── process exited with code 0
     *                              (unexpected during boot — should
     *                              have stayed running until ready).
     *   - `alive-hanging`        ── process is alive but no HTTP probe
     *                              ever connected (TCP never opened).
     *   - `alive-not-reachable`  ── process is alive AND TCP connected
     *                              but HTTP never returned a usable
     *                              response (overlay / 5xx / hang).
     *   - `alive-healthy`        ── only emitted post-ready; here for
     *                              shape completeness. */
    classification:
      | 'no-process'
      | 'crashed'
      | 'exited-clean'
      | 'alive-hanging'
      | 'alive-not-reachable'
      | 'alive-healthy';
    /** ISO timestamp this snapshot was captured. */
    capturedAt: string;
  } | null;
  /** Live runtime-log snapshot updated during preview startup. Carries
   *  the child pid + cmd + cwd + assigned port + tail of stdout/stderr.
   *  Populated by the boot-watchdog so a stuck preview can be
   *  diagnosed from the persisted project record alone. */
  runtimeLog?: {
    pid: number | null;
    cmd: string | null;
    cwd: string | null;
    port: number | null;
    stdoutTail: string | null;
    stderrTail: string | null;
    capturedAt: string;
  };
  /** Free-form description of the most recent lifecycle event (mirrors
   *  ProjectRecord.progress.lastMeaningfulStep semantics). */
  lastMeaningfulStep?: string;
  /** In-flight project-store sync promise. Set by `markPreviewStep`
   *  on every state transition, awaited by terminal paths (ready /
   *  failed) before returning to the caller so the persisted
   *  ProjectRecord.preview reflects the new state before the HTTP
   *  response lands. Resolves with the write result; never rejects. */
  pendingSync?: Promise<{
    ok: boolean;
    prevPreviewStatus: string | null;
    nextPreviewStatus: string | null;
    error?: string;
  }> | null;
  /** Monotonically increasing list of (stateOrStep, isoTimestamp) tuples
   *  for post-mortem debugging. Trimmed to the last 32 entries. */
  history?: Array<{ step: string; at: string }>;
  /** Discrete timeline events (runner-start, install-start, build-end, …)
   *  used by the dashboard to explain the gap between generation completion
   *  and a visible iframe. Trimmed to the last 64 entries. */
  timeline?: PreviewTimelineEvent[];
  /** Current fine-grained boot phase. Updated by `enterStep()` on every
   *  phase transition. Drives the UI's "preview died during X" message. */
  step?: PreviewStep;
  /** ISO timestamp the current `step` started. */
  stepStartedAt?: string;
  /** ISO timestamp the current `step` completed (only set once the
   *  phase ends — either by transitioning forward or by entering
   *  preview:failed/preview:ready). */
  stepCompletedAt?: string | null;
  /** Append-only durations log (oldest → newest). One entry per
   *  completed phase: `{ step, startedAt, completedAt, durationMs }`.
   *  Capped at 16 entries. */
  stepDurations?: Array<{
    step: PreviewStep;
    startedAt: string;
    completedAt: string;
    durationMs: number;
  }>;
  /** Populated when this record represents the second attempt of a
   *  one-shot fallback chain (docker → local). `docker` holds the
   *  composed error from the failed docker attempt; `local` is filled
   *  in if the fallback ALSO fails so the UI can surface both reasons. */
  fallbackErrors?: {
    docker?: string | null;
    local?: string | null;
  };
  /** One row per attempt of the local-runner start() call. Capped at
   *  two entries (initial + one safe retry). The retry only fires
   *  when the first attempt failed BEFORE any TCP probe connected
   *  to the port — install/build/spawn/port-listening failures are
   *  the intermittent class we want to recover from. Once any probe
   *  reports tcpConnected=true (or HTTP 200), we treat the failure
   *  as deterministic (overlay, content-health, post-bind crash) and
   *  do not retry. Mirrored to ProjectRecord.preview.previewLocalStartAttempts. */
  localStartAttempts?: Array<{
    attempt: 1 | 2;
    ok: boolean;
    error: string | null;
    portOpened: boolean;
    durationMs: number;
    startedAtIso: string;
    endedAtIso: string;
  }>;
  /** Set when a second local-runner attempt was scheduled. `true` if
   *  the retry succeeded (preview reached ready), `false` if the
   *  retry also failed, `undefined` if no retry was attempted.
   *  Mirrored to ProjectRecord.preview.previewLocalRetrySucceeded. */
  localRetrySucceeded?: boolean;
  /** Set when the content-health probe (post-HTTP-200) detected a dev
   *  server overlay/error page. Populated INSTEAD of marking ready:
   *  `state` flips to 'failed' and `error` is composed from these
   *  fields. The UI surfaces `detectedErrorType` as a category badge,
   *  `affectedModule` as a copyable chip, and `detectedErrorMessage`
   *  as the human-readable headline. */
  overlayDetection?: {
    detectedErrorType: string;
    detectedErrorMessage: string;
    affectedModule?: string;
    /** ISO timestamp the probe matched. */
    detectedAt: string;
    /** First 2 KB of the body that triggered the match — useful for
     *  the postmortem dump. */
    bodySample?: string;
  };
  /** Dependency-preflight fixes applied immediately before staging
   *  files for this preview run. Populated when bare-module imports
   *  in the persisted source tree referenced packages that were
   *  missing from package.json (e.g. `class-variance-authority`).
   *  Each entry records the name, pinned version, reason, and the
   *  importing files — the dashboard renders this as the "auto-fixed
   *  dependencies" chip in the preview panel. */
  dependencyFixes?: Array<{
    packageName: string;
    version: string;
    reason: 'imported-not-declared';
    requiredBy: string[];
    packageJson: string;
    block: 'dependencies' | 'devDependencies';
    fixedAt: string;
  }>;
  /** Per-attempt preview-boot history when the auto-fix retry loop
   *  was engaged. Populated by `PreviewManager.start()` whenever a
   *  failed boot was classified as auto-fixable, a fix was applied,
   *  and the preview was retried. The ARRAY is append-only across
   *  attempts within a single `start()` invocation; index 0 is the
   *  initial boot, index 1 is the first auto-retry, etc.
   *
   *  Capped at `MAX_PREVIEW_FIX_ATTEMPTS` (=2) entries — beyond that
   *  the loop gives up and surfaces the latest error to the UI. */
  previewFixAttempts?: PreviewFixAttempt[];
  /** Append-only ring buffer of every HTTP probe issued against the
   *  preview's host port during the readiness wait — capped at the
   *  last `MAX_PROBE_ATTEMPTS` entries (see local-runner). Used by
   *  `dumpPreviewTimeout` to classify a stuck boot as one of:
   *  port-never-opened / tcp-opened-no-http / http-error-status /
   *  http-not-ready (i.e. 200 but content-health rejected it). */
  probeAttempts?: import('./probe-recorder.js').ProbeAttempt[];
  /** Roll-up classification of `probeAttempts`, computed at the
   *  moment the boot-watchdog or `fail()` fires. Persisted alongside
   *  the raw attempts so the project record carries a single
   *  human-readable "what kind of failure?" verdict. */
  probeRollup?: {
    kind: import('./probe-recorder.js').ProbeRollup;
    total: number;
    tcpEverConnected: boolean;
    httpEverResponded: boolean;
    lastStatus: number | null;
    /** ISO. */
    capturedAt: string;
  };
}

/**
 * One row in `PreviewRecord.previewFixAttempts` / `PreviewStatus
 * .previewFixAttempts`. Records the outcome of one attempt at booting
 * the preview AND the fix (if any) applied between this attempt and
 * the next. The dashboard renders this as a vertical timeline with a
 * "fix applied → retry succeeded" chip.
 */
export interface PreviewFixAttempt {
  /** 1-based attempt index. 1 = initial boot, 2 = first auto-retry. */
  attempt: number;
  /** ISO timestamp this attempt's preview boot started. */
  startedAt: string;
  /** ISO timestamp this attempt finished (preview ready OR failed). */
  finishedAt: string;
  /** Boot outcome at finish time. */
  outcome: 'ready' | 'failed';
  /** Backend that ran this attempt. Mirrors `PreviewRecord.runtime.type`. */
  runtime?: 'docker' | 'local' | 'local-fallback' | 'fullstack';
  /** Composed `record.error` string at finish time (truncated to ~2 KB).
   *  Only set when `outcome === 'failed'`. */
  error?: string | null;
  /** Classifier verdict for the failed attempt. Drives the gate
   *  decision for whether a retry was triggered. */
  classification?: {
    kind: 'missing-package' | 'unknown';
    missingPackage?: string;
    file?: string;
    message: string;
    autoFixable: boolean;
  };
  /** Auto-fix that was applied AFTER this attempt failed and BEFORE
   *  the next attempt was scheduled. Absent when the loop chose not
   *  to retry (classification `autoFixable: false`, attempt cap hit,
   *  or the fix injector reported a no-op). */
  fixApplied?: {
    kind: 'add-missing-dependency';
    packageName: string;
    version: string;
    block: 'dependencies' | 'devDependencies';
    packageJson: string;
    appliedAt: string;
  };
  /** True when the loop scheduled another preview boot AFTER this
   *  attempt. Mutually exclusive with `outcome === 'ready'`. */
  retryTriggered: boolean;
  /** Reason the retry was NOT triggered when `outcome === 'failed'
   *  && retryTriggered === false`. Drives the dashboard's "we
   *  couldn't auto-fix because…" line. */
  retrySkippedReason?:
    | 'not-auto-fixable'
    | 'already-attempted'
    | 'fix-injector-no-op'
    | 'attempt-cap-reached';
}

export interface PreviewStatus {
  projectId: string;
  state: PreviewState;
  stack: StackKind | null;
  url: string | null;
  hostPort: number | null;
  /** Fullstack only: host port the api service is published on. */
  apiHostPort?: number | null;
  error: string | null;
  log: string;
  uptimeMs: number;
  /** True when state === 'fallback' — caller should render frontend-only static preview. */
  fallback?: boolean;
  /** Reason for fallback (e.g. 'docker-unavailable'). */
  fallbackReason?: 'docker-unavailable' | 'boot-failed' | null;
  /** User-facing notice to display in the preview UI. */
  notice?: string;
  /** Which backend served this preview. Absent for stale/idle records. */
  mode?: 'docker' | 'local' | 'local-fallback';
  /** ISO timestamp when start() was first invoked. */
  startedAtIso?: string;
  /** ISO timestamp the moment state transitioned to 'ready' (null until then). */
  readyAtIso?: string | null;
  /** ISO timestamp the moment state transitioned to 'failed'. */
  failedAtIso?: string | null;
  /** ISO timestamp the moment the boot-watchdog forced timeout. */
  timeoutAtIso?: string | null;
  /** Live runtime-log snapshot (pid + cmd + cwd + port + stdout/stderr tails). */
  runtimeLog?: PreviewRecord['runtimeLog'];
  /** Most recent lifecycle event description. */
  lastMeaningfulStep?: string;
  /** Last 32 lifecycle transitions (oldest → newest). */
  history?: Array<{ step: string; at: string }>;
  /** Last 64 discrete timeline events. */
  timeline?: PreviewTimelineEvent[];
  /** Per-start identifier — present on every materialised record (idle/
   *  fallback synthetic responses don't have one). */
  previewId?: string;
  /** Forensic exit info attached when the runtime terminated abnormally.
   *  Mirrored verbatim onto the UI's `previewError` and the persisted
   *  diagnostic dump file. */
  exitInfo?: PreviewRecord['exitInfo'];
  /** Current boot phase (preview:queued → preview:ready / preview:failed). */
  step?: PreviewStep;
  /** ISO timestamp the current `step` started. */
  stepStartedAt?: string;
  /** ISO timestamp the current `step` completed (preview:ready or
   *  preview:failed only — running phases have this null). */
  stepCompletedAt?: string | null;
  /** Per-phase duration log. */
  stepDurations?: PreviewRecord['stepDurations'];
  /** Both errors when a docker→local fallback chain ended in failure. */
  fallbackErrors?: PreviewRecord['fallbackErrors'];
  /** Dev-overlay detection from the content-health probe (when the
   *  preview reached a 200 response but the body contained a Next.js /
   *  Vite / generic build-error overlay). `state === 'failed'` whenever
   *  this is set. */
  overlayDetection?: PreviewRecord['overlayDetection'];
  /** Auto-fixes applied by the dependency-preflight gate (missing
   *  package.json entries inferred from import statements). Empty
   *  when the codebase was already self-consistent. */
  dependencyFixes?: PreviewRecord['dependencyFixes'];
  /** Per-attempt history when the auto-fix retry loop was engaged.
   *  Mirrors `PreviewRecord.previewFixAttempts` for downstream UIs. */
  previewFixAttempts?: PreviewRecord['previewFixAttempts'];
  /** Last N HTTP probe attempts (mirrors `PreviewRecord.probeAttempts`). */
  probeAttempts?: PreviewRecord['probeAttempts'];
  /** Roll-up classification of `probeAttempts`. */
  probeRollup?: PreviewRecord['probeRollup'];
}
