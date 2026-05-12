// ─────────────────────────────────────────────────────────────
// Preview manager — orchestrates per-project container lifecycle.
//
//   start(projectId)
//     └─ detect stack → build image → run container → wait healthy
//        → register and return URL
//
//   stop(projectId)        idempotent
//   getStatus(projectId)   for UI polling
//   touch(projectId)       extends idle TTL when proxy traffic flows
//
// Concurrency caps + idle TTL prevent the host from drowning when
// many projects are being tested back-to-back.
// ─────────────────────────────────────────────────────────────

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { PreviewHealthStatus, PreviewLifecycleStatus } from '@devteam/types';
import type { ProjectStore } from '../storage/project-store.js';
import type { DockerRunner } from './docker-runner.js';
import type { PortAllocator } from './port-allocator.js';
import type { LocalPreviewRunner } from './local-runner.js';
import type { PreviewFixAttempt, PreviewRecord, PreviewState, PreviewStatus, PreviewStep, PreviewTimelineEvent, PreviewTimelineEventName, StackInfo } from './types.js';
import { rollupProbes, type ProbeAttempt } from './probe-recorder.js';
import { detectStack, isRunnableStack } from './stack-detector.js';
import { getDockerfile, bootBudgetMs } from './dev-dockerfiles.js';
import { validateProjectFilesForPreview, describePreviewFileIssue } from './preview-file-validator.js';
import {
  probePreviewContent,
  type DevOverlayDetection,
  type PreviewContentProbeResult,
} from './preview-content-health.js';
import {
  runPreviewDependencyPreflight,
  applyForcedDependencyFix,
  type DependencyFix,
  type ForcedDependencyFixResult,
} from './preview-dependency-preflight.js';
import {
  classifyPreviewError,
  isAutoFixablePreviewError,
  type PreviewErrorClassification,
} from './preview-error-classifier.js';

/**
 * Compose merges `ports:` lists across base+override files (concat, not
 * replace). Generated docker-compose.yml typically hardcodes "3000:3000" /
 * "4000:4000" which collide with a busy host port. We rewrite the staged
 * compose file to strip top-level `ports:` from web/api services so our
 * override is the only source of host bindings. Also strips published
 * postgres ports — only the override (or compose network) should expose db.
 *
 * This is a conservative line-based YAML edit: the generated file uses
 * canonical 2-space indentation per builder convention.
 */
async function stripPublishedPortsForOverride(contextDir: string, log: (s: string) => void): Promise<void> {
  const candidates = ['docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml'];
  let found: string | null = null;
  for (const name of candidates) {
    const p = path.join(contextDir, name);
    try { await fs.access(p); found = p; break; } catch { /* next */ }
  }
  if (!found) return;
  let raw: string;
  try { raw = await fs.readFile(found, 'utf8'); } catch { return; }
  const lines = raw.split(/\r?\n/);
  const out: string[] = [];
  // Track service we're inside (top-level under `services:`) so we only
  // strip ports for web/api/postgres. Indentation: services nested at 2 spaces.
  let inServices = false;
  let currentService: string | null = null;
  let skippingPortsBlock = false;
  let portsIndent = 0;
  let stripped = 0;

  const indentOf = (s: string) => s.match(/^[ \t]*/)?.[0].length ?? 0;

  for (const line of lines) {
    if (/^services\s*:\s*$/.test(line)) { inServices = true; out.push(line); continue; }
    if (inServices && /^\S/.test(line)) { inServices = false; currentService = null; }

    if (inServices) {
      const m = line.match(/^  ([A-Za-z0-9_-]+)\s*:\s*$/);
      if (m) { currentService = m[1]; skippingPortsBlock = false; out.push(line); continue; }
    }

    if (skippingPortsBlock) {
      const ind = indentOf(line);
      // Continue skipping while still inside the ports block (deeper indent or list items at same indent).
      if (line.trim() === '' || ind > portsIndent || (ind === portsIndent && /^\s*-\s/.test(line))) {
        // skip
        continue;
      }
      skippingPortsBlock = false;
      // fall through to push current line
    }

    if (currentService && (currentService === 'web' || currentService === 'api' || currentService === 'postgres')) {
      const m = line.match(/^(\s+)ports\s*:\s*(\[\s*\])?\s*$/);
      if (m && indentOf(line) === 4) {
        // start skipping list children if this is the YAML block form
        if (!m[2]) { skippingPortsBlock = true; portsIndent = 4; }
        stripped++;
        continue;
      }
    }
    out.push(line);
  }
  if (stripped > 0) {
    try {
      await fs.writeFile(found, out.join('\n'), 'utf8');
      log(`stripPublishedPortsForOverride: removed ${stripped} ports: block(s) from ${path.basename(found)}`);
    } catch (err) {
      log(`stripPublishedPortsForOverride: write failed: ${(err as Error).message}`);
    }
  }
}

/**
 * Structured failure context handed to `PreviewManager.fail()`. Replaces
 * the previous bare-string signature so we can preserve every field that
 * matters for post-mortem triage: exit code, signal, stdout/stderr
 * tails, the last successful step before the crash, and (for docker)
 * the OOM flag and `State.Error`. The `reason` field is the short human
 * summary used as the headline; the rest are appended below it.
 */
interface FailureContext {
  reason: string;
  exitCode?: number | null;
  signal?: NodeJS.Signals | string | null;
  oomKilled?: boolean;
  dockerError?: string | null;
  stdoutTail?: string;
  stderrTail?: string;
  lastSuccessfulStep?: string;
  stack?: string;
  /** Dev-overlay detection from the content-health probe. When present
   *  this becomes the canonical record of WHY the preview was rejected
   *  even though HTTP responded — the UI shows `detectedErrorType` as
   *  a category badge and `affectedModule` as a copy chip. */
  overlayDetection?: DevOverlayDetection & { bodySample?: string };
}

/**
 * Compose the multi-line `previewError` string surfaced to the UI.
 * Skips fields that don't carry signal so we don't spam "exitCode: n/a,
 * signal: none" on every failure.
 */
function composeFailureMessage(ctx: FailureContext): string {
  const out: string[] = [ctx.reason];
  // Surface the dev-overlay detection FIRST (after the reason headline)
  // because it's almost always the most actionable signal — "Module
  // not found: 'class-variance-authority'" is far more useful than
  // "stderr tail" when the dev server itself is healthy.
  if (ctx.overlayDetection) {
    const o = ctx.overlayDetection;
    const bits = [`type=${o.detectedErrorType}`];
    if (o.affectedModule) bits.push(`module="${o.affectedModule}"`);
    out.push(`dev-overlay: ${bits.join(' ')}`);
    out.push(`overlay message: ${o.detectedErrorMessage}`);
  }
  const exit: string[] = [];
  if (ctx.exitCode !== undefined && ctx.exitCode !== null) exit.push(`exitCode=${ctx.exitCode}`);
  if (ctx.signal) exit.push(`signal=${ctx.signal}`);
  if (ctx.oomKilled) exit.push('oomKilled=true');
  if (exit.length > 0) out.push(exit.join(' '));
  if (ctx.dockerError) out.push(`docker: ${ctx.dockerError}`);
  if (ctx.lastSuccessfulStep) out.push(`last successful step: ${ctx.lastSuccessfulStep}`);
  const stderrTail = ctx.stderrTail?.trim();
  const stdoutTail = ctx.stdoutTail?.trim();
  if (stderrTail) out.push(`stderr tail:\n${stderrTail.slice(-1_500)}`);
  else if (stdoutTail) out.push(`stdout tail:\n${stdoutTail.slice(-1_500)}`);
  return out.join('\n');
}

/**
 * Env keys that are safe to log + persist in the diagnostic dump. NEVER
 * include process.env wholesale — that would leak secrets like API keys.
 * Match the set forwarded by local-runner's spawn() call.
 */
const SAFE_ENV_KEYS = [
  'PORT', 'HOST', 'HOSTNAME', 'NODE_ENV', 'CI',
  'BROWSER', 'FORCE_COLOR', 'NO_COLOR',
  'NEXT_TELEMETRY_DISABLED', 'NEXT_PUBLIC_API_URL',
] as const;

function pickSafeEnv(env: NodeJS.ProcessEnv | Record<string, string | undefined>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SAFE_ENV_KEYS) {
    const v = env[k];
    if (typeof v === 'string') out[k] = v;
  }
  return out;
}

/**
 * Lifecycle booleans the timeout-cause classifier consumes. Computed
 * from the union of the manager-side `PreviewRecord` (timeline + step
 * history + probe attempts) and the local-runner's record (when
 * present — local previews carry richer install/spawn signal than
 * docker). Pure function; no side effects.
 */
interface TimeoutLifecycleSignals {
  installStarted: boolean;
  installCompleted: boolean;
  buildStarted: boolean;
  buildCompleted: boolean;
  serverSpawned: boolean;
  portOpened: boolean;
  firstProbeAttempted: boolean;
}

type TimeoutCause =
  | 'install-hung'
  | 'build-hung'
  | 'server-not-spawned'
  | 'server-not-listening'
  | 'http-probe-failed'
  | 'unknown';

/**
 * Derive the lifecycle booleans from a PreviewRecord + (optional)
 * LocalPreviewRecord. Each field reflects "did the named phase
 * START / COMPLETE successfully before the watchdog tripped?".
 *
 * The local-runner's own state takes precedence for install/spawn
 * because it observes those phases directly (vs the manager which
 * only sees the timeline events the manager itself records).
 */
function computeTimeoutLifecycle(
  record: PreviewRecord,
  lr: { installMode: 'standard' | 'legacy-peer-deps-fallback' | null;
        processStartedAt: string | null;
        child: { pid?: number } | null;
        probeAttempts: ProbeAttempt[];
        lastSuccessfulStep: string;
      } | null,
): TimeoutLifecycleSignals {
  const timeline = record.timeline ?? [];
  const has = (name: string) => timeline.some((e) => e.event === name);
  const hasOk = (name: string) => timeline.some((e) => {
    if (e.event !== name) return false;
    const details = e.details as { ok?: unknown } | undefined;
    return details?.ok !== false;
  });
  const stepReached = (steps: PreviewStep[]) => {
    const history = record.history ?? [];
    return history.some((h) => steps.some((s) => h.step === s));
  };

  // Install: started either when the timeline event fired or when
  // the manager actually entered preview:installing. Completed when
  // install-end timeline event landed with ok!==false, OR when the
  // local runner stamped an installMode (covers both standard and
  // --legacy-peer-deps fallback success), OR when the runner's own
  // lastSuccessfulStep mentions install completion / cache hit.
  const installStarted =
    has('install-start')
    || stepReached(['preview:installing', 'preview:building', 'preview:spawning-server', 'preview:waiting-for-port', 'preview:http-probing']);
  const installCompleted =
    hasOk('install-end')
    || (lr?.installMode != null)
    || /install completed/i.test(lr?.lastSuccessfulStep ?? '')
    || /install cache hit/i.test(lr?.lastSuccessfulStep ?? '')
    || stepReached(['preview:building', 'preview:spawning-server', 'preview:waiting-for-port', 'preview:http-probing']);

  // Build: docker-only phase. Local runner skips it entirely so
  // `buildStarted` stays false there — that's correct; the
  // classifier prioritises install-hung over build-hung anyway.
  const buildStarted = has('build-start') || stepReached(['preview:building']);
  const buildCompleted = hasOk('build-end')
    || stepReached(['preview:spawning-server', 'preview:waiting-for-port', 'preview:http-probing']);

  // Server spawned: local-runner stamps processStartedAt the moment
  // child.pid is populated; manager records a devserver-start
  // timeline event when it issues the spawn. EITHER signal counts
  // (docker doesn't emit processStartedAt; local doesn't always
  // emit devserver-start before exit).
  const serverSpawned =
    (lr?.processStartedAt != null)
    || (typeof lr?.child?.pid === 'number')
    || has('devserver-start')
    || stepReached(['preview:waiting-for-port', 'preview:http-probing']);

  // Port opened: any probe attempt reported tcpConnected=true (or
  // the rarer ok=true). Driven by the unified probe-attempts buffer
  // mirrored onto `record.probeAttempts`. Local-runner attempts are
  // mirrored there too.
  const probeAttempts = record.probeAttempts ?? [];
  const portOpened = probeAttempts.some((a) => a.tcpConnected || a.ok)
    || (lr?.probeAttempts ?? []).some((a) => a.tcpConnected || a.ok);

  // First probe attempted: did we ever even *try* an HTTP probe? A
  // 'true' here with portOpened=false is the canonical
  // "server-not-listening" signature.
  const firstProbeAttempted = probeAttempts.length > 0
    || (lr?.probeAttempts ?? []).length > 0
    || stepReached(['preview:http-probing']);

  return {
    installStarted,
    installCompleted,
    buildStarted,
    buildCompleted,
    serverSpawned,
    portOpened,
    firstProbeAttempted,
  };
}

/**
 * Map lifecycle signals to a single timeout cause. Order matters —
 * earlier-failing phases mask later ones (an install-hung run never
 * gets a chance to spawn the server, so we should NOT classify it as
 * `server-not-spawned`).
 */
function classifyTimeoutCause(s: TimeoutLifecycleSignals): TimeoutCause {
  if (s.installStarted && !s.installCompleted) return 'install-hung';
  if (s.buildStarted && !s.buildCompleted) return 'build-hung';
  if (!s.serverSpawned) return 'server-not-spawned';
  if (!s.portOpened) return 'server-not-listening';
  // serverSpawned && portOpened — TCP responded but readiness still
  // never resolved. Either HTTP attempts kept failing, or the
  // content-health gate kept rejecting responses.
  if (s.firstProbeAttempted) return 'http-probe-failed';
  // Spawned + (port marked opened?) but never even tried a probe.
  // Vanishingly rare; investigate via the dump.
  return 'unknown';
}

/** Single-line human-readable explanation per cause. Used inside the
 *  composed `previewError` headline so the dashboard quote leads
 *  with the precise category. */
function describeTimeoutCause(cause: TimeoutCause): string {
  switch (cause) {
    case 'install-hung':         return 'install never finished (npm install started but did not complete before the budget)';
    case 'build-hung':           return 'build never finished (docker build started but did not complete before the budget)';
    case 'server-not-spawned':   return 'dev server was never spawned (no PID was handed back by the OS)';
    case 'server-not-listening': return 'dev server was spawned but never opened its TCP port (alive but not listening)';
    case 'http-probe-failed':    return 'TCP port opened but HTTP never returned a usable response (probes connected but readiness never resolved)';
    case 'unknown':              return 'cause indeterminate from lifecycle signals — see last-preview-timeout.json';
  }
}

function newPreviewId(): string {
  return randomBytes(6).toString('hex');
}

/**
 * Maximum number of preview boot attempts the auto-fix retry loop
 * will perform per `start()` call. Set to 2 (= one initial boot + one
 * auto-retry after applying a forced dependency fix). Bumping this
 * higher than 2 invites a tight loop when a bad overlay keeps
 * reporting the SAME missing module — the per-loop `attemptedFixes`
 * dedupe helps but the cap is the hard ceiling.
 */
const MAX_PREVIEW_FIX_ATTEMPTS = 2;

/**
 * Wall-clock budget for a single preview-boot attempt. When this fires
 * with the record still in a non-terminal state (anything other than
 * `ready` / `failed`), the boot watchdog flips the record into
 * `preview:timeout`, stamps `timeoutAtIso`, dumps a forensic JSON to
 * `apps/api/src/testing/last-preview-timeout.json`, and best-effort
 * tears down the underlying container / local process so the awaiting
 * boot promise resolves promptly. Distinct from the runner-internal
 * timeouts (LocalPreviewRunner's READY_TIMEOUT_MS, docker
 * awaitHealthy's bootBudgetMs) because those only fire on a SPECIFIC
 * step — this one fires when the OVERALL boot has been stuck no
 * matter which phase it's in.
 *
 * Set deliberately below the diagnostic harness's
 * PREVIEW_READY_TIMEOUT_MS (180s) so the manager's structured timeout
 * verdict is visible to the harness BEFORE the harness gives up — the
 * harness can then pick up the dump file rather than reporting a bare
 * "preview never reached ready".
 */
const PREVIEW_BOOT_TIMEOUT_MS = 150_000;

/**
 * Overall wall-clock budget for `startWithAutoFixRetry` — i.e. the
 * sum of every retry attempt + auto-fix work in between. Distinct
 * from `PREVIEW_BOOT_TIMEOUT_MS` (which is per-attempt) because the
 * auto-fix loop can run up to `MAX_PREVIEW_FIX_ATTEMPTS` attempts
 * back-to-back; without a global cap, two consecutive 150s attempts
 * would race past the diagnostic harness's 180s preview gate, leaving
 * `last-preview-timeout.json` unwritten and the project record stuck
 * showing previewStatus='starting'.
 *
 * Set to 165s so the manager-side watchdog reliably wins the race
 * against the harness's `PREVIEW_READY_TIMEOUT_MS` (180s) and the
 * timeout dump is always captured before the harness gives up.
 */
const PREVIEW_OVERALL_BOOT_BUDGET_MS = 165_000;

/** Path of the on-timeout forensic dump. Always written to a single
 *  fixed path (no per-run fan-out) so the most recent timeout is easy
 *  to grep for in CI output / engineer triage. Resolved at call time
 *  via `import.meta.url` (matches the pattern used by
 *  `dumpRuntimeFailure`). */
function previewTimeoutDumpPath(): string {
  return path.resolve(
    fileURLToPath(import.meta.url),
    '..', '..', 'testing', 'last-preview-timeout.json',
  );
}

export interface PreviewManagerOptions {
  projectStore: ProjectStore;
  docker: DockerRunner;
  ports: PortAllocator;
  logger: Logger;
  /** Optional Docker fallback that runs `npm run dev` directly on the host. */
  localRunner?: LocalPreviewRunner;
  /** Max concurrent running preview containers. Beyond this, oldest is evicted. */
  maxConcurrent?: number;
  /** Stop a container after this many ms of no proxy traffic. */
  idleTtlMs?: number;
  /** Build timeout. */
  buildTimeoutMs?: number;
}

export class PreviewManager {
  private records = new Map<string, PreviewRecord>();
  /** projectId → in-flight start() promise so concurrent callers share one boot. */
  private starting = new Map<string, Promise<PreviewStatus>>();
  private readonly opts: Required<Omit<PreviewManagerOptions, 'projectStore' | 'docker' | 'ports' | 'logger' | 'localRunner'>> &
    Pick<PreviewManagerOptions, 'projectStore' | 'docker' | 'ports' | 'logger' | 'localRunner'>;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private dockerAvailable: boolean | null = null;
  private localAvailable: boolean | null = null;

  /**
   * Update preview lifecycle metadata on a record. Always called instead of
   * raw `record.state = ...` assignments so we get:
   *   - lastMeaningfulStep (free-form text matching ProjectRecord.progress)
   *   - readyAtIso captured the first time state hits 'ready'
   *   - history (last 32 transitions, oldest → newest) for post-mortem
   *   - a structured log line on every transition
   */
  private markPreviewStep(
    record: PreviewRecord,
    nextState: PreviewState,
    step: string,
  ): void {
    const at = new Date().toISOString();
    const prevState = record.state;
    const prevPublic = this.toPublicPreviewStatus(prevState, record);
    const nextPublic = this.toPublicPreviewStatus(nextState, record);
    record.state = nextState;
    record.lastMeaningfulStep = step;
    if (nextState === 'ready' && !record.readyAtIso) record.readyAtIso = at;
    if (!record.startedAtIso) record.startedAtIso = new Date(record.startedAt).toISOString();
    record.history = record.history ?? [];
    record.history.push({ step: `${nextState}:${step}`, at });
    if (record.history.length > 32) record.history = record.history.slice(-32);
    this.opts.logger.info('preview:step', {
      projectId: record.projectId,
      state: nextState,
      step,
      // Status transition surfaced explicitly so a single grep on
      // `previewStatus` shows the full trajectory queued → building →
      // starting → ready (or → failed) without needing to translate
      // PreviewState → public previewStatus mentally.
      prevPreviewStatus: prevPublic,
      newPreviewStatus: nextPublic,
      llmCalled: false,
    });

    // Mirror onto ProjectRecord.preview so polling clients of GET
    // /api/projects/:id can drive UI off a single source of truth
    // without having to fan-out a second request to /preview/status.
    // Decoupled from project.status (which stays generation-only).
    //
    // The promise is stored on `record.pendingSync` so that callers
    // who NEED durability before returning to the client (the ready /
    // failed terminal paths) can `await record.pendingSync` instead
    // of issuing a redundant write. Per-project lock in the store
    // serialises queued writes, so awaiting the latest also waits for
    // anything previously queued. Errors are surfaced via the result
    // object — `syncPreviewToProject` itself never throws.
    record.pendingSync = this.syncPreviewToProject(record);
  }

  /** Translate internal PreviewState → public previewStatus vocabulary. */
  private toPublicPreviewStatus(
    state: PreviewState,
    record?: PreviewRecord,
  ): PreviewLifecycleStatus {
    switch (state) {
      case 'ready':
        return 'ready';
      case 'failed':
      case 'fallback':
        return 'failed';
      case 'starting': {
        const hasReachableSignal = Boolean(
          record?.timeline?.some((event) => event.event === 'http-probe-ok')
          || record?.probeAttempts?.some((attempt) => attempt.tcpConnected || attempt.ok || typeof attempt.status === 'number'),
        );
        return hasReachableSignal ? 'reachable' : 'starting';
      }
      case 'building':
        return 'building';
      case 'installing':
        return 'installing';
      case 'detecting':
      case 'preparing':
        return 'preparing';
      case 'idle':
      case 'stopped':
      default:
        return 'idle';
    }
  }

  private toPublicPreviewHealth(
    record: PreviewRecord,
    status: PreviewLifecycleStatus,
  ): PreviewHealthStatus {
    if (record.overlayDetection) return 'broken';
    if (status === 'ready') return 'healthy';
    const errorText = `${record.error ?? ''}\n${record.log ?? ''}\n${record.exitInfo?.stderrTail ?? ''}`;
    if (/placeholder|lorem ipsum|coming soon|under construction|not implemented|stub/i.test(errorText)) {
      return 'placeholder';
    }
    if (status === 'failed') return 'broken';
    return 'unknown';
  }

  private async syncPreviewToProject(record: PreviewRecord): Promise<{
    ok: boolean;
    prevPreviewStatus: string | null;
    nextPreviewStatus: string | null;
    error?: string;
  }> {
    const previewStatus = this.toPublicPreviewStatus(record.state, record);
    const previewHealth = this.toPublicPreviewHealth(record, previewStatus);
    const url = record.state === 'ready' && record.hostPort != null
      ? `/preview/${record.projectId}/`
      : null;
    let result: {
      ok: boolean;
      prevPreviewStatus: string | null;
      nextPreviewStatus: string | null;
      stateVersion: number;
      error?: string;
    };
    try {
      result = await this.opts.projectStore.updatePreview(record.projectId, {
        previewStatus,
        previewHealth,
        previewReady: previewStatus === 'ready' && previewHealth === 'healthy',
        previewUrl: url,
      previewStartedAt: record.startedAtIso ?? null,
      previewReadyAt: record.readyAtIso ?? null,
      previewFailedAt: record.failedAtIso ?? null,
      previewTimeoutAt: record.timeoutAtIso ?? null,
      previewTimeoutDurationMs: record.timeoutDurationMs ?? null,
      previewChildAlive: record.childAliveAtTimeout ?? null,
      previewTimeoutCause: record.timeoutCause ?? null,
      previewTimeoutLifecycle: record.timeoutLifecycle ?? null,
      previewProcessLifecycle: record.processLifecycle
        ? {
            startedAt: record.processLifecycle.startedAt,
            exitedAt: record.processLifecycle.exitedAt,
            exitCode: record.processLifecycle.exitCode,
            signal: record.processLifecycle.signal,
            alive: record.processLifecycle.alive,
            pid: record.processLifecycle.pid,
            uptimeMs: record.processLifecycle.uptimeMs,
            classification: record.processLifecycle.classification,
            capturedAt: record.processLifecycle.capturedAt,
          }
        : null,
      previewError: record.error ?? null,
      previewRuntimeLog: record.runtimeLog
        ? {
            pid: record.runtimeLog.pid,
            cmd: record.runtimeLog.cmd,
            cwd: record.runtimeLog.cwd,
            port: record.runtimeLog.port,
            stdoutTail: record.runtimeLog.stdoutTail,
            stderrTail: record.runtimeLog.stderrTail,
            capturedAt: record.runtimeLog.capturedAt,
          }
        : null,
      timeline: record.timeline,
      previewId: record.previewId ?? null,
      previewRuntime: record.runtime?.type ?? record.mode ?? null,
      previewLastStep:
        record.exitInfo?.lastSuccessfulStep ?? record.lastMeaningfulStep ?? null,
      previewExit: record.exitInfo
        ? {
            exitCode: record.exitInfo.exitCode ?? null,
            signal: record.exitInfo.signal ?? null,
            oomKilled: record.exitInfo.oomKilled ?? false,
            dockerError: record.exitInfo.dockerError ?? null,
            capturedAt: record.exitInfo.capturedAt,
          }
        : null,
      previewStep: record.step ?? null,
      previewStepStartedAt: record.stepStartedAt ?? null,
      previewStepCompletedAt: record.stepCompletedAt ?? null,
      previewStepDurations: record.stepDurations,
      previewFallbackErrors: record.fallbackErrors
        ? {
            docker: record.fallbackErrors.docker ?? null,
            local: record.fallbackErrors.local ?? null,
          }
        : null,
      previewLocalStartAttempts: record.localStartAttempts ?? null,
      previewLocalRetrySucceeded:
        typeof record.localRetrySucceeded === 'boolean' ? record.localRetrySucceeded : null,
      overlayDetection: record.overlayDetection
        ? {
            detectedErrorType: record.overlayDetection.detectedErrorType,
            detectedErrorMessage: record.overlayDetection.detectedErrorMessage,
            affectedModule: record.overlayDetection.affectedModule,
            detectedAt: record.overlayDetection.detectedAt,
          }
        : null,
      dependencyFixes: record.dependencyFixes && record.dependencyFixes.length > 0
        ? record.dependencyFixes.map((f) => ({
            packageName: f.packageName,
            version: f.version,
            reason: f.reason,
            requiredBy: f.requiredBy,
            packageJson: f.packageJson,
            block: f.block,
            fixedAt: f.fixedAt,
          }))
        : null,
      previewFixAttempts: record.previewFixAttempts && record.previewFixAttempts.length > 0
        ? record.previewFixAttempts.map((a) => ({
            attempt: a.attempt,
            startedAt: a.startedAt,
            finishedAt: a.finishedAt,
            outcome: a.outcome,
            runtime: a.runtime,
            error: a.error ?? null,
            classification: a.classification
              ? {
                  kind: a.classification.kind,
                  missingPackage: a.classification.missingPackage,
                  file: a.classification.file,
                  message: a.classification.message,
                  autoFixable: a.classification.autoFixable,
                }
              : undefined,
            fixApplied: a.fixApplied
              ? {
                  kind: a.fixApplied.kind,
                  packageName: a.fixApplied.packageName,
                  version: a.fixApplied.version,
                  block: a.fixApplied.block,
                  packageJson: a.fixApplied.packageJson,
                  appliedAt: a.fixApplied.appliedAt,
                }
              : undefined,
            retryTriggered: a.retryTriggered,
            retrySkippedReason: a.retrySkippedReason,
          }))
        : null,
      probeAttempts: record.probeAttempts && record.probeAttempts.length > 0
        ? record.probeAttempts.slice(-32).map((a) => ({
            at: a.at,
            durationMs: a.durationMs,
            url: a.url,
            method: a.method,
            outcome: a.outcome,
            tcpConnected: a.tcpConnected,
            ok: a.ok,
            status: a.status,
            bodySample: a.bodySample,
            errorCode: a.errorCode,
            errorMessage: a.errorMessage,
          }))
        : null,
      probeRollup: record.probeRollup
        ? {
            kind: record.probeRollup.kind,
            total: record.probeRollup.total,
            tcpEverConnected: record.probeRollup.tcpEverConnected,
            httpEverResponded: record.probeRollup.httpEverResponded,
            lastStatus: record.probeRollup.lastStatus,
            capturedAt: record.probeRollup.capturedAt,
          }
        : null,
    });
    } catch (err) {
      // updatePreview is itself try/catch'd at the store layer so it
      // shouldn't throw, but surface unexpected failures defensively.
      const message = (err as Error).message;
      this.opts.logger.error('preview:sync-persisted', {
        event: 'preview:sync-persisted',
        projectId: record.projectId,
        prevPreviewStatus: null,
        newPreviewStatus: previewStatus,
        previewUrl: url,
        writeOk: false,
        error: message,
      });
      return { ok: false, prevPreviewStatus: null, nextPreviewStatus: previewStatus, error: message };
    }

    // Single canonical "did the durable write happen?" log line.
    // Engineers grepping `event:preview:sync-persisted` get the full
    // status trajectory plus the writeOk flag — the ground truth for
    // "is the dashboard now seeing what the runner saw?".
    const logFn = result.ok ? this.opts.logger.info.bind(this.opts.logger)
                              : this.opts.logger.error.bind(this.opts.logger);
    logFn('preview:sync-persisted', {
      event: 'preview:sync-persisted',
      projectId: record.projectId,
      prevPreviewStatus: result.prevPreviewStatus,
      newPreviewStatus: result.nextPreviewStatus,
      previewUrl: url,
      writeOk: result.ok,
      stateVersion: result.stateVersion,
      error: result.error,
    });
    return {
      ok: result.ok,
      prevPreviewStatus: result.prevPreviewStatus,
      nextPreviewStatus: result.nextPreviewStatus,
      error: result.error,
    };
  }

  /** Tail-truncate a string to `max` chars, keeping the trailing portion. */
  private static tail(s: string | undefined | null, max = 2_000): string | undefined {
    if (!s) return undefined;
    return s.length <= max ? s : s.slice(-max);
  }

  /**
   * Pre-staging dependency-preflight gate. Re-scans the persisted
   * source tree for bare-module imports, diffs against the closest
   * package.json, and auto-adds anything missing (pinned through the
   * curated KNOWN_VERSIONS table). Persists the patched files via
   * `ProjectStore.save` so both docker `contextDir` reads and
   * local-runner `stagingDir` reads see the updated package.json.
   *
   * MUST run before every backend's install / image build because:
   *   • The pipeline-side validator runs DURING generation; QA fix
   *     loops or post-finalization patches can introduce new imports
   *     after that pass.
   *   • Without this gate, `npm install` will succeed but the dev
   *     server returns a "Module not found" overlay — which the
   *     content-health probe then correctly fails. Faster + clearer
   *     to fix it here than to surface it as an overlay-detection
   *     postmortem.
   *
   * Records the applied fixes on `record.dependencyFixes` so they
   * propagate through `syncPreviewToProject` to the persisted
   * `ProjectRecord.preview.dependencyFixes` block, the live
   * `PreviewStatus`, and the diagnostic-runner postmortem.
   *
   * Errors during persistence are fatal — we'd rather fail fast than
   * launch a preview against a known-stale package.json.
   */
  private async runDepPreflight(record: PreviewRecord): Promise<{
    patchedFiles: Array<{ path: string; content: string; language?: string }>;
    fixCount: number;
  }> {
    try {
      const result = await runPreviewDependencyPreflight({
        projectId: record.projectId,
        projectStore: this.opts.projectStore,
        logger: this.opts.logger,
      });
      if (result.fixes.length > 0) {
        record.dependencyFixes = result.fixes;
        this.opts.logger.info('preview: auto-fixed missing dependencies before install', {
          event: 'preview:dep-preflight-fixed',
          projectId: record.projectId,
          previewId: record.previewId,
          fixCount: result.fixes.length,
          packages: result.fixes.map((f) => f.packageName),
        });
        // Mirror onto persisted record so a polling client sees the
        // chip even before the backend reaches preview:ready.
        void this.syncPreviewToProject(record).catch(() => {});
      }
      if (result.unresolved.length > 0) {
        this.opts.logger.warn('preview: unresolved imports (no host package.json found)', {
          event: 'preview:dep-preflight-unresolved',
          projectId: record.projectId,
          unresolved: result.unresolved.slice(0, 16),
        });
      }
      // Defensive only: the preflight itself throws DependencyPreflightError
      // on blocking violations after persisting the failure dump. If a
      // blocking violation somehow surfaces here without throwing
      // (e.g. dump-write failure path), short-circuit before npm install.
      if (result.hasBlockingViolation && result.blockingHeadline) {
        this.opts.logger.error('preview: package.json has blocking peer conflict — aborting before npm install', {
          event: 'preview:dep-preflight-blocked',
          projectId: record.projectId,
          previewId: record.previewId,
          headline: result.blockingHeadline,
          violations: result.packageJsonViolations.slice(0, 8).map((v) => ({
            ruleId: v.ruleId,
            severity: v.severity,
            message: v.message,
          })),
        });
        throw new Error(result.blockingHeadline);
      }
      return { patchedFiles: result.patchedFiles, fixCount: result.fixes.length };
    } catch (err) {
      // Preserve DependencyPreflightError verbatim so the caller can
      // surface its precise headline as `previewError` (rather than
      // wrapping it in a generic "Dependency preflight failed: ..."
      // prefix that hides the conflicting-package detail).
      if (err && typeof err === 'object' && (err as { code?: string }).code === 'DEPENDENCY_PREFLIGHT_FAILED') {
        const dpe = err as Error & { code: string; violations?: unknown[]; dumpPath?: string | null };
        this.opts.logger.error('preview: dependency preflight blocked install', {
          event: 'preview:dep-preflight:blocked',
          projectId: record.projectId,
          previewId: record.previewId,
          headline: dpe.message,
          violationCount: Array.isArray(dpe.violations) ? dpe.violations.length : 0,
          dumpPath: dpe.dumpPath ?? null,
        });
        throw dpe;
      }
      // Other errors (filesystem, project store) keep the wrapper.
      throw new Error(`Dependency preflight failed: ${(err as Error).message}`);
    }
  }

  /**
   * Transition the preview record into a new boot phase. Closes the
   * previous phase by stamping `stepCompletedAt`, computing its
   * duration, appending to `stepDurations`, and logging a structured
   * `preview:step` event so engineers can answer "exactly where is my
   * preview spending its time?". Mirrors the phase forward onto the
   * persisted ProjectRecord.preview block via syncPreviewToProject.
   *
   * Calling enterStep with the same phase twice is a no-op (idempotent
   * — useful when several callsites might race to mark the same
   * boundary).
   */
  private enterStep(record: PreviewRecord, next: PreviewStep): void {
    if (record.step === next) return;
    const at = new Date().toISOString();
    const prev = record.step;
    const prevStartedAt = record.stepStartedAt;
    if (prev && prevStartedAt) {
      const durationMs = Date.now() - new Date(prevStartedAt).getTime();
      const entry = { step: prev, startedAt: prevStartedAt, completedAt: at, durationMs };
      record.stepDurations = [...(record.stepDurations ?? []), entry].slice(-16);
      this.opts.logger.info('preview:step:complete', {
        event: 'preview:step',
        projectId: record.projectId,
        previewId: record.previewId,
        runtime: record.runtime?.type ?? record.mode,
        step: prev,
        durationMs,
        startedAt: prevStartedAt,
        completedAt: at,
      });
    }
    record.step = next;
    record.stepStartedAt = at;
    // For terminal phases (ready/failed) we ALSO stamp completedAt
    // immediately — they have no successor to close them, but we still
    // want a closed-phase entry in stepDurations so the duration shows
    // up as "time from preview:spawning-server → preview:ready".
    if (next === 'preview:ready' || next === 'preview:failed') {
      record.stepCompletedAt = at;
    } else {
      record.stepCompletedAt = null;
    }
    this.opts.logger.info('preview:step:start', {
      event: 'preview:step',
      projectId: record.projectId,
      previewId: record.previewId,
      runtime: record.runtime?.type ?? record.mode,
      step: next,
      at,
      previousStep: prev ?? null,
    });
    void this.syncPreviewToProject(record).catch(() => {});
  }

  /**
   * Record a discrete lifecycle event on the preview record + mirror it
   * onto ProjectRecord.preview.timeline so the dashboard can explain the
   * gap between generation completion and a visible iframe.
   *
   * Pair semantics for `durationMs`:
   *   - install-end    pairs with install-start
   *   - build-end      pairs with build-start
   *   - http-probe-ok  pairs with devserver-start
   *   - url-published  pairs with runner-start (whole-flow time)
   *   - failed         pairs with runner-start
   */
  private recordTimelineEvent(
    record: PreviewRecord,
    event: PreviewTimelineEventName,
    extras?: { details?: Record<string, unknown>; stdout?: string; stderr?: string },
  ): void {
    const at = new Date().toISOString();
    const pairStart: Partial<Record<PreviewTimelineEventName, PreviewTimelineEventName>> = {
      'install-end':    'install-start',
      'build-end':      'build-start',
      'http-probe-ok':  'devserver-start',
      'url-published':  'runner-start',
      'failed':         'runner-start',
    };
    const startName = pairStart[event];
    let durationMs: number | undefined;
    if (startName) {
      const start = (record.timeline ?? []).find((e) => e.event === startName);
      if (start) durationMs = Date.now() - new Date(start.at).getTime();
    }
    const evt: PreviewTimelineEvent = {
      event,
      at,
      projectId: record.projectId,
      previewStatus: this.toPublicPreviewStatus(record.state, record),
      durationMs,
      details: extras?.details,
      stdoutTail: PreviewManager.tail(extras?.stdout),
      stderrTail: PreviewManager.tail(extras?.stderr),
    };
    record.timeline = [...(record.timeline ?? []), evt].slice(-64);

    this.opts.logger.info('preview:timeline', {
      projectId: record.projectId,
      event,
      previewStatus: evt.previewStatus,
      durationMs,
      ...evt.details,
    });

    void this.syncPreviewToProject(record).catch((err) => {
      this.opts.logger.warn('syncPreviewToProject (timeline) failed', {
        projectId: record.projectId, event, error: (err as Error).message,
      });
    });
  }

  constructor(o: PreviewManagerOptions) {
    this.opts = {
      projectStore: o.projectStore,
      docker: o.docker,
      ports: o.ports,
      logger: o.logger,
      localRunner: o.localRunner,
      maxConcurrent: o.maxConcurrent ?? 3,
      idleTtlMs: o.idleTtlMs ?? 10 * 60_000,
      buildTimeoutMs: o.buildTimeoutMs ?? 300_000,
    };
  }

  /** Should be called once at startup. */
  async init(): Promise<void> {
    this.dockerAvailable = await this.opts.docker.isAvailable();
    if (this.opts.localRunner) {
      this.localAvailable = await this.opts.localRunner.isAvailable();
    } else {
      this.localAvailable = false;
    }
    if (this.dockerAvailable) {
      this.opts.logger.info('Preview manager initialised (Docker available)');
    } else if (this.localAvailable) {
      this.opts.logger.warn(
        'Preview manager initialised: Docker unavailable, falling back to LOCAL execution-runner',
      );
    } else {
      this.opts.logger.warn(
        'Preview manager initialised but neither Docker nor local runner is available — preview/start calls will fail',
      );
    }
    // Sweep idle containers periodically.
    this.cleanupTimer = setInterval(() => { void this.sweepIdle(); }, 60_000);
  }

  isDockerAvailable(): boolean {
    return this.dockerAvailable === true;
  }

  isLocalAvailable(): boolean {
    return this.localAvailable === true;
  }

  /** True if the manager can serve a real running preview by ANY backend. */
  isAnyAvailable(): boolean {
    return this.isDockerAvailable() || this.isLocalAvailable();
  }

  /** Returns null if no preview record exists. */
  getStatus(projectId: string): PreviewStatus | null {
    const rec = this.records.get(projectId);
    if (!rec) return null;
    return this.toStatus(rec);
  }

  listAll(): PreviewStatus[] {
    return [...this.records.values()].map((r) => this.toStatus(r));
  }

  /** Refresh the lastAccessedAt clock. Called by the proxy on every request. */
  touch(projectId: string): void {
    const rec = this.records.get(projectId);
    if (rec) rec.lastAccessedAt = Date.now();
  }

  /**
   * Record an `iframe-ready` event reported by the web client when its
   * iframe `onLoad` fires. This closes the loop on the timeline so the
   * dashboard can show the true wall-clock from runner-start to a
   * visible UI in the user's browser. No-ops silently if the project
   * has no preview record (e.g. it was already stopped).
   */
  reportIframeReady(projectId: string, details?: Record<string, unknown>): void {
    const rec = this.records.get(projectId);
    if (!rec) return;
    this.recordTimelineEvent(rec, 'iframe-ready', { details });
  }

  /**
   * Start (or return existing) preview container for the given project.
   * Concurrent calls share one start promise.
   *
   * Routing:
   *   1. Docker available  → build image + run container
   *   2. Else local runner → stage files + spawn `npm run dev` on host
   *   3. Else                throw
   */
  async start(projectId: string): Promise<PreviewStatus> {
    if (!this.dockerAvailable && !this.localAvailable) {
      throw new Error(
        'No preview backend available. Start Docker Desktop or ensure Node.js is on PATH.',
      );
    }

    // Already running and healthy → return immediately.
    const existing = this.records.get(projectId);
    if (existing && (existing.state === 'ready' || existing.state === 'starting' || existing.state === 'building')) {
      existing.lastAccessedAt = Date.now();
      // Local mode: check that the spawned dev process is still alive.
      if (existing.state === 'ready' && (existing.mode === 'local' || existing.mode === 'local-fallback')) {
        const lr = this.opts.localRunner?.get(projectId);
        if (lr && lr.ready && !lr.child.killed) return this.toStatus(existing);
        this.opts.logger.warn('Local preview process disappeared, restarting', { projectId });
        await this.stop(projectId);
      } else if (existing.state === 'ready' && existing.containerId) {
        const live = await this.opts.docker.inspectState(existing.containerId);
        if (live === 'running') return this.toStatus(existing);
        this.opts.logger.warn('Preview container disappeared, restarting', { projectId });
        await this.stop(projectId);
      } else if (existing.state === 'ready' && existing.composeProject && existing.hostPort != null) {
        // Fullstack: probe the published web port. If unreachable, restart.
        const probe = await this.opts.docker.httpProbe(existing.hostPort, '/', 2_000);
        if (probe.ok) return this.toStatus(existing);
        this.opts.logger.warn('Fullstack preview unreachable, restarting', { projectId });
        await this.stop(projectId);
      } else if (existing.state === 'starting' || existing.state === 'building') {
        // Wait for the in-flight start.
        const inflight = this.starting.get(projectId);
        if (inflight) return inflight;
      }
    }

    // ── Final file-integrity gate ──────────────────────────
    // Validate the persisted project file set BEFORE any backend is
    // engaged. Catches malformed / duplicate / missing-critical entries
    // upfront so neither the docker build nor the local runner ever
    // sees a broken file tree. Failures are mirrored onto
    // previewStatus=failed + previewError=<exact file>.
    const gateResult = await this.runIntegrityGate(projectId);
    if (gateResult) return gateResult;

    const promise = this.startWithAutoFixRetry(projectId);
    this.starting.set(projectId, promise);
    try {
      return await promise;
    } finally {
      this.starting.delete(projectId);
    }
  }

  /**
   * Outer auto-fix retry loop. Wraps `startWithDockerThenLocalFallback`
   * (or `doStartLocal` when docker is unavailable) with up to
   * `MAX_PREVIEW_FIX_ATTEMPTS` boot attempts, classifying any failure
   * along the way. When the failure is auto-fixable (currently:
   * "Module not found: 'X'" with X resolvable to a real npm package
   * name), the loop:
   *
   *   1. Records the failed attempt onto `record.previewFixAttempts`
   *      with the classification verdict.
   *   2. Calls `applyForcedDependencyFix` to inject the missing package
   *      into the project's root package.json and persist the file
   *      tree.
   *   3. Records the applied fix on the same attempt entry
   *      (`fixApplied: { kind: 'add-missing-dependency', … }`) and
   *      flips `retryTriggered: true`.
   *   4. Stops the failed preview record so the next iteration starts
   *      fresh (new previewId, fresh container/process).
   *   5. Loops back and re-attempts the boot.
   *
   * Cap behaviour: `MAX_PREVIEW_FIX_ATTEMPTS = 2` — i.e. one initial
   * boot + one auto-retry. Any attempt past the cap is returned to
   * the caller with the latest `failed` status. Non-auto-fixable
   * failures (hydration errors, runtime exceptions, no module name in
   * the overlay, etc.) terminate the loop immediately without ever
   * touching the project tree.
   *
   * Two classifier guards keep the loop safe:
   *   • `attemptedFixes` set prevents the same package being injected
   *     twice in a row (defends against a stale overlay reporting the
   *     SAME module after we've already added it — happens when the
   *     dev server's compile cache is cold).
   *   • `retrySkippedReason` is recorded on every non-retried attempt
   *     so the dashboard shows exactly why the loop gave up
   *     ("attempt-cap-reached" vs "fix-injector-no-op" vs
   *     "not-auto-fixable").
   */
  private async startWithAutoFixRetry(projectId: string): Promise<PreviewStatus> {
    const attempts: PreviewFixAttempt[] = [];
    const attemptedFixes = new Set<string>();
    let lastStatus: PreviewStatus | null = null;
    // Overall wall-clock deadline — the manager-side equivalent of
    // the harness's PREVIEW_READY_TIMEOUT_MS. Ensures we ALWAYS win
    // the race to write `last-preview-timeout.json` even when the
    // per-attempt watchdog would otherwise re-arm into the harness's
    // give-up window.
    const loopStartedAt = Date.now();
    const overallDeadline = loopStartedAt + PREVIEW_OVERALL_BOOT_BUDGET_MS;

    for (let attempt = 1; attempt <= MAX_PREVIEW_FIX_ATTEMPTS; attempt++) {
      // Bail out before launching a new attempt if the overall budget
      // is exhausted (or there's not enough left to make meaningful
      // progress — we treat <2s as "no time left"). Forces a structured
      // timeout dump regardless of which inner phase we're in so the
      // harness never sees a mute "still starting".
      const remaining = overallDeadline - Date.now();
      if (remaining <= 2_000) {
        this.opts.logger.error('preview auto-fix loop: overall boot budget exhausted before next attempt', {
          event: 'preview:overall-boot-timeout',
          projectId,
          attempt,
          elapsedMs: Date.now() - loopStartedAt,
          budgetMs: PREVIEW_OVERALL_BOOT_BUDGET_MS,
          completedAttempts: attempt - 1,
        });
        await this.handleBootTimeout(projectId).catch((err) => {
          this.opts.logger.error('preview overall-boot-timeout handler threw', {
            projectId, error: (err as Error).message,
          });
        });
        break;
      }

      const startedAt = new Date().toISOString();
      const status = await this.runOneStartAttempt(projectId, remaining);
      const finishedAt = new Date().toISOString();
      lastStatus = status;

      if (status.state !== 'failed') {
        // Success (ready / fallback). Stamp this attempt and persist
        // the cumulative `previewFixAttempts` history onto the live
        // record + ProjectRecord.preview.
        attempts.push({
          attempt,
          startedAt,
          finishedAt,
          outcome: 'ready',
          runtime: status.mode,
          retryTriggered: false,
        });
        await this.attachAttemptsToRecord(projectId, attempts);
        return status;
      }

      // Failed attempt — classify and decide whether to retry.
      const classification = classifyPreviewError({
        error: status.error,
        log: status.log,
        overlayDetection: status.overlayDetection ?? null,
      });

      const entry: PreviewFixAttempt = {
        attempt,
        startedAt,
        finishedAt,
        outcome: 'failed',
        runtime: status.mode,
        error: status.error ? status.error.slice(0, 2_000) : null,
        classification: {
          kind: classification.kind,
          missingPackage: classification.missingPackage,
          file: classification.file,
          message: classification.message,
          autoFixable: classification.autoFixable,
        },
        retryTriggered: false,
      };

      // Cap check first — if we've already used our budget, surface
      // the failure verbatim to the caller without attempting a fix.
      if (attempt >= MAX_PREVIEW_FIX_ATTEMPTS) {
        entry.retrySkippedReason = 'attempt-cap-reached';
        attempts.push(entry);
        break;
      }

      // Not-auto-fixable terminates the loop immediately.
      if (!isAutoFixablePreviewError(classification)) {
        entry.retrySkippedReason = 'not-auto-fixable';
        attempts.push(entry);
        break;
      }

      // Defence-in-depth: never inject the same package twice in a
      // row. A stale dev-overlay sometimes lingers after a fix has
      // been applied and the dev server is still rebuilding — better
      // to surface the failure than spin in a tight loop.
      if (attemptedFixes.has(classification.missingPackage)) {
        entry.retrySkippedReason = 'already-attempted';
        attempts.push(entry);
        break;
      }

      // Apply the forced dependency fix and decide whether the result
      // warrants a retry.
      let fixResult: ForcedDependencyFixResult;
      try {
        fixResult = await applyForcedDependencyFix({
          projectId,
          packageName: classification.missingPackage,
          requiredBy: classification.file ? [classification.file] : [],
          projectStore: this.opts.projectStore,
          logger: this.opts.logger,
        });
      } catch (err) {
        this.opts.logger.error('preview auto-fix loop: forced dep fix threw', {
          event: 'preview:auto-fix:exception',
          projectId,
          attempt,
          packageName: classification.missingPackage,
          error: (err as Error).message,
        });
        entry.retrySkippedReason = 'fix-injector-no-op';
        attempts.push(entry);
        break;
      }

      if (!fixResult.applied) {
        // No-op: package was already declared (overlay was stale) or
        // we couldn't find a package.json. Retrying won't help.
        this.opts.logger.warn('preview auto-fix loop: forced fix was a no-op', {
          event: 'preview:auto-fix:no-op',
          projectId,
          attempt,
          packageName: classification.missingPackage,
          skipReason: fixResult.skipReason,
        });
        entry.retrySkippedReason = 'fix-injector-no-op';
        attempts.push(entry);
        break;
      }

      // Record the applied fix on the failed attempt entry, mark the
      // retry, and proceed to the next loop iteration.
      entry.fixApplied = {
        kind: 'add-missing-dependency',
        packageName: fixResult.packageName,
        version: fixResult.version!,
        block: fixResult.block!,
        packageJson: fixResult.packageJson!,
        appliedAt: fixResult.appliedAt!,
      };
      entry.retryTriggered = true;
      attempts.push(entry);
      attemptedFixes.add(fixResult.packageName);

      this.opts.logger.info('preview auto-fix loop: retrying after dependency injection', {
        event: 'preview:auto-fix:retry',
        projectId,
        attempt,
        nextAttempt: attempt + 1,
        packageName: fixResult.packageName,
        version: fixResult.version,
        block: fixResult.block,
      });

      // Persist the cumulative attempt log BEFORE the retry boots —
      // a polling client should see the chip "fix applied: <pkg>"
      // even while attempt #2 is still installing.
      await this.attachAttemptsToRecord(projectId, attempts);

      // Tear down the failed record so the next iteration starts with
      // a clean docker container / local process / preview record.
      // `stop()` is idempotent and safe to call against a 'failed'
      // record (it'll just remove the in-memory entry + any container).
      try {
        await this.stop(projectId);
      } catch (stopErr) {
        this.opts.logger.warn('preview auto-fix loop: stop() before retry failed (proceeding anyway)', {
          event: 'preview:auto-fix:stop-failed',
          projectId,
          attempt,
          error: (stopErr as Error).message,
        });
      }
    }

    // Loop terminated — persist the final attempt log onto whatever
    // record currently exists for this project, then return the most
    // recent failed status to the caller.
    await this.attachAttemptsToRecord(projectId, attempts);
    // `lastStatus` may be null if the overall-budget bail-out fired
    // before the very first attempt had a chance to run. Synthesise
    // a status from the in-memory record (handleBootTimeout has
    // already stamped previewStatus=failed + step=preview:timeout +
    // a non-empty error). Last-resort fallback: a structurally valid
    // PreviewStatus with the headline so callers NEVER see an
    // undefined error field.
    if (lastStatus) return lastStatus;
    const liveRecord = this.records.get(projectId);
    if (liveRecord) return this.toStatus(liveRecord);
    return {
      projectId,
      state: 'failed',
      stack: null,
      url: null,
      hostPort: null,
      apiHostPort: null,
      error: 'Preview startup timed out before any attempt could begin (overall boot budget exhausted).',
      log: '',
      uptimeMs: 0,
      mode: this.dockerAvailable ? 'docker' : 'local',
      startedAtIso: undefined,
      readyAtIso: null,
      lastMeaningfulStep: 'preview:timeout',
      step: 'preview:timeout',
    } as PreviewStatus;
  }

  /**
   * Run a single preview boot attempt — picks the right backend
   * (docker-with-fallback OR local-only) and returns its `PreviewStatus`.
   * Extracted so the auto-fix retry loop can call it once per
   * iteration without duplicating the routing logic.
   *
   * `remainingBudgetMs` is the wall-clock budget the caller (the
   * outer auto-fix loop) still has under its overall deadline. The
   * per-attempt watchdog is armed at `min(PREVIEW_BOOT_TIMEOUT_MS,
   * remainingBudgetMs)` so the FINAL attempt's watchdog always fires
   * before the outer overall-boot deadline elapses (and therefore
   * always before the diagnostic harness gives up at 180s).
   */
  private runOneStartAttempt(
    projectId: string,
    remainingBudgetMs: number = PREVIEW_BOOT_TIMEOUT_MS,
  ): Promise<PreviewStatus> {
    // Boot-watchdog: arms a wall-clock timer over the entire attempt
    // (across stack-detect / stage / install / build / spawn / probe).
    // When it fires AND the record hasn't reached a terminal state
    // (ready / failed), we flip the record to `preview:timeout`,
    // stamp `timeoutAtIso`, capture a fresh runtime-log snapshot,
    // dump `last-preview-timeout.json`, and best-effort tear down
    // the underlying container / local process so the awaiting boot
    // promise resolves promptly. The boot promise itself is NOT
    // rejected — we let it resolve naturally so the auto-fix retry
    // loop and the final `attachAttemptsToRecord` can run.
    const watchdogMs = Math.max(1_000, Math.min(PREVIEW_BOOT_TIMEOUT_MS, remainingBudgetMs));
    const watchdog = setTimeout(() => {
      void this.handleBootTimeout(projectId).catch((err) => {
        this.opts.logger.error('preview boot-watchdog handler threw', {
          projectId, error: (err as Error).message,
        });
      });
    }, watchdogMs);
    const inner = this.dockerAvailable
      ? this.startWithDockerThenLocalFallback(projectId)
      : this.doStartLocal(projectId);
    return inner.finally(() => {
      clearTimeout(watchdog);
    });
  }

  /**
   * Boot-watchdog action. Called once `PREVIEW_BOOT_TIMEOUT_MS` has
   * elapsed since `runOneStartAttempt` started. Idempotent — if the
   * record has already reached a terminal state we exit silently.
   *
   * On a real timeout:
   *   1. Capture a fresh runtimeLog snapshot (last stdout/stderr
   *      tails, current PID).
   *   2. Stamp `timeoutAtIso`, `step: 'preview:timeout'`,
   *      `state: 'failed'`, `error: <timeout headline>`.
   *   3. Mirror onto ProjectRecord.preview so the dashboard / harness
   *      see the new step IMMEDIATELY (not after the inner await
   *      eventually unsticks).
   *   4. Dump `apps/api/src/testing/last-preview-timeout.json` with
   *      every field a forensics engineer needs (pid + port + tails
   *      + alive flag + last probe error + step durations).
   *   5. Best-effort tear down the container / local-runner child so
   *      the inner await unsticks and the auto-fix retry loop can
   *      progress (or terminate cleanly).
   */
  private async handleBootTimeout(projectId: string): Promise<void> {
    const record = this.records.get(projectId);
    if (!record) {
      // Defensive fallback: the in-memory record was already evicted
      // (e.g. by a concurrent stop()), but the persisted project still
      // shows previewStatus='starting' from the last sync. Stamp a
      // structured timeout failure directly on the project record so
      // the dashboard never sees a mute timeout.
      const headline =
        `Preview startup timed out after ${PREVIEW_BOOT_TIMEOUT_MS / 1000}s ` +
        `[cause=unknown] — in-memory record was already evicted; ` +
        `see last-preview-timeout.json for forensics.`;
      try {
        await this.opts.projectStore.updatePreview(projectId, {
          previewStatus: 'failed',
          previewReady: false,
          previewError: headline,
          previewTimeoutAt: new Date().toISOString(),
          previewTimeoutDurationMs: PREVIEW_BOOT_TIMEOUT_MS,
          previewChildAlive: null,
          previewTimeoutCause: 'unknown',
          previewTimeoutLifecycle: null,
          previewStep: 'preview:timeout',
        });
      } catch (err) {
        this.opts.logger.error('preview boot-watchdog: orphan-record fallback persist failed', {
          projectId, error: (err as Error).message,
        });
      }
      return;
    }
    if (record.state === 'ready' || record.state === 'failed') return;

    // Refresh the runtime-log snapshot so the dump captures the LAST
    // bytes the dev server ever emitted before the watchdog tripped.
    const lr = this.opts.localRunner?.get(record.projectId) ?? null;
    this.captureRuntimeLog(record, lr?.child?.pid ?? null);

    // Liveness probe — `process.kill(pid, 0)` raises ESRCH if the
    // PID is gone, otherwise succeeds (or raises EPERM, still alive).
    // Persisted onto the record so syncPreviewToProject can mirror
    // it onto ProjectRecord.preview.previewChildAlive.
    const pid = record.runtimeLog?.pid ?? lr?.child?.pid ?? null;
    let childAlive: boolean | null = null;
    if (pid != null && Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        childAlive = true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        childAlive = code === 'EPERM';
      }
    }
    record.childAliveAtTimeout = childAlive;

    record.timeoutAtIso = new Date().toISOString();
    record.timeoutDurationMs = PREVIEW_BOOT_TIMEOUT_MS;
    // Capture the full process-lifecycle snapshot BEFORE composing
    // the headline so the verdict ("crashed" / "alive-hanging" / …)
    // can be folded into the error message.
    this.snapshotProcessLifecycle(record);
    const lifecycle = record.processLifecycle ?? null;
    // ── Precise timeout-cause classification ─────────────────
    // Compute lifecycle booleans (install/build/spawn/probe) and
    // map them to a single category. Persisted on the record (and
    // mirrored to ProjectRecord.preview by syncPreviewToProject)
    // so downstream consumers don't have to parse the free-form
    // headline.
    const timeoutLifecycle = computeTimeoutLifecycle(record, lr);
    const timeoutCause = classifyTimeoutCause(timeoutLifecycle);
    record.timeoutLifecycle = timeoutLifecycle;
    record.timeoutCause = timeoutCause;
    // Compose a diagnosis-led headline from the probe history when
    // available. The raw rollup `kind` answers "what kind of HTTP
    // failure did we see?" — far more useful than "stuck in
    // <step>" because the same step can fail for completely
    // different reasons (port-never-opened vs http-error-status).
    const rollup = record.probeAttempts && record.probeAttempts.length > 0
      ? rollupProbes(record.probeAttempts)
      : null;
    const last = rollup?.lastAttempt ?? null;
    const probeReason = (() => {
      if (!rollup) return 'no probes attempted (boot stalled before readiness wait)';
      const lastFrag = last
        ? `last: ${last.outcome}` +
          (last.status != null ? ` status=${last.status}` : '') +
          (last.errorCode ? ` err=${last.errorCode}` : '')
        : 'no attempts';
      return `${rollup.kind} (${rollup.total} probes; ${lastFrag})`;
    })();
    // Structured, human-readable headline. NEVER empty — even when
    // every diagnostic field is null we still get a usable sentence.
    // Lifecycle verdict ("crashed" / "alive-hanging" / …) is the
    // primary diagnosis; pid + exit code + signal + uptime follow as
    // forensic supporting facts.
    const lifecycleLabel = (() => {
      switch (lifecycle?.classification) {
        case 'crashed':
          return `crashed (exit=${lifecycle.exitCode ?? 'null'}` +
            (lifecycle.signal ? `, signal=${lifecycle.signal}` : '') +
            (lifecycle.uptimeMs != null ? `, uptime=${(lifecycle.uptimeMs / 1000).toFixed(1)}s` : '') + ')';
        case 'exited-clean':
          return `exited cleanly (code=0, uptime=${lifecycle.uptimeMs != null ? (lifecycle.uptimeMs / 1000).toFixed(1) + 's' : '?'}) — unexpected during boot`;
        case 'alive-hanging':
          return `alive but not listening (pid=${lifecycle.pid ?? '?'}, uptime=${lifecycle.uptimeMs != null ? (lifecycle.uptimeMs / 1000).toFixed(1) + 's' : '?'})`;
        case 'alive-not-reachable':
          return `alive but app unreachable via HTTP (pid=${lifecycle.pid ?? '?'}, uptime=${lifecycle.uptimeMs != null ? (lifecycle.uptimeMs / 1000).toFixed(1) + 's' : '?'})`;
        case 'no-process':
          return 'no process was ever spawned';
        case 'alive-healthy':
          return 'process healthy (unexpected — record state is not ready)';
        default:
          // Unknown state — fall back to the legacy alive flag.
          return childAlive === true ? 'alive (state unknown)' : childAlive === false ? 'dead' : 'unknown';
      }
    })();
    const headline =
      `Preview startup timed out after ${PREVIEW_BOOT_TIMEOUT_MS / 1000}s ` +
      `[cause=${timeoutCause}] — ${describeTimeoutCause(timeoutCause)}. ` +
      `Step at timeout: ${record.step ?? '<no-step>'} ` +
      `(last successful: ${record.lastMeaningfulStep ?? '<none>'}). ` +
      `Lifecycle: install ${timeoutLifecycle.installStarted ? (timeoutLifecycle.installCompleted ? 'completed' : 'STARTED-NOT-FINISHED') : 'not-started'}` +
      `, build ${timeoutLifecycle.buildStarted ? (timeoutLifecycle.buildCompleted ? 'completed' : 'STARTED-NOT-FINISHED') : 'not-started'}` +
      `, server ${timeoutLifecycle.serverSpawned ? 'spawned' : 'NOT-SPAWNED'}` +
      `, port ${timeoutLifecycle.portOpened ? 'opened' : 'NOT-OPENED'}` +
      `, probes ${timeoutLifecycle.firstProbeAttempted ? 'attempted' : 'NEVER-ATTEMPTED'}. ` +
      `Last probe: ${probeReason}. ` +
      `Process: ${lifecycleLabel}.`;
    record.error = headline;

    // Move the record into the public-failed bucket so polling
    // clients stop seeing 'starting' forever. We do NOT call fail()
    // here — fail() composes its own error message and assumes a
    // runtime exit code; the timeout marker is structurally distinct
    // (no exit code, no signal, no overlay match — just "deadline
    // exceeded").
    this.markPreviewStep(record, 'failed', headline.slice(0, 200));
    this.enterStep(record, 'preview:timeout');

    // GUARANTEED PERSISTENCE: the markPreviewStep / enterStep paths
    // both fire void syncPreviewToProject(...) (fire-and-forget).
    // Await one final explicit sync before returning so the persisted
    // project record is known to reflect previewStatus='failed' with
    // a non-empty previewError before any caller / polling client
    // observes the next state.
    try {
      await this.syncPreviewToProject(record);
    } catch (err) {
      this.opts.logger.error('preview boot-watchdog: final sync failed (project may briefly show stale state)', {
        projectId, error: (err as Error).message,
      });
    }

    this.opts.logger.error('preview boot-watchdog tripped', {
      event: 'preview:boot-timeout',
      projectId,
      previewId: record.previewId,
      runtime: record.runtime?.type ?? record.mode ?? null,
      step: record.step,
      lastMeaningfulStep: record.lastMeaningfulStep,
      pid,
      childAlive,
      port: record.hostPort ?? record.runtime?.port ?? null,
      timeoutMs: PREVIEW_BOOT_TIMEOUT_MS,
      probeRollup: rollup?.kind ?? 'no-probes',
      processClassification: lifecycle?.classification ?? null,
      processUptimeMs: lifecycle?.uptimeMs ?? null,
      processExitCode: lifecycle?.exitCode ?? null,
      processSignal: lifecycle?.signal ?? null,
      timeoutCause,
      timeoutLifecycle,
      headline,
    });

    // Persist the dump file. Best-effort — write failures must not
    // mask the timeout itself.
    try {
      await this.dumpPreviewTimeout(record);
    } catch (err) {
      this.opts.logger.error('failed to write last-preview-timeout.json', {
        projectId, error: (err as Error).message,
      });
    }
    // Local-runner-specific timeout dump — same writer used by the
    // doStartLocal catch block. Lets engineers see the LOCAL
    // lifecycle facts (install completed, server spawned, port ever
    // opened, exact cmd/args/cwd/env) on every timeout, not just
    // explicit runtime failures. Skipped when the runtime isn't
    // local.
    const isLocal = record.runtime?.type === 'local'
      || record.runtime?.type === 'local-fallback'
      || record.mode === 'local'
      || record.mode === 'local-fallback';
    if (isLocal) {
      const lr = this.opts.localRunner?.get(projectId) ?? null;
      try {
        await this.dumpLocalPreviewFailure(record, lr, headline);
      } catch (err) {
        this.opts.logger.warn('preview: failed to write last-local-preview-failure.json (timeout path)', {
          projectId, error: (err as Error).message,
        });
      }
    }

    // Tear down the underlying runtime so the awaiting promise
    // resolves promptly. Best-effort — both calls are idempotent
    // and safe to invoke even if the runtime never actually started.
    if (this.opts.localRunner) {
      void this.opts.localRunner.stop(projectId).catch(() => {});
    }
    if (record.containerId) {
      void this.opts.docker.stop(record.containerId).catch(() => {});
    }
    if (record.composeProject) {
      const contextDir = this.opts.projectStore.getOutputDir(projectId);
      void this.opts.docker.composeDown(record.composeProject, contextDir).catch(() => {});
    }
  }

  /**
   * Snapshot the dev-server process lifecycle and stamp it onto
   * `record.processLifecycle`. Combines:
   *   • PID + spawn timestamp + exit timestamp from the local-runner
   *     record (when present).
   *   • A live `process.kill(pid, 0)` liveness probe to disambiguate
   *     "alive but hanging" from "process already gone".
   *   • The probe rollup (port-never-opened vs http-not-ready) to
   *     refine the alive case into `alive-hanging` vs `alive-not-
   *     reachable`.
   *
   * The result classifies the boot state as one of:
   *   no-process | crashed | exited-clean | alive-hanging |
   *   alive-not-reachable | alive-healthy.
   *
   * Idempotent — safe to call from multiple sites (boot watchdog,
   * runtime-exit, fail()). Each call overwrites the snapshot so the
   * persisted record always reflects the freshest verdict.
   */
  private snapshotProcessLifecycle(record: PreviewRecord): void {
    const lr = this.opts.localRunner?.get(record.projectId) ?? null;
    const pid = lr?.child?.pid ?? record.runtimeLog?.pid ?? null;
    const startedAt = lr?.processStartedAt ?? record.startedAtIso ?? null;
    const exitedAt = lr?.processExitedAt ?? null;
    const exitCode = lr?.exitCode ?? record.exitInfo?.exitCode ?? null;
    const signal = lr?.exitSignal ?? record.exitInfo?.signal ?? null;
    const exited = lr?.exited === true || exitedAt !== null || exitCode !== null || signal !== null;

    // Liveness via process.kill(pid, 0): ESRCH=dead, EPERM=alive,
    // success=alive. Skipped when we already know the process exited.
    let alive: boolean | null = null;
    if (exited) {
      alive = false;
    } else if (pid != null && Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        alive = true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        alive = code === 'EPERM';
      }
    }

    const uptimeMs = startedAt
      ? Math.max(0, Date.now() - new Date(startedAt).getTime())
      : null;

    // Classify. The probe rollup refines the alive case so the UI can
    // distinguish "process is up but not listening" from "process is
    // listening but HTTP responses don't pass readiness".
    let classification: NonNullable<PreviewRecord['processLifecycle']>['classification'];
    if (record.state === 'ready') {
      classification = 'alive-healthy';
    } else if (alive === false || exited) {
      // Crash vs clean exit. Any non-zero code OR any terminating
      // signal counts as a crash. exit code 0 with no signal during
      // boot is unexpected (the dev server should have stayed up
      // until ready) — flag it as 'exited-clean'.
      const isCrash = (exitCode !== null && exitCode !== 0) || signal !== null;
      classification = isCrash ? 'crashed' : 'exited-clean';
    } else if (alive === true) {
      const rollup = record.probeRollup ?? null;
      if (!rollup || rollup.kind === 'no-probes' || rollup.kind === 'port-never-opened') {
        classification = 'alive-hanging';
      } else {
        // tcp-opened-no-http / http-error-status / http-not-ready
        classification = 'alive-not-reachable';
      }
    } else if (pid == null && startedAt == null) {
      classification = 'no-process';
    } else {
      // Unknown liveness with PID present — most likely a race; lean
      // toward "alive-hanging" because the most common cause of an
      // unknown verdict is a permissions hiccup on the kill(0) probe.
      classification = 'alive-hanging';
    }

    record.processLifecycle = {
      startedAt,
      exitedAt,
      exitCode,
      signal: signal ?? null,
      alive,
      pid,
      uptimeMs,
      classification,
      capturedAt: new Date().toISOString(),
    };
  }

  /**
   * Append a single HTTP probe attempt onto the manager-side record's
   * `probeAttempts` ring buffer (capped at 64) and refresh the
   * roll-up classification. Mirrors onto ProjectRecord.preview so
   * polling clients see the live probe history. Idempotent.
   *
   * The local-runner ALSO maintains its own probeAttempts buffer for
   * its internal use — this method is the path the manager's record
   * uses, kept separate so a teardown of the local-runner record
   * doesn't clobber the manager's (longer-lived) probe history.
   */
  private recordProbeAttempt(record: PreviewRecord, attempt: ProbeAttempt): void {
    if (!record.probeAttempts) record.probeAttempts = [];
    record.probeAttempts.push(attempt);
    if (record.probeAttempts.length > 64) {
      record.probeAttempts = record.probeAttempts.slice(-64);
    }
    const rollup = rollupProbes(record.probeAttempts);
    record.probeRollup = {
      kind: rollup.kind,
      total: rollup.total,
      tcpEverConnected: rollup.tcpEverConnected,
      httpEverResponded: rollup.httpEverResponded,
      lastStatus: rollup.lastStatus,
      capturedAt: new Date().toISOString(),
    };
    // Best-effort mirror to disk; not awaited.
    void this.syncPreviewToProject(record).catch(() => {});
  }

  /**
   * Capture a snapshot of the live dev-server stdio + pid + cmd onto
   * `record.runtimeLog`. Read from the local-runner's ring buffers
   * when available; falls back to the docker container log tail
   * (which may be empty before the container starts emitting).
   *
   * Always overwrites — the snapshot is meant to reflect the
   * "current" state, so a fresh capture replaces the previous one.
   */
  private captureRuntimeLog(record: PreviewRecord, pidHint: number | null): void {
    const lr = this.opts.localRunner?.get(record.projectId) ?? null;
    const stdoutTail = lr ? lr.stdoutLog.slice(-3_000) : null;
    const stderrTail = lr ? lr.stderrLog.slice(-3_000) : null;
    const pid = pidHint ?? lr?.child?.pid ?? null;
    record.runtimeLog = {
      pid,
      cmd: record.runtime?.cmd
        ? `${record.runtime.cmd}${record.runtime.args ? ' ' + record.runtime.args.join(' ') : ''}`
        : null,
      cwd: record.runtime?.cwd ?? lr?.stagingDir ?? null,
      port: record.runtime?.port ?? record.hostPort ?? lr?.port ?? null,
      stdoutTail,
      stderrTail,
      capturedAt: new Date().toISOString(),
    };
    // Mirror onto ProjectRecord.preview synchronously (best-effort)
    // so polling clients see the latest stdio tail without waiting
    // for the next state transition.
    void this.syncPreviewToProject(record).catch(() => {});
  }

  /**
   * Write a forensic dump of the timeout to
   * `apps/api/src/testing/last-preview-timeout.json`. Always
   * single-file (overwrites previous timeout) so the most recent
   * stuck preview is one path to check. Includes:
   *   • projectId / previewId / step / status
   *   • child pid / cmd / cwd / port
   *   • stdout + stderr tails (≤3 KB each)
   *   • whether the child process is still alive
   *   • whether the HTTP probe ever connected (timeline scan)
   *   • last probe error from the timeline (if any)
   */
  private async dumpPreviewTimeout(record: PreviewRecord): Promise<void> {
    const dumpPath = previewTimeoutDumpPath();
    const lr = this.opts.localRunner?.get(record.projectId) ?? null;
    const pid = record.runtimeLog?.pid ?? lr?.child?.pid ?? null;

    // Liveness probe — `process.kill(pid, 0)` raises ESRCH if the PID
    // is gone, otherwise succeeds (or raises EPERM, which still
    // means "alive but not ours"). Best-effort: we treat any error
    // OTHER than ESRCH as "alive". Reuses the verdict already
    // captured by `handleBootTimeout` when present (record.childAliveAtTimeout)
    // so the dump and the persisted record can never disagree.
    let processAlive: boolean | null = record.childAliveAtTimeout ?? null;
    if (processAlive === null && pid != null && Number.isFinite(pid)) {
      try {
        process.kill(pid, 0);
        processAlive = true;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        processAlive = code === 'EPERM';
      }
    }

    // Did the HTTP probe ever connect? Scan the timeline for an
    // `http-probe-ok` event — its absence is itself diagnostic.
    const timeline = record.timeline ?? [];
    const httpProbeOk = timeline.find((e) => e.event === 'http-probe-ok');
    const failedEvent = timeline.find((e) => e.event === 'failed');
    const lastProbeError =
      (failedEvent?.details as { reason?: string } | undefined)?.reason ??
      record.exitInfo?.dockerError ??
      record.exitInfo?.stderrTail?.split(/\r?\n/).slice(-3).join(' | ').slice(-400) ??
      null;

    // Compose probe diagnostics. The `probeAttempts` field is the
    // raw history; `probeDiagnosis` is the single-line human-
    // readable verdict; `probeSummary` is the rollup with counters.
    const probeAttempts = record.probeAttempts ?? [];
    const probeRollup = rollupProbes(probeAttempts);
    const probeDiagnosis = (() => {
      switch (probeRollup.kind) {
        case 'no-probes':           return 'No HTTP probes were issued — boot stalled before the readiness wait.';
        case 'port-never-opened':   return 'The host port never accepted a TCP connection (process did not bind, or bound to a different port).';
        case 'tcp-opened-no-http':  return 'TCP connected but no HTTP response was received (process bound the port but is not serving HTTP yet).';
        case 'http-error-status':   return 'HTTP responded with a non-OK status (server is up but returning errors).';
        case 'http-not-ready':      return 'HTTP returned a 2xx but the readiness gate rejected the response (likely a build-error overlay or interstitial page).';
      }
    })();

    const payload = {
      timestamp: new Date().toISOString(),
      kind: 'preview-boot-timeout',
      timeoutBudgetMs: PREVIEW_BOOT_TIMEOUT_MS,
      projectId: record.projectId,
      previewId: record.previewId,
      previewStatus: this.toPublicPreviewStatus(record.state, record),
      previewStep: record.step ?? null,
      previewStepStartedAt: record.stepStartedAt ?? null,
      previewStartedAt: record.startedAtIso ?? null,
      previewTimeoutAt: record.timeoutAtIso ?? null,
      lastSuccessfulStep: record.lastMeaningfulStep ?? null,
      runtime: record.runtime?.type ?? record.mode ?? null,
      // Precise timeout-cause classification + the lifecycle booleans
      // it was derived from. Lets `last-preview-timeout.json` carry the
      // verdict directly instead of forcing triage tooling to re-derive
      // it from the timeline.
      timeoutCause: record.timeoutCause ?? null,
      timeoutLifecycle: record.timeoutLifecycle ?? null,
      child: {
        pid,
        alive: processAlive,
        exitCode: lr?.exitCode ?? null,
        exitSignal: lr?.exitSignal ?? null,
        startedAt: lr?.processStartedAt ?? null,
        exitedAt: lr?.processExitedAt ?? null,
      },
      // Classified server-process lifecycle verdict — the single
      // most actionable field for "is the boot hanging or
      // crashing?". Captured by `snapshotProcessLifecycle()`
      // before this dump runs (handleBootTimeout/fail() both
      // call it). Re-snapshot here as a defensive fallback so the
      // dump is never written without a lifecycle verdict.
      processLifecycle: (() => {
        if (!record.processLifecycle) {
          this.snapshotProcessLifecycle(record);
        }
        return record.processLifecycle ?? null;
      })(),
      command: record.runtime?.cmd ?? null,
      commandArgs: record.runtime?.args ?? null,
      cwd: record.runtime?.cwd ?? lr?.stagingDir ?? null,
      port: record.runtimeLog?.port ?? record.hostPort ?? null,
      envSafe: record.runtime?.envSafe ?? null,
      stdoutTail: record.runtimeLog?.stdoutTail ?? lr?.stdoutLog.slice(-3_000) ?? null,
      stderrTail: record.runtimeLog?.stderrTail ?? lr?.stderrLog.slice(-3_000) ?? null,
      // Legacy field — kept for backwards compatibility with any
      // tooling that already greps for it. Now redundant with
      // `probeDiagnosis` / `probeSummary`.
      httpProbeEverConnected: probeRollup.httpEverResponded || !!httpProbeOk,
      httpProbeOkAt: httpProbeOk?.at ?? null,
      lastProbeError,
      // Rich probe diagnostics — answers "what kind of startup
      // failure occurred?" without the reader needing to interpret
      // the raw timeline.
      probeDiagnosis,
      probeSummary: {
        kind: probeRollup.kind,
        totalProbesAttempted: probeRollup.total,
        tcpEverConnected: probeRollup.tcpEverConnected,
        httpEverResponded: probeRollup.httpEverResponded,
        lastStatus: probeRollup.lastStatus,
        lastOutcome: probeRollup.lastAttempt?.outcome ?? null,
        lastErrorCode: probeRollup.lastAttempt?.errorCode ?? null,
        lastErrorMessage: probeRollup.lastAttempt?.errorMessage ?? null,
        lastBodySample: probeRollup.lastAttempt?.bodySample ?? null,
      },
      // True iff content-health detected a framework error page
      // (Next.js / Vite / React build-error overlay etc.) in any
      // probe response body. Distinct from `probeRollup.kind ===
      // 'http-not-ready'` because the rollup only knows the readiness
      // gate rejected the response — this field surfaces the
      // overlay-classifier's specific verdict.
      contentIndicatedFrameworkError: !!record.overlayDetection,
      overlayDetection: record.overlayDetection
        ? {
            detectedErrorType: record.overlayDetection.detectedErrorType,
            detectedErrorMessage: record.overlayDetection.detectedErrorMessage,
            affectedModule: record.overlayDetection.affectedModule,
            detectedAt: record.overlayDetection.detectedAt,
          }
        : null,
      probeAttempts: probeAttempts.slice(-32),
      stepDurations: record.stepDurations ?? [],
      historyTail: (record.history ?? []).slice(-32),
      timelineTail: timeline.slice(-32).map((e) => ({
        event: e.event,
        at: e.at,
        previewStatus: e.previewStatus,
        durationMs: e.durationMs ?? null,
        details: e.details ?? null,
      })),
    };
    await fs.mkdir(path.dirname(dumpPath), { recursive: true });
    await fs.writeFile(dumpPath, JSON.stringify(payload, null, 2), 'utf8');
    this.opts.logger.warn('preview timeout dump written', {
      projectId: record.projectId,
      previewId: record.previewId,
      dumpPath,
      pid,
      processAlive,
      probeDiagnosis: probeRollup.kind,
      probeAttempts: probeRollup.total,
      httpProbeEverConnected: probeRollup.httpEverResponded || !!httpProbeOk,
    });
  }

  /**
   * Stamp the cumulative `previewFixAttempts` array onto whatever
   * preview record currently exists for `projectId` AND mirror onto
   * the persisted `ProjectRecord.preview.previewFixAttempts`. Idempotent
   * — safe to call after every loop iteration.
   *
   * Tolerates a missing record (e.g. the loop was torn down between
   * iterations): in that case it patches the on-disk preview block
   * directly via `updatePreview`.
   */
  private async attachAttemptsToRecord(
    projectId: string,
    attempts: PreviewFixAttempt[],
  ): Promise<void> {
    if (attempts.length === 0) return;
    const record = this.records.get(projectId);
    if (record) {
      record.previewFixAttempts = attempts;
      try {
        await this.syncPreviewToProject(record);
      } catch (err) {
        this.opts.logger.warn('preview auto-fix loop: syncPreviewToProject failed (non-fatal)', {
          event: 'preview:auto-fix:sync-failed',
          projectId,
          error: (err as Error).message,
        });
      }
      return;
    }
    // No live record (probably torn down by stop() between
    // iterations). Patch the persisted block directly so the dashboard
    // still sees the attempt history.
    try {
      await this.opts.projectStore.updatePreview(projectId, {
        previewStatus: 'failed',
        previewReady: false,
        previewFixAttempts: attempts.map((a) => ({
          attempt: a.attempt,
          startedAt: a.startedAt,
          finishedAt: a.finishedAt,
          outcome: a.outcome,
          runtime: a.runtime,
          error: a.error ?? null,
          classification: a.classification,
          fixApplied: a.fixApplied,
          retryTriggered: a.retryTriggered,
          retrySkippedReason: a.retrySkippedReason,
        })),
      });
    } catch (err) {
      this.opts.logger.warn('preview auto-fix loop: orphan-attempts persist failed', {
        event: 'preview:auto-fix:orphan-persist-failed',
        projectId,
        error: (err as Error).message,
      });
    }
  }

  /**
   * Run the docker preview attempt and, if it fails, transparently
   * try the local runner ONCE as a fallback before giving up. Only
   * engages the fallback when:
   *   - a local runner is configured + available (`isAvailable() === true`)
   *   - the project has a runnable `dev` (or `start`) npm script (we
   *     don't try to spawn a host process when we already know there's
   *     nothing meaningful to spawn)
   *
   * If the fallback succeeds, the returned status carries
   *   mode = 'local-fallback', state = 'ready'
   * and the docker error is logged but discarded from the user-facing
   * `previewError` (the preview is working — no need to scare the
   * user).
   *
   * If the fallback ALSO fails, both errors are composed into the
   * final `previewError` AND mirrored onto
   * ProjectRecord.preview.previewFallbackErrors so the UI can show
   * "we tried docker AND local, both died — here's why".
   */
  private async startWithDockerThenLocalFallback(projectId: string): Promise<PreviewStatus> {
    const dockerStatus = await this.doStart(projectId);
    if (dockerStatus.state !== 'failed') return dockerStatus;

    // Docker failed. Decide whether to try the local runner.
    if (!this.localAvailable || !this.opts.localRunner) {
      this.opts.logger.info('preview: docker failed, no local fallback available', {
        event: 'preview:fallback-skipped',
        projectId,
        reason: 'local-runner-unavailable',
      });
      return dockerStatus;
    }
    if (!(await this.hasRunnableDevScript(projectId))) {
      this.opts.logger.info('preview: docker failed, project has no dev/start script', {
        event: 'preview:fallback-skipped',
        projectId,
        reason: 'no-dev-script',
      });
      return dockerStatus;
    }

    const dockerError = dockerStatus.error ?? 'Docker preview failed (no error message captured)';
    this.opts.logger.warn('preview: docker failed, attempting local-fallback runner', {
      event: 'preview:fallback-attempt',
      projectId,
      dockerError: dockerError.slice(0, 500),
    });
    return this.doStartLocal(projectId, { fallbackFromDockerError: dockerError });
  }

  /**
   * Best-effort check that the project has a runnable npm dev script.
   * Used as the gate for the docker→local fallback path so we don't
   * waste time spawning `npm run dev` on a static-site project.
   * Returns false on any read/parse error (= skip fallback).
   */
  private async hasRunnableDevScript(projectId: string): Promise<boolean> {
    try {
      const project = await this.opts.projectStore.get(projectId);
      if (!project?.files?.length) return false;
      const pkgEntry = project.files.find((f) => f.path === 'package.json');
      if (!pkgEntry || typeof pkgEntry.content !== 'string') return false;
      const parsed = JSON.parse(pkgEntry.content) as { scripts?: Record<string, string> };
      const scripts = parsed?.scripts ?? {};
      return Boolean(scripts.dev || scripts.start);
    } catch {
      return false;
    }
  }

  /**
   * Final integrity gate. Returns a failed PreviewStatus when the
   * project's persisted file set is unfit for preview, otherwise null
   * (= proceed). Never throws — gate failures must surface as a
   * structured `failed` status, not an uncaught error.
   */
  private async runIntegrityGate(projectId: string): Promise<PreviewStatus | null> {
    const project = await this.opts.projectStore.get(projectId).catch(() => null);
    if (!project || !Array.isArray(project.files) || project.files.length === 0) {
      // Materialise a failed record so the UI sees a clean state instead
      // of an uncaught exception.
      const failedRec = this.makeFailedRecord(projectId);
      const message = !project
        ? `Project ${projectId} not found.`
        : `Project ${projectId} has no files to preview.`;
      this.records.set(projectId, failedRec);
      return this.fail(failedRec, message);
    }

    const validation = validateProjectFilesForPreview(project.files);
    if (validation.ok) return null;

    const failedRec = this.makeFailedRecord(projectId);
    this.records.set(projectId, failedRec);

    const firstIssue = validation.issues[0]!;
    const message = describePreviewFileIssue(firstIssue);
    const offendingPaths = validation.issues
      .slice(0, 10)
      .map((i) => i.path)
      .filter((p) => p && p !== '<none>');

    this.opts.logger.error('preview integrity gate FAILED', {
      event: 'preview:gate-failed',
      projectId,
      totalFiles: project.files.length,
      issueCount: validation.issues.length,
      reasons: validation.issues.slice(0, 10).map((i) => ({ path: i.path, reason: i.reason })),
      offendingPaths,
    });
    this.recordTimelineEvent(failedRec, 'runner-start', {
      details: {
        gate: 'file-integrity',
        ok: false,
        issueCount: validation.issues.length,
        offendingPaths,
      },
    });

    // Best-effort diagnostic dump so engineers can inspect the exact
    // file shape that tripped the gate without re-running generation.
    await this.dumpStageFailure(
      projectId,
      project.files,
      validation.issues.map((i) => ({
        path: i.path,
        reason: i.reason,
        typeofContent: i.typeofContent,
      })),
      new Error(message),
    ).catch(() => {});

    // Compose a multi-issue summary when several files failed so the
    // user-facing error names every offending path, not just the first.
    const composed = validation.issues.length === 1
      ? message
      : `${message} (${validation.issues.length - 1} more issue(s): ${offendingPaths.slice(1, 6).join(', ')})`;
    return this.fail(failedRec, composed);
  }

  private makeFailedRecord(projectId: string): PreviewRecord {
    const startTs = Date.now();
    return {
      projectId,
      previewId: newPreviewId(),
      state: 'starting',
      stack: null,
      imageTag: null,
      containerId: null,
      hostPort: null,
      startedAt: startTs,
      lastAccessedAt: startTs,
      error: null,
      log: '',
      mode: this.dockerAvailable ? 'docker' : 'local',
      runtime: { type: this.dockerAvailable ? 'docker' : 'local', envSafe: pickSafeEnv(process.env) },
      startedAtIso: new Date(startTs).toISOString(),
      readyAtIso: null,
      lastMeaningfulStep: 'integrity gate',
      history: [{ step: 'gate:file-integrity', at: new Date(startTs).toISOString() }],
      step: 'preview:queued',
      stepStartedAt: new Date(startTs).toISOString(),
      stepCompletedAt: null,
      stepDurations: [],
    };
  }
  /** Stop and remove the container; releases its port. Idempotent. */
  async stop(projectId: string): Promise<void> {
    const rec = this.records.get(projectId);
    if (!rec) return;
    // Local runner: kill the dev process. (`local-fallback` is the
    // same backend as `local`, just engaged after a docker failure.)
    if (rec.mode === 'local' || rec.mode === 'local-fallback') {
      await this.opts.localRunner?.stop(projectId).catch(() => {});
      // localRunner releases its own allocated port internally.
      this.markPreviewStep(rec, 'stopped', `${rec.mode}-runner stopped`);
      rec.containerId = null;
      rec.hostPort = null;
      this.records.delete(projectId);
      return;
    }
    // Fullstack stack: tear down compose project.
    if (rec.composeProject) {
      const contextDir = this.opts.projectStore.getOutputDir(projectId);
      await this.opts.docker.composeDown(rec.composeProject, contextDir).catch(() => {});
    }
    if (rec.containerId) {
      await this.opts.docker.stop(rec.containerId).catch(() => {});
    }
    if (rec.hostPort != null) {
      this.opts.ports.release(rec.hostPort);
    }
    if (rec.apiHostPort != null) {
      this.opts.ports.release(rec.apiHostPort);
    }
    this.markPreviewStep(rec, 'stopped', 'container stopped');
    rec.containerId = null;
    rec.hostPort = null;
    rec.apiHostPort = null;
    rec.composeProject = null;
    this.records.delete(projectId);
  }

  /** Stop everything — call on API shutdown. */
  async shutdown(): Promise<void> {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
    const ids = [...this.records.keys()];
    await Promise.all(ids.map((id) => this.stop(id)));
    if (this.opts.localRunner) await this.opts.localRunner.shutdown().catch(() => {});
  }

  // ── internals ─────────────────────────────────────────

  private toStatus(rec: PreviewRecord): PreviewStatus {
    const state = this.toPublicPreviewStatus(rec.state, rec);
    const health = this.toPublicPreviewHealth(rec, state);
    return {
      projectId: rec.projectId,
      state,
      health,
      stack: rec.stack?.kind ?? null,
      url: state === 'ready' && rec.hostPort != null
        ? `/preview/${rec.projectId}/`
        : null,
      hostPort: rec.hostPort,
      apiHostPort: rec.apiHostPort ?? null,
      error: rec.error,
      log: rec.log,
      uptimeMs: rec.startedAt ? Date.now() - rec.startedAt : 0,
      mode: rec.mode,
      startedAtIso: rec.startedAtIso,
      readyAtIso: rec.readyAtIso ?? null,
      lastMeaningfulStep: rec.lastMeaningfulStep,
      history: rec.history,
      timeline: rec.timeline,
      previewId: rec.previewId,
      exitInfo: rec.exitInfo,
      step: rec.step,
      stepStartedAt: rec.stepStartedAt,
      stepCompletedAt: rec.stepCompletedAt ?? null,
      stepDurations: rec.stepDurations,
      fallbackErrors: rec.fallbackErrors,
      overlayDetection: rec.overlayDetection,
      dependencyFixes: rec.dependencyFixes,
      previewFixAttempts: rec.previewFixAttempts,
    };
  }

  private async doStart(projectId: string): Promise<PreviewStatus> {
    const contextDir = this.opts.projectStore.getOutputDir(projectId);

    // Evict if over capacity.
    await this.evictIfFull();

    const startTs = Date.now();
    const previewId = newPreviewId();
    const record: PreviewRecord = {
      projectId,
      previewId,
      state: 'detecting',
      stack: null,
      imageTag: null,
      containerId: null,
      hostPort: null,
      startedAt: startTs,
      lastAccessedAt: startTs,
      error: null,
      log: '',
      mode: 'docker',
      runtime: { type: 'docker', envSafe: pickSafeEnv(process.env) },
      startedAtIso: new Date(startTs).toISOString(),
      readyAtIso: null,
      lastMeaningfulStep: 'detecting stack',
      history: [{ step: 'detecting:start', at: new Date(startTs).toISOString() }],
      step: 'preview:queued',
      stepStartedAt: new Date(startTs).toISOString(),
      stepCompletedAt: null,
      stepDurations: [],
    };
    this.records.set(projectId, record);

    // Initial mirror onto ProjectRecord.preview ('preparing'). Lets
    // polling clients show "Preview starting…" the instant generation
    // completes, even before docker build kicks in.
    void this.syncPreviewToProject(record).catch(() => {});
    this.opts.logger.info('preview: starting docker runtime', {
      event: 'preview:runtime-start',
      runtime: 'docker',
      projectId,
      previewId,
      contextDir,
    });
    this.recordTimelineEvent(record, 'runner-start', {
      details: { mode: 'docker', contextDir, previewId },
    });

    // 1. Detect stack (= staging-files phase: we're reading the
    //    persisted file tree off disk and choosing the dockerfile).
    this.enterStep(record, 'preview:staging-files');

    // 1a. Dependency preflight — re-scan the persisted source tree
    //     for bare-module imports and auto-add anything missing from
    //     package.json. Runs BEFORE detectStack so the patched
    //     package.json is on disk by the time `docker build` reads it.
    try {
      await this.runDepPreflight(record);
    } catch (err) {
      return this.fail(record, (err as Error).message);
    }

    let stack: StackInfo;
    try {
      stack = detectStack(contextDir);
    } catch (err) {
      return this.fail(record, `Stack detection failed: ${(err as Error).message}`);
    }
    record.stack = stack;

    if (!isRunnableStack(stack.kind)) {
      return this.fail(record, `Cannot preview: ${stack.detectionNote}`);
    }

    // ── Fullstack monorepo branch (web + api + postgres via compose) ──
    if (stack.kind === 'fullstack') {
      return this.doStartFullstack(record, contextDir);
    }

    // 2. Build (docker build runs `npm install` AND the framework's
    //    build inside the same image; we don't get a clean install /
    //    build split here, so map the whole thing to preview:building.
    //    The local-runner path DOES split install vs starting-server.)
    this.enterStep(record, 'preview:building');
    this.markPreviewStep(record, 'building', 'docker build (npm install)');
    this.recordTimelineEvent(record, 'build-start', {
      details: { stack: stack.kind, port: stack.port },
    });
    const imageTag = `devteam-preview/${projectId.toLowerCase()}:latest`;
    record.imageTag = imageTag;
    const dockerfile = getDockerfile(stack);

    const build = await this.opts.docker.build({
      contextDir,
      dockerfileContents: dockerfile,
      imageTag,
      timeoutMs: this.opts.buildTimeoutMs,
      // Always include a .dockerignore so node_modules/.git aren't copied.
      ensureFiles: { '.dockerignore': DEFAULT_DOCKERIGNORE },
    });
    record.log = build.log;
    if (!build.ok) {
      this.recordTimelineEvent(record, 'build-end', {
        details: { ok: false, imageTag },
        stdout: build.log,
      });
      return this.fail(record, {
        reason: 'Docker build failed',
        stderrTail: PreviewManager.tail(build.log),
        lastSuccessfulStep: 'docker build started',
      });
    }
    this.recordTimelineEvent(record, 'build-end', {
      details: { ok: true, imageTag },
      stdout: build.log,
    });

    // 3. Run
    this.enterStep(record, 'preview:spawning-server');
    this.markPreviewStep(record, 'starting', 'docker run + health probe');
    const hostPort = await this.opts.ports.allocate();
    record.hostPort = hostPort;
    this.recordTimelineEvent(record, 'port-assigned', {
      details: { hostPort, containerPort: stack.port },
    });
    const containerName = `devteam-preview-${projectId.toLowerCase()}`;
    record.runtime = {
      ...(record.runtime ?? { type: 'docker' }),
      type: 'docker',
      cmd: 'docker run',
      args: ['-d', '--rm', '--name', containerName, '-p', `${hostPort}:${stack.port}`, imageTag],
      cwd: contextDir,
      port: hostPort,
      imageTag,
      containerName,
      envSafe: record.runtime?.envSafe ?? pickSafeEnv(process.env),
    };
    this.opts.logger.info('preview: docker run', {
      event: 'preview:runtime-spawn',
      runtime: 'docker',
      projectId,
      previewId: record.previewId,
      imageTag,
      containerName,
      hostPort,
      containerPort: stack.port,
      contextDir,
    });
    const run = await this.opts.docker.run({
      imageTag,
      containerName,
      hostPort,
      containerPort: stack.port,
      memory: '1g',
      cpus: '1',
    });
    if (!run.ok || !run.containerId) {
      this.opts.ports.release(hostPort);
      record.hostPort = null;
      record.log = `${record.log}\n\n=== docker run ===\n${run.log}`;
      return this.fail(record, {
        reason: 'Docker run failed',
        stderrTail: PreviewManager.tail(run.log),
        lastSuccessfulStep: 'docker build complete',
      });
    }
    record.containerId = run.containerId;
    if (record.runtime) record.runtime.containerId = run.containerId;
    this.recordTimelineEvent(record, 'devserver-start', {
      details: { containerId: run.containerId, containerName, hostPort },
      stdout: run.log,
    });

    // 4. Health check
    // Two-phase wait inside the awaitHealthy budget:
    //   • preview:waiting-for-port — TCP-listen on hostPort.
    //   • preview:http-probing     — GET healthPath returns non-error.
    // awaitHealthy doesn't expose the boundary, so we mark
    // waiting-for-port up-front and flip to http-probing once the
    // probe loop has started returning ANY HTTP response (success or
    // 5xx). For docker the cheap heuristic is: enter http-probing
    // 1.5s after waiting-for-port (well before any reasonable dev
    // server has listened, so the UI message is "waiting for port"
    // for the first connect attempt). The transition is best-effort —
    // it never races the actual readiness check.
    this.enterStep(record, 'preview:waiting-for-port');
    const probeFlipTimer = setTimeout(() => {
      const live = this.records.get(projectId);
      if (live && live.step === 'preview:waiting-for-port') {
        this.enterStep(live, 'preview:http-probing');
      }
    }, 1_500);
    const budget = bootBudgetMs(stack.kind);
    const healthy = await this.opts.docker.awaitHealthy(
      hostPort,
      stack.healthPath,
      budget,
      (attempt) => {
        // Mirror every probe onto the manager record so the timeout
        // dump and the persisted preview state see the same probe
        // history that the local-runner path already provides.
        try { this.recordProbeAttempt(record, attempt); }
        catch (err) {
          this.opts.logger.warn('preview: docker awaitHealthy probe-mirror threw', {
            projectId, error: (err as Error).message,
          });
        }
      },
    );
    clearTimeout(probeFlipTimer);
    if (record.step === 'preview:waiting-for-port') {
      this.enterStep(record, 'preview:http-probing');
    }
    if (!healthy.ok) {
      // Append container logs to help diagnose, AND probe `docker
      // inspect` for the exit code/signal/OOM flag so the user-facing
      // error explains *why* the container died rather than just "it
      // didn't respond". inspectExit is best-effort — if the container
      // is already gone we fall through with all-null fields.
      const tail = await this.opts.docker.logs(run.containerId).catch(() => '');
      const inspect = await this.opts.docker.inspectExit(run.containerId).catch(() => ({
        exitCode: null, oomKilled: false, error: null, finishedAt: null,
      }));
      record.log = `${record.log}\n\n=== container logs (tail) ===\n${tail}`;
      return this.fail(record, {
        reason: `Dev server did not become healthy within ${budget}ms (last status: ${healthy.lastStatus ?? 'no response'})`,
        exitCode: inspect.exitCode,
        oomKilled: inspect.oomKilled,
        dockerError: inspect.error,
        stderrTail: PreviewManager.tail(tail),
        lastSuccessfulStep: 'docker container started',
      });
    }
    this.recordTimelineEvent(record, 'http-probe-ok', {
      details: { hostPort, healthPath: stack.healthPath, lastStatus: healthy.lastStatus ?? null },
    });

    // Content-health gate: a 2xx response is necessary but not
    // sufficient. The dev server may be serving its build/runtime
    // error overlay. Reject the readiness if any sentinel matches.
    const contentFail = await this.verifyContentHealth(record, hostPort, stack.healthPath);
    if (contentFail) return contentFail;

    this.enterStep(record, 'preview:ready');
    this.markPreviewStep(record, 'ready', `dev server healthy on :${record.hostPort}`);
    this.recordTimelineEvent(record, 'url-published', {
      details: { url: `/preview/${projectId}/`, hostPort, stack: stack.kind },
    });
    record.lastAccessedAt = Date.now();
    // DURABILITY GATE: don't return 'ready' to the caller until the
    // ProjectRecord.preview write has landed on disk. Without this,
    // the in-memory record reports ready/url but a /api/projects/:id
    // poll could still read previewStatus='starting' for the brief
    // window before the fire-and-forget syncPreviewToProject lands.
    await record.pendingSync;
    this.opts.logger.info('Preview ready', { projectId, hostPort, stack: stack.kind });
    return this.toStatus(record);
  }

  /**
   * Local fallback: stage files and spawn `npm run dev` on the host (no Docker).
   * Returns once the dev server starts accepting HTTP connections on the
   * allocated port. The same `/preview/:id/*` reverse proxy still applies, but
   * `previewIframeUrl()` on the client will point directly at
   * `http://localhost:<hostPort>/` so HMR + asset URLs work natively.
   */
  private async doStartLocal(
    projectId: string,
    fallbackOpts?: { fallbackFromDockerError: string },
  ): Promise<PreviewStatus> {
    if (!this.opts.localRunner) {
      throw new Error('Local preview runner is not configured.');
    }
    const project = await this.opts.projectStore.get(projectId);
    if (!project || !project.files || project.files.length === 0) {
      throw new Error(`Project ${projectId} has no files to run.`);
    }

    // Evict if over capacity.
    await this.evictIfFull();

    const startTs = Date.now();
    const previewId = newPreviewId();
    const isFallback = Boolean(fallbackOpts);
    const runtimeMode: 'local' | 'local-fallback' = isFallback ? 'local-fallback' : 'local';
    const record: PreviewRecord = {
      projectId,
      previewId,
      state: 'starting',
      stack: null,
      imageTag: null,
      containerId: null,
      hostPort: null,
      startedAt: startTs,
      lastAccessedAt: startTs,
      error: null,
      log: '',
      mode: runtimeMode,
      runtime: { type: runtimeMode, envSafe: pickSafeEnv(process.env) },
      startedAtIso: new Date(startTs).toISOString(),
      readyAtIso: null,
      lastMeaningfulStep: isFallback ? 'local-fallback runner starting' : 'local runner starting',
      history: [{
        step: isFallback ? 'starting:local-fallback' : 'starting:local-runner',
        at: new Date(startTs).toISOString(),
      }],
      step: 'preview:queued',
      stepStartedAt: new Date(startTs).toISOString(),
      stepCompletedAt: null,
      stepDurations: [],
      // Carry the docker error forward so a subsequent fail() can
      // compose a dual-failure message AND so syncPreviewToProject
      // mirrors `previewFallbackErrors.docker` immediately (lets the
      // UI show "docker failed, trying local…" while we boot).
      fallbackErrors: isFallback
        ? { docker: fallbackOpts!.fallbackFromDockerError, local: null }
        : undefined,
    };
    this.records.set(projectId, record);

    // Initial mirror onto ProjectRecord.preview. Local runner goes
    // straight to 'installing' (npm install) before flipping to 'ready'.
    void this.syncPreviewToProject(record).catch(() => {});
    this.opts.logger.info(
      isFallback
        ? 'preview: starting local-fallback runtime (after docker failure)'
        : 'preview: starting local runtime',
      {
        event: 'preview:runtime-start',
        runtime: runtimeMode,
        projectId,
        previewId,
        fileCount: project.files.length,
        ...(isFallback ? { dockerErrorTail: fallbackOpts!.fallbackFromDockerError.slice(-500) } : {}),
      },
    );
    this.recordTimelineEvent(record, 'runner-start', {
      details: { mode: runtimeMode, fileCount: project.files.length, ...(isFallback ? { fallbackFromDocker: true } : {}) },
    });
    this.recordTimelineEvent(record, 'install-start', {
      details: { mode: runtimeMode },
    });

    try {
      // Pre-flight validation: refuse to stage if any file entry is
      // malformed. We fail clean here rather than letting an
      // `undefined` slip into `fs.writeFile` and crash with the cryptic
      // low-level "data argument must be of type string …" error.
      this.enterStep(record, 'preview:staging-files');

      // Dependency preflight — re-scan project.files for missing
      // imports and auto-add them to package.json. Returns the
      // post-fix file tree so we stage the patched copy (the
      // in-memory `project.files` reference is now stale w.r.t.
      // disk).
      let stagingFiles = project.files;
      try {
        const dep = await this.runDepPreflight(record);
        stagingFiles = dep.patchedFiles;
      } catch (err) {
        throw new Error((err as Error).message);
      }

      const validation = validateProjectFilesForPreview(stagingFiles);
      if (!validation.ok) {
        const firstIssue = validation.issues[0]!;
        const message = describePreviewFileIssue(firstIssue);
        this.opts.logger.error('local preview: file validation failed', {
          projectId,
          totalFiles: project.files.length,
          issueCount: validation.issues.length,
          firstFailingPath: validation.firstFailingPath,
          issuesSample: validation.issues.slice(0, 20),
        });
        await this.dumpStageFailure(
          projectId,
          project.files,
          validation.issues.map((i) => ({
            path: i.path,
            reason: i.reason,
            typeofContent: i.typeofContent,
          })),
          new Error(message),
        ).catch(() => {});
        // Throw a structured error so the catch block below maps it
        // onto previewStatus=failed + previewError=<message>.
        throw new Error(message);
      }
      this.opts.logger.info('local preview: staging files', {
        projectId,
        fileCount: validation.staged.length,
        sample: validation.staged.slice(0, 5).map((f) => ({ path: f.path, bytes: f.contents.length })),
      });
      // local-runner.start() runs install → spawn dev → waitForReady
      // serially inside one call. We use its `onPhase` callback to
      // drive precise step transitions:
      //
      //   preview:installing      ── install phase running
      //   preview:spawning-server ── about to spawn(npm run dev …)
      //   preview:waiting-for-port── child PID exists, polling TCP
      //   preview:http-probing    ── (collapsed: waitForReady IS HTTP-probing)
      //   preview:ready
      //
      // `preview:building` is a docker-only concept (image build); it
      // never appears for the local runner.
      this.enterStep(record, 'preview:installing');
      // First-probe latch — used to promote step from
      // preview:waiting-for-port → preview:http-probing the moment
      // the readiness loop issues its first HTTP attempt. Lets the
      // dump distinguish "TCP never opened" (stuck in waiting-for-port)
      // from "HTTP never returned a usable response" (stuck in
      // http-probing).
      let firstProbeSeen = false;
      const onPhase = (
        phase: 'spawning-server' | 'waiting-for-port',
        meta?: {
          pid?: number | null;
          port?: number | null;
          host?: string;
          cmd?: string;
          args?: string[];
          cwd?: string;
          envSafe?: Record<string, string>;
        },
      ) => {
        // Best-effort: never let a progress callback abort boot.
        try {
          // Stamp every meta field we receive onto record.runtime so
          // the persisted dump reflects the live spawn args even
          // before the child actually binds a port. We retain the
          // structured `args` array (not just a flattened string)
          // so the forensic dump can replay the exact argv.
          record.runtime = {
            ...(record.runtime ?? { type: 'local' }),
            type: record.runtime?.type ?? 'local',
            cmd: meta?.cmd ?? record.runtime?.cmd,
            args: meta?.args ?? record.runtime?.args,
            cwd: meta?.cwd ?? record.runtime?.cwd,
            port: meta?.port ?? record.runtime?.port ?? null,
            envSafe: meta?.envSafe ?? record.runtime?.envSafe ?? pickSafeEnv(process.env),
          };
          this.captureRuntimeLog(record, meta?.pid ?? null);
          if (phase === 'spawning-server') {
            this.enterStep(record, 'preview:spawning-server');
          } else if (phase === 'waiting-for-port') {
            this.enterStep(record, 'preview:waiting-for-port');
          }
        } catch (err) {
          this.opts.logger.warn('preview: local-runner onPhase callback threw', {
            projectId,
            phase,
            error: (err as Error).message,
          });
        }
      };
      const onProbe = (attempt: ProbeAttempt) => {
        // Mirror every probe onto the manager-side record so the
        // forensic dump (which reads from PreviewRecord, not the
        // local-runner buffers) sees the same attempt history.
        // Best-effort: never let mirror failures abort boot.
        try {
          // Promote step on the first probe — once the readiness
          // loop has actually started issuing HTTP attempts we are
          // no longer "waiting for the port to open"; we're
          // probing it.
          if (!firstProbeSeen) {
            firstProbeSeen = true;
            this.enterStep(record, 'preview:http-probing');
          }
          this.recordProbeAttempt(record, attempt);
        } catch (err) {
          this.opts.logger.warn('preview: probe-attempt mirror threw', {
            projectId,
            error: (err as Error).message,
          });
        }
      };

      // ── ONE SAFE RETRY ─────────────────────────────────────
      // Local startup is occasionally flaky for transient reasons
      // (port-bind race after install, dev-server crash on first
      // boot, EBUSY on Windows). Retry exactly once when the FIRST
      // attempt failed BEFORE any TCP probe connected to the port.
      // Once the port has accepted a connection the failure is
      // deterministic (post-bind crash, overlay, content-health) and
      // a retry would just mask a real bug, so we let it surface.
      // The retry never runs more than once — a permanent failure
      // (peer-dep mismatch, missing module) will fail the second
      // attempt the same way and surface to the user.
      record.localStartAttempts = [];
      let lr: Awaited<ReturnType<typeof this.opts.localRunner.start>> | null = null;
      for (let attempt = 1 as 1 | 2; attempt <= 2; attempt = (attempt + 1) as 1 | 2) {
        const attemptStartedAt = Date.now();
        const attemptStartedIso = new Date(attemptStartedAt).toISOString();
        // Reset the first-probe latch so the second attempt's
        // step-progression is independent of the first.
        firstProbeSeen = false;
        try {
          lr = await this.opts.localRunner.start(
            projectId,
            validation.staged,
            onPhase,
            onProbe,
          );
          const attemptEndedAt = Date.now();
          record.localStartAttempts.push({
            attempt,
            ok: true,
            error: null,
            portOpened: true,
            durationMs: attemptEndedAt - attemptStartedAt,
            startedAtIso: attemptStartedIso,
            endedAtIso: new Date(attemptEndedAt).toISOString(),
          });
          if (attempt === 2) {
            record.localRetrySucceeded = true;
            this.opts.logger.info('preview: local-runner retry succeeded', {
              event: 'preview:local-retry-succeeded',
              projectId,
              previewId,
              durationMs: attemptEndedAt - attemptStartedAt,
            });
          }
          break;
        } catch (startErr) {
          const attemptEndedAt = Date.now();
          const startMsg = (startErr as Error).message;
          // Determine whether the port was ever observed open during
          // this attempt — single source of truth is the live runner
          // record's probeAttempts plus our mirror.
          const lrSnap = this.opts.localRunner.get(projectId);
          const portOpened =
            (lrSnap?.probeAttempts ?? []).some((a) => a.tcpConnected || a.ok)
            || (record.probeAttempts ?? []).some((a) => a.tcpConnected || a.ok);
          record.localStartAttempts.push({
            attempt,
            ok: false,
            error: startMsg,
            portOpened,
            durationMs: attemptEndedAt - attemptStartedAt,
            startedAtIso: attemptStartedIso,
            endedAtIso: new Date(attemptEndedAt).toISOString(),
          });
          // Eligible for retry?
          //   - first attempt only
          //   - port never observed open
          //   - error is not an ERESOLVE peer-dep conflict (deterministic;
          //     retry would change nothing and just slow the failure path)
          const isEresolve = Boolean((startErr as Error & { eresolve?: unknown }).eresolve);
          const canRetry = attempt === 1 && !portOpened && !isEresolve;
          if (!canRetry) {
            if (attempt === 2) {
              record.localRetrySucceeded = false;
              this.opts.logger.warn('preview: local-runner retry also failed', {
                event: 'preview:local-retry-failed',
                projectId,
                previewId,
                firstError: record.localStartAttempts[0]?.error ?? null,
                retryError: startMsg,
              });
            }
            // Best-effort sync so the persisted preview block reflects
            // the attempt history even though we're about to throw
            // into the outer catch (which will fail() the record).
            void this.syncPreviewToProject(record).catch(() => {});
            throw startErr;
          }
          this.opts.logger.warn('preview: local-runner first attempt failed before port opened — retrying once', {
            event: 'preview:local-retry-scheduled',
            projectId,
            previewId,
            error: startMsg,
            durationMs: attemptEndedAt - attemptStartedAt,
            isEresolve,
            portOpened,
          });
          this.recordTimelineEvent(record, 'install-end', {
            details: { ok: false, error: startMsg, attempt: 1, willRetry: true },
          });
          // Tear down whatever the runner left behind so the second
          // attempt starts from a clean slate (no stale child, no
          // half-bound port). stop() is idempotent and tolerates a
          // record that never reached spawn.
          try {
            await this.opts.localRunner.stop(projectId);
          } catch (stopErr) {
            this.opts.logger.warn('preview: pre-retry stop() failed (non-fatal)', {
              projectId,
              error: (stopErr as Error).message,
            });
          }
          // Fixed 2-second cool-off before the retry. Long enough for
          // the OS to reclaim the port + for any flaky filesystem
          // handle (.install.fp, .next cache) to settle, short enough
          // that the user-perceived boot time stays bounded.
          await new Promise((r) => setTimeout(r, 2000));
          // Reset step so the retry shows a clean install→spawn
          // progression instead of inheriting the failed attempt's
          // last step.
          this.enterStep(record, 'preview:installing');
          // Mirror retry attempt onto the persisted preview block
          // BEFORE the second start() so the dashboard sees the
          // retry-in-progress state.
          void this.syncPreviewToProject(record).catch(() => {});
          continue;
        }
      }
      if (!lr) {
        // Defensive: the loop above either assigns `lr` or throws.
        // This branch only runs if the control-flow invariant is
        // violated by a future refactor.
        throw new Error('Local runner start loop completed without producing a runner record');
      }
      record.stack = lr.stack;
      record.hostPort = lr.port;
      record.log = lr.log;
      // Final live-log snapshot once readiness has resolved.
      this.captureRuntimeLog(record, lr.child?.pid ?? null);
      this.recordTimelineEvent(record, 'install-end', {
        details: { ok: true, stack: lr.stack.kind },
        stdout: lr.log,
      });
      this.recordTimelineEvent(record, 'port-assigned', {
        details: { hostPort: lr.port },
      });
      this.recordTimelineEvent(record, 'devserver-start', {
        details: { mode: 'local', hostPort: lr.port, stack: lr.stack.kind },
      });
      this.recordTimelineEvent(record, 'http-probe-ok', {
        details: { hostPort: lr.port, mode: 'local' },
      });
      // Content-health gate (see verifyContentHealth doc).
      const contentFail = await this.verifyContentHealth(record, lr.port, '/');
      if (contentFail) return contentFail;
      this.enterStep(record, 'preview:ready');
      this.markPreviewStep(record, 'ready', `local dev server on :${lr.port}`);
      this.recordTimelineEvent(record, 'url-published', {
        details: { url: `/preview/${projectId}/`, hostPort: lr.port, mode: 'local', stack: lr.stack.kind },
      });
      record.lastAccessedAt = Date.now();
      // DURABILITY GATE — see equivalent block in doStart().
      await record.pendingSync;
      this.opts.logger.info('Local preview ready', {
        projectId, hostPort: lr.port, stack: lr.stack.kind,
      });
      return this.toStatus(record);
    } catch (err) {
      const msg = (err as Error).message;
      const lr = this.opts.localRunner.get(projectId);
      if (lr?.log) record.log = lr.log;
      // Mirror runner-level metadata onto the record so the diagnostic
      // dump shows cmd/cwd/port even when staging failed before spawn.
      if (lr) {
        record.runtime = {
          ...(record.runtime ?? { type: runtimeMode }),
          type: runtimeMode,
          cwd: lr.stagingDir,
          port: lr.port,
        };
      }
      this.recordTimelineEvent(record, 'install-end', {
        details: { ok: false, error: msg },
        stderr: lr?.stderrLog ?? lr?.log,
      });
      // If the local-runner attached a structured ERESOLVE report onto
      // the thrown error (see local-runner.runInstall), use the parser's
      // headline directly as `previewError` instead of layering a
      // "Local preview failed: npm install failed: <headline>" prefix
      // chain. The conflict-naming headline is already self-describing
      // and the dashboard quote would otherwise be cluttered with
      // generic prefixes that obscure the actual peer-dep mismatch.
      const eresolve = (err as Error & { eresolve?: unknown }).eresolve;
      const failureReason = eresolve
        ? (isFallback ? `Local-fallback preview failed: ${msg}` : msg)
        : (isFallback
            ? `Local-fallback preview failed (after docker also failed): ${msg}`
            : `Local preview failed: ${msg}`);
      // If this was a fallback attempt, capture the local error onto
      // record.fallbackErrors.local BEFORE fail() composes the
      // user-facing message — fail() will surface both errors.
      if (isFallback && record.fallbackErrors) {
        record.fallbackErrors.local = `Local preview failed: ${msg}`;
      }
      // Local-runner-specific forensic dump. Distinct from
      // dumpRuntimeFailure (which fail() also writes) because this
      // file carries the LOCAL lifecycle facts engineers need to make
      // an intermittent local-fallback failure reproducible — exact
      // command + args, child pid, install-completed flag,
      // server-spawned flag, port-ever-opened flag, full stdout/stderr
      // tails. Best-effort: never let dump-write failures mask the
      // original preview failure.
      void this.dumpLocalPreviewFailure(record, lr, msg).catch((dumpErr) => {
        this.opts.logger.warn('preview: failed to write last-local-preview-failure.json', {
          projectId,
          error: (dumpErr as Error).message,
        });
      });
      return this.fail(record, {
        reason: failureReason,
        exitCode: lr?.exitCode ?? null,
        signal: lr?.exitSignal ?? null,
        stdoutTail: PreviewManager.tail(lr?.stdoutLog),
        stderrTail: PreviewManager.tail(lr?.stderrLog ?? lr?.log),
        lastSuccessfulStep: lr?.lastSuccessfulStep,
        stack: (err as Error).stack,
      });
    }
  }

  /**
   * Fullstack preview: bring up postgres + api + web via docker compose, with
   * a per-project compose project name to allow multiple previews concurrently
   * and a generated override file that maps web/api to allocated host ports
   * and wires NEXT_PUBLIC_API_URL so the iframe-loaded frontend can reach the
   * backend from the host browser.
   */
  private async doStartFullstack(record: PreviewRecord, contextDir: string): Promise<PreviewStatus> {
    const projectId = record.projectId;
    // Compose builds + starts in a single command, so we go straight
    // from staging-files (the generated compose context already on
    // disk) to building.
    this.enterStep(record, 'preview:building');
    this.markPreviewStep(record, 'building', 'compose build (web + api + postgres)');
    this.recordTimelineEvent(record, 'build-start', {
      details: { mode: 'fullstack-compose' },
    });

    // Allocate two host ports: one for web, one for api. The browser running
    // inside the iframe sees both via 127.0.0.1:<port>.
    const webHostPort = await this.opts.ports.allocate();
    record.hostPort = webHostPort;
    let apiHostPort: number;
    try {
      apiHostPort = await this.opts.ports.allocate();
    } catch (err) {
      this.opts.ports.release(webHostPort);
      record.hostPort = null;
      return this.fail(record, `Could not allocate api host port: ${(err as Error).message}`);
    }
    record.apiHostPort = apiHostPort;
    this.recordTimelineEvent(record, 'port-assigned', {
      details: { webHostPort, apiHostPort },
    });

    const composeProject = `devteam-prv-${projectId.toLowerCase()}`;
    record.composeProject = composeProject;

    // Compose merges `ports:` across base + override (concat). Generated
    // docker-compose.yml hardcodes 3000:3000/4000:4000 which collides with
    // host ports already in use. Strip those before composeUp so only our
    // override (with allocated host ports) publishes anything.
    await stripPublishedPortsForOverride(contextDir, (s) => { record.log = `${record.log}${s}\n`; });

    // Override file: remap published ports + inject NEXT_PUBLIC_API_URL.
    // Keeps service names from the generated compose file (web, api, postgres).
    const override = [
      'services:',
      '  web:',
      '    ports:',
      `      - "${webHostPort}:3000"`,
      '    environment:',
      `      NEXT_PUBLIC_API_URL: "http://localhost:${apiHostPort}"`,
      '      PORT: "3000"',
      '      HOSTNAME: "0.0.0.0"',
      '  api:',
      '    ports:',
      `      - "${apiHostPort}:4000"`,
      '    environment:',
      '      DATABASE_URL: "postgresql://postgres:postgres@postgres:5432/app?schema=public"',
      '      PORT: "4000"',
      '  postgres:',
      // Don't publish postgres on a fixed port — keeps host port pool free.
      // It's reachable via the compose network as `postgres:5432`.
      '    ports: []',
      '',
    ].join('\n');

    const up = await this.opts.docker.composeUp({
      contextDir,
      projectName: composeProject,
      overrideContents: override,
      timeoutMs: this.opts.buildTimeoutMs,
    });
    record.log = up.log;
    if (!up.ok) {
      this.opts.ports.release(webHostPort);
      this.opts.ports.release(apiHostPort);
      record.hostPort = null;
      record.apiHostPort = null;
      record.composeProject = null;
      this.recordTimelineEvent(record, 'build-end', {
        details: { ok: false }, stderr: up.log,
      });
      return this.fail(record, {
        reason: 'docker compose up failed',
        stderrTail: PreviewManager.tail(up.log),
        lastSuccessfulStep: 'compose context staged',
      });
    }
    this.recordTimelineEvent(record, 'build-end', {
      details: { ok: true, composeProject }, stdout: up.log,
    });

    // Compose stack is up; web/api containers are starting their dev
    // servers. Map this to preview:spawning-server so the UI shows the
    // boot is mid-flight, then preview:http-probing once we begin the
    // health probe.
    this.enterStep(record, 'preview:spawning-server');

    // Health-check loop: web first (the iframe target). If web becomes
    // healthy, return ready. We also probe the api separately and surface
    // its log tail when web is up but api is down — so the QA auto-fix loop
    // can pick up the failure as runtimeFeedback.
    this.markPreviewStep(record, 'starting', 'compose up — awaiting web health');
    this.recordTimelineEvent(record, 'devserver-start', {
      details: { webHostPort, apiHostPort, composeProject },
    });
    this.enterStep(record, 'preview:http-probing');
    const budget = bootBudgetMs('fullstack');
    const webHealthy = await this.opts.docker.awaitHealthy(
      webHostPort,
      '/',
      budget,
      (attempt) => {
        try { this.recordProbeAttempt(record, attempt); }
        catch (err) {
          this.opts.logger.warn('preview: fullstack awaitHealthy probe-mirror threw', {
            projectId, error: (err as Error).message,
          });
        }
      },
    );
    if (!webHealthy.ok) {
      const webLog = await this.opts.docker.composeLogs(composeProject, contextDir, 'web', 200).catch(() => '');
      const apiLog = await this.opts.docker.composeLogs(composeProject, contextDir, 'api', 200).catch(() => '');
      const dbLog  = await this.opts.docker.composeLogs(composeProject, contextDir, 'postgres', 100).catch(() => '');
      record.log = [
        record.log,
        '\n=== web logs ===',  webLog,
        '\n=== api logs ===',  apiLog,
        '\n=== postgres logs ===', dbLog,
      ].join('\n');
      return this.fail(record, {
        reason: `web service did not become healthy within ${budget}ms (last status: ${webHealthy.lastStatus ?? 'no response'})`,
        stderrTail: PreviewManager.tail(`=== web ===\n${webLog}\n=== api ===\n${apiLog}`),
        lastSuccessfulStep: 'compose stack started',
      });
    }
    this.recordTimelineEvent(record, 'http-probe-ok', {
      details: { hostPort: webHostPort, healthPath: '/', lastStatus: webHealthy.lastStatus ?? null, service: 'web' },
    });

    // Content-health gate on the web service (see verifyContentHealth
    // doc). Run before we even consider the api probe — a fullstack
    // preview where the iframe shows a build overlay is no more usable
    // than a frontend-only one.
    const contentFail = await this.verifyContentHealth(record, webHostPort, '/');
    if (contentFail) return contentFail;

    // Verify api too — non-fatal if down, but include in log so the runtime
    // validator + auto-fix loop can drive QA to fix it.
    const apiProbe = await this.opts.docker.httpProbe(apiHostPort, '/health', 4_000);
    if (!apiProbe.ok) {
      const apiLog = await this.opts.docker.composeLogs(composeProject, contextDir, 'api', 200).catch(() => '');
      record.log = `${record.log}\n\n=== api /health probe failed (status: ${apiProbe.status ?? 'no response'}) ===\n${apiLog}`;
      this.opts.logger.warn('Fullstack preview: web up but api unhealthy', { projectId, apiHostPort });
    }

    this.enterStep(record, 'preview:ready');
    this.markPreviewStep(record, 'ready', `fullstack web=:${record.hostPort} api=:${record.apiHostPort}`);
    this.recordTimelineEvent(record, 'url-published', {
      details: {
        url: `/preview/${projectId}/`,
        webHostPort, apiHostPort, composeProject,
        apiHealthy: apiProbe.ok,
      },
    });
    record.lastAccessedAt = Date.now();
    // DURABILITY GATE — see equivalent block in doStart().
    await record.pendingSync;
    this.opts.logger.info('Fullstack preview ready', {
      projectId, webHostPort, apiHostPort, composeProject, apiHealthy: apiProbe.ok,
    });
    return this.toStatus(record);
  }

  /** Probe the dev server's HTML response for a Next.js / Vite / generic
   *  build-error overlay. The transport-level health probe (awaitHealthy)
   *  only checks that the port responds 2xx/3xx; this gate inspects the
   *  body and rejects responses whose HTML contains overlay sentinels
   *  ("Module not found", "Build Error", "__nextjs_original-stack-frame",
   *  …). Returns:
   *   • null            — content is healthy, caller may mark ready
   *   • PreviewStatus   — content unhealthy; caller must propagate the
   *                       returned status (record is now in 'failed').
   *
   *  `path` defaults to '/' which works for every supported stack —
   *  Next.js, Vite and CRA all serve their dev overlay on the root
   *  document. */
  private async verifyContentHealth(
    record: PreviewRecord,
    hostPort: number,
    path: string = '/',
    timeoutMs: number = 8_000,
  ): Promise<PreviewStatus | null> {
    let probe: PreviewContentProbeResult;
    try {
      probe = await probePreviewContent(hostPort, path, timeoutMs);
    } catch (err) {
      // probePreviewContent never throws by contract — but if the runtime
      // surprises us, treat it as a soft failure (LOG and proceed) so we
      // don't block a healthy preview on a bug in the probe itself.
      this.opts.logger.warn('preview content-health probe threw unexpectedly', {
        projectId: record.projectId,
        error: (err as Error).message,
      });
      return null;
    }
    if (probe.healthy) {
      this.recordTimelineEvent(record, 'http-probe-ok', {
        details: {
          stage: 'content-health',
          hostPort,
          path,
          status: probe.status,
          bodyBytes: probe.bodySample.length,
        },
      });
      return null;
    }
    if (probe.detected) {
      this.opts.logger.warn('preview content-health: dev overlay detected', {
        event: 'preview:overlay-detected',
        projectId: record.projectId,
        previewId: record.previewId,
        hostPort,
        type: probe.detected.detectedErrorType,
        module: probe.detected.affectedModule,
        message: probe.detected.detectedErrorMessage.slice(0, 240),
      });
      return this.fail(record, {
        reason:
          `Dev server reachable but rendered an error overlay ` +
          `(${probe.detected.detectedErrorType})` +
          (probe.detected.affectedModule
            ? ` for module "${probe.detected.affectedModule}"`
            : ''),
        lastSuccessfulStep: record.lastMeaningfulStep ?? 'http probe ok',
        overlayDetection: {
          ...probe.detected,
          bodySample: probe.bodySample,
        },
      });
    }
    this.opts.logger.warn('preview content-health: unhealthy without overlay', {
      event: 'preview:content-unhealthy',
      projectId: record.projectId,
      hostPort,
      status: probe.status,
      reason: probe.unhealthyReason,
    });
    return this.fail(record, {
      reason:
        `Dev server response unhealthy after http probe (status=${probe.status ?? 'no-response'}, ` +
        `reason=${probe.unhealthyReason ?? 'unknown'})`,
      lastSuccessfulStep: record.lastMeaningfulStep ?? 'http probe ok',
      stderrTail: probe.bodySample.slice(0, 4_000),
    });
  }

  private async fail(record: PreviewRecord, ctxOrMessage: string | FailureContext): Promise<PreviewStatus> {
    const ctx: FailureContext = typeof ctxOrMessage === 'string'
      ? { reason: ctxOrMessage }
      : ctxOrMessage;

    // If the boot watchdog already classified this run as a timeout,
    // PRESERVE its structured verdict — the timeout headline
    // ("Preview startup timed out while in step <step>. Last probe:
    // <reason>. Process: <classification>.") is more actionable than
    // any downstream catch-block message we'd compose here. Without
    // this guard, a teardown-induced inner failure (e.g. "dev server
    // exited before becoming ready") would clobber the timeout
    // headline + flip step from `preview:timeout` back to
    // `preview:failed`, leaving the persisted record with an empty /
    // misleading reason. We still capture exitInfo + run the rest of
    // the failure-side bookkeeping so forensics aren't lost.
    if (record.timeoutAtIso && record.step === 'preview:timeout' && record.error) {
      record.exitInfo = {
        exitCode: ctx.exitCode ?? record.exitInfo?.exitCode ?? null,
        signal: ctx.signal ?? record.exitInfo?.signal ?? null,
        oomKilled: ctx.oomKilled ?? record.exitInfo?.oomKilled ?? false,
        dockerError: ctx.dockerError ?? record.exitInfo?.dockerError ?? null,
        stdoutTail: ctx.stdoutTail ?? record.exitInfo?.stdoutTail,
        stderrTail: ctx.stderrTail ?? record.exitInfo?.stderrTail,
        lastSuccessfulStep: ctx.lastSuccessfulStep ?? record.lastMeaningfulStep,
        errorStack: ctx.stack ?? record.exitInfo?.errorStack,
        capturedAt: new Date().toISOString(),
      };
      this.snapshotProcessLifecycle(record);
      this.opts.logger.info('preview fail() suppressed by prior boot-timeout verdict', {
        event: 'preview:fail-after-timeout',
        projectId: record.projectId,
        previewId: record.previewId,
        downstreamReason: ctx.reason,
        preservedError: record.error.slice(0, 200),
      });
      // Even on the suppressed path the failure metadata (exitInfo,
      // process lifecycle) was just updated — durably persist it
      // before returning to the caller. Without the await the HTTP
      // response can race the disk write.
      await this.syncPreviewToProject(record).catch(() => {});
      return this.toStatus(record);
    }

    // Compose a multi-line `record.error` that surfaces the real failure
    // reason verbatim — exit code, signal, last successful step, and the
    // tail of stderr (or stdout if stderr is empty). This is the SAME
    // string that flows through syncPreviewToProject → ProjectRecord
    // .preview.previewError → the UI's preview-failed pane, replacing the
    // old generic "container exited unexpectedly" message.
    let composed = composeFailureMessage(ctx);
    // Dual-failure mode: this record was the local-fallback attempt
    // AND it also failed. Prepend the docker error so the user sees
    // BOTH reasons in one message and knows we exhausted the fallback
    // chain. record.fallbackErrors.local is already set by the
    // doStartLocal catch block.
    if (record.fallbackErrors?.docker) {
      composed = [
        '⚠ Both preview backends failed:',
        '',
        '── Docker attempt ──',
        record.fallbackErrors.docker,
        '',
        '── Local fallback attempt ──',
        composed,
      ].join('\n');
      // Mirror onto fallbackErrors.local for downstream consumers
      // (UI failure card, diagnostic dump). Already set in
      // doStartLocal but harmless to overwrite with the fully
      // composed message so persisted JSON shows the rich form.
      record.fallbackErrors.local = composed.split('── Local fallback attempt ──\n')[1] ?? composed;
    }
    this.markPreviewStep(record, 'failed', composed.slice(0, 200));
    record.error = composed;
    // Capture the process-lifecycle verdict on every failure path so
    // the persisted record carries "crashed (exit=1)" / "alive-not-
    // reachable" etc. — not just on the boot-watchdog timeout path.
    this.snapshotProcessLifecycle(record);
    // Stamp the structured failure timestamp BEFORE entering
    // preview:failed so syncPreviewToProject sees the new value when
    // mirroring. Distinct from the timeout marker — `failedAtIso`
    // means "the runtime gave us an explicit terminal verdict",
    // `timeoutAtIso` means "we gave up waiting".
    if (!record.failedAtIso) record.failedAtIso = new Date().toISOString();
    // Close out the current boot phase by transitioning into
    // preview:failed. enterStep() takes care of stamping
    // stepCompletedAt and appending the previous phase's duration to
    // stepDurations so the UI can show "died after 4.2s in
    // preview:installing".
    this.enterStep(record, 'preview:failed');
    // Persist forensic block on the record itself so polling clients
    // and the diagnostic dump both see the same numbers.
    record.exitInfo = {
      exitCode: ctx.exitCode ?? null,
      signal: ctx.signal ?? null,
      oomKilled: ctx.oomKilled ?? false,
      dockerError: ctx.dockerError ?? null,
      stdoutTail: ctx.stdoutTail,
      stderrTail: ctx.stderrTail,
      lastSuccessfulStep: ctx.lastSuccessfulStep ?? record.lastMeaningfulStep,
      errorStack: ctx.stack,
      capturedAt: new Date().toISOString(),
    };
    // Persist the structured overlay detection on the record (and
    // therefore on every PreviewStatus snapshot) so the UI / generation
    // runner can render the category + module without re-parsing the
    // composed `error` string.
    if (ctx.overlayDetection) {
      record.overlayDetection = {
        detectedErrorType: ctx.overlayDetection.detectedErrorType,
        detectedErrorMessage: ctx.overlayDetection.detectedErrorMessage,
        affectedModule: ctx.overlayDetection.affectedModule,
        detectedAt: new Date().toISOString(),
        bodySample: ctx.overlayDetection.bodySample?.slice(0, 2_048),
      };
    }

    this.recordTimelineEvent(record, 'failed', {
      details: {
        message: composed,
        reason: ctx.reason,
        exitCode: record.exitInfo.exitCode,
        signal: record.exitInfo.signal,
        oomKilled: record.exitInfo.oomKilled,
        lastSuccessfulStep: record.exitInfo.lastSuccessfulStep,
      },
      stdout: ctx.stdoutTail,
      stderr: ctx.stderrTail ?? record.log,
    });
    this.opts.logger.warn('Preview failed', {
      event: 'preview:runtime-failed',
      projectId: record.projectId,
      previewId: record.previewId,
      runtime: record.runtime?.type ?? record.mode,
      reason: ctx.reason,
      exitCode: record.exitInfo.exitCode,
      signal: record.exitInfo.signal,
      oomKilled: record.exitInfo.oomKilled,
      dockerError: record.exitInfo.dockerError,
      lastSuccessfulStep: record.exitInfo.lastSuccessfulStep,
      stderrTail: ctx.stderrTail?.slice(-2_000),
    });
    // Persist a structured diagnostic JSON next to last-preview-stage
    // -failure.json. Best-effort — write failures must never mask the
    // real preview failure.
    void this.dumpRuntimeFailure(record, ctx).catch(() => {});
    // Best-effort cleanup of any started container or compose stack.
    if (record.composeProject) {
      const contextDir = this.opts.projectStore.getOutputDir(record.projectId);
      void this.opts.docker.composeDown(record.composeProject, contextDir).catch(() => {});
      record.composeProject = null;
    }
    if (record.containerId) {
      void this.opts.docker.stop(record.containerId).catch(() => {});
      record.containerId = null;
    }
    if (record.hostPort != null) {
      this.opts.ports.release(record.hostPort);
      record.hostPort = null;
    }
    if (record.apiHostPort != null) {
      this.opts.ports.release(record.apiHostPort);
      record.apiHostPort = null;
    }
    // DURABILITY GATE: the markPreviewStep('failed', …) call above
    // queued a syncPreviewToProject — wait for it to land on disk
    // before returning so polling clients observe previewStatus =
    // 'failed' + previewError on the very next read.
    await record.pendingSync;
    return this.toStatus(record);
  }

  /**
   * Persist a JSON snapshot of the runtime failure to
   * `apps/api/src/testing/last-preview-runtime-failure.json`. Mirrors the
   * shape used by `last-preview-stage-failure.json` so the same triage
   * tooling can read both. Always best-effort: a write failure here
   * MUST NOT swallow the original preview failure.
   */
  private async dumpRuntimeFailure(record: PreviewRecord, ctx: FailureContext): Promise<void> {
    const dumpPath = path.resolve(
      fileURLToPath(import.meta.url),
      '..', '..', 'testing', 'last-preview-runtime-failure.json',
    );
    const payload = {
      timestamp: new Date().toISOString(),
      projectId: record.projectId,
      previewId: record.previewId,
      runtime: record.runtime?.type ?? record.mode ?? 'unknown',
      stack: record.stack?.kind ?? null,
      reason: ctx.reason,
      exitCode: ctx.exitCode ?? null,
      signal: ctx.signal ?? null,
      oomKilled: ctx.oomKilled ?? false,
      dockerError: ctx.dockerError ?? null,
      command: record.runtime?.cmd ?? null,
      commandArgs: record.runtime?.args ?? null,
      cwd: record.runtime?.cwd ?? null,
      port: record.runtime?.port ?? record.hostPort ?? null,
      envSafe: record.runtime?.envSafe ?? null,
      imageTag: record.imageTag ?? record.runtime?.imageTag ?? null,
      containerName: record.runtime?.containerName ?? null,
      containerId: record.containerId ?? record.runtime?.containerId ?? null,
      lastSuccessfulStep: ctx.lastSuccessfulStep ?? record.lastMeaningfulStep ?? null,
      stdoutTail: ctx.stdoutTail ?? null,
      stderrTail: ctx.stderrTail ?? null,
      errorStack: ctx.stack ?? null,
      currentStep: record.step ?? null,
      stepStartedAt: record.stepStartedAt ?? null,
      stepDurations: record.stepDurations ?? [],
      previewStatusTransitions: (record.history ?? []).map((h) => ({ step: h.step, at: h.at })),
      timeline: (record.timeline ?? []).slice(-32).map((e) => ({
        event: e.event,
        at: e.at,
        previewStatus: e.previewStatus,
        durationMs: e.durationMs ?? null,
        details: e.details ?? null,
      })),
    };
    try {
      await fs.mkdir(path.dirname(dumpPath), { recursive: true });
      await fs.writeFile(dumpPath, JSON.stringify(payload, null, 2), 'utf8');
      this.opts.logger.warn('preview runtime failure dump written', {
        projectId: record.projectId,
        previewId: record.previewId,
        dumpPath,
      });
    } catch (writeErr) {
      this.opts.logger.error('failed to write preview runtime failure dump', {
        projectId: record.projectId, dumpPath, err: (writeErr as Error).message,
      });
    }
  }

  /**
   * Local-runner-specific forensic dump. Written to
   * `apps/api/src/testing/last-local-preview-failure.json` and
   * single-file (overwrites the previous failure) so the most
   * recent stuck/failed local preview is one path to check.
   *
   * Captures the LOCAL lifecycle facts an engineer needs to make
   * an intermittent local-fallback failure reproducible:
   *   • exact spawned command + args + cwd + port + host + envSafe
   *   • child pid (when spawn succeeded)
   *   • full rolling stdout / stderr tails (≤16 KB each)
   *   • current step + last successful step
   *   • install-completed flag (was node_modules ever populated?)
   *   • server-spawned flag (did the OS hand us a PID?)
   *   • port-ever-opened flag (did any TCP probe connect, even if
   *     HTTP didn't respond?)
   *   • install-fallback metadata (was --legacy-peer-deps used?)
   *
   * Distinct from `last-preview-runtime-failure.json` (shared
   * docker+local writer) and `last-preview-timeout.json`
   * (boot-watchdog writer) so triage tooling can land here without
   * having to reason about which runtime was in flight. Best-effort
   * — write failures must not mask the original preview failure.
   */
  private async dumpLocalPreviewFailure(
    record: PreviewRecord,
    lr: ReturnType<NonNullable<typeof this.opts.localRunner>['get']> | null,
    reason: string,
  ): Promise<void> {
    const dumpPath = path.resolve(
      fileURLToPath(import.meta.url),
      '..', '..', 'testing', 'last-local-preview-failure.json',
    );
    // Lifecycle booleans — derived from the runner's record so the
    // dump can answer the three "where did it die?" questions
    // directly. `install-completed` is true when ANY install
    // succeeded (standard OR --legacy-peer-deps fallback).
    const installCompleted = lr
      ? (lr.installMode !== null
          || /install completed/i.test(lr.lastSuccessfulStep ?? '')
          || /install cache hit/i.test(lr.lastSuccessfulStep ?? ''))
      : false;
    const serverSpawned = lr
      ? (typeof lr.child?.pid === 'number' || lr.processStartedAt !== null)
      : false;
    const portEverOpened = lr
      ? lr.probeAttempts.some((a) => a.tcpConnected || a.ok)
      : false;
    const httpEverResponded = lr
      ? lr.probeAttempts.some((a) => a.ok || (typeof a.status === 'number' && a.status > 0))
      : false;
    // ── Manual reproduction block ────────────────────────
    // The staging directory is INTENTIONALLY preserved across
    // failures (writeFiles only wipes it at the start of the *next*
    // staging) so an engineer can `cd` into it and reproduce the
    // failure by hand. Surface every field the engineer needs to
    // re-run install + dev exactly the way the runner did.
    //
    // Package manager is derived from the spawn cmd basename
    // ('npm.cmd' → 'npm'), defaulting to npm when unavailable.
    const runtimePath = record.runtime?.cwd ?? lr?.stagingDir ?? null;
    const packageJsonPath = runtimePath ? path.join(runtimePath, 'package.json') : null;
    const devCmdRaw = record.runtime?.cmd ?? null;
    const devArgs = record.runtime?.args ?? null;
    const pmFromCmd = devCmdRaw
      ? path.basename(devCmdRaw).replace(/\.(cmd|exe|bat|ps1)$/i, '').toLowerCase()
      : null;
    const pm = (pmFromCmd === 'pnpm' || pmFromCmd === 'yarn') ? pmFromCmd : 'npm';
    // Install command actually executed by the runner. When the
    // --legacy-peer-deps fallback fired we surface BOTH attempts
    // (first standard, then fallback) so the engineer can pick the
    // one that matched the failure.
    const installArgsStandard = pm === 'yarn'
      ? ['install']
      : ['install', '--no-audit', '--no-fund'];
    const installCommandStandard = `${pm} ${installArgsStandard.join(' ')}`.trim();
    const installCommandFallback = lr?.installFallback?.triggered
      ? `${pm} install ${(lr.installFallback.fallbackArgs ?? []).join(' ')}`.trim()
      : null;
    // Start command — what the runner actually spawned. We use the
    // human-friendly `<pm> run dev` form rather than the
    // platform-specific `npm.cmd` so the block works on macOS/Linux
    // too (engineers often inspect failures from a different host
    // than the one that produced them).
    const startCommand = devArgs && devArgs.length > 0
      ? `${pm} ${devArgs.join(' ')}`.trim()
      : `${pm} run dev`;
    // Reproducible block — array of shell lines an engineer can
    // copy-paste verbatim. We include both the standard install and
    // the fallback (when triggered) as separate lines so the engineer
    // can choose; the runner's behaviour is documented inline.
    const reproduceCommand: string[] = [
      runtimePath ? `cd "${runtimePath}"` : '# cd <runtimePath unavailable — staging never started>',
      `# Install (the runner used: ${lr?.installMode ?? 'unknown'})`,
      installCommandStandard,
    ];
    if (installCommandFallback) {
      reproduceCommand.push(
        `# Standard install failed with ERESOLVE — runner retried with --legacy-peer-deps:`,
        installCommandFallback,
      );
    }
    reproduceCommand.push(
      `# Start dev server on the same port the runner used:`,
      `$env:PORT="${record.runtime?.port ?? lr?.port ?? '<port>'}"; ${startCommand}`,
    );
    const payload = {
      timestamp: new Date().toISOString(),
      projectId: record.projectId,
      previewId: record.previewId,
      runtime: record.runtime?.type ?? record.mode ?? 'local-fallback',
      reason,
      // ── timeout classification (only populated on timeout path) ──
      timeoutCause: record.timeoutCause ?? null,
      timeoutLifecycle: record.timeoutLifecycle ?? null,
      // ── exact spawned process ─────────────────────────────
      command: record.runtime?.cmd ?? null,
      commandArgs: record.runtime?.args ?? null,
      cwd: record.runtime?.cwd ?? lr?.stagingDir ?? null,
      // ── manual reproduction ──────────────────────────────
      // Staging dir is preserved on failure (see writeFiles —
      // wipe only happens at the start of the NEXT staging). An
      // engineer can `cd` here, run the install command, then
      // run the start command to reproduce the failure exactly.
      runtimePath,
      packageJsonPath,
      packageManager: pm,
      installCommand: installCommandStandard,
      installCommandFallback,
      startCommand,
      reproduceCommand,
      host: '127.0.0.1',
      port: record.runtime?.port ?? lr?.port ?? record.hostPort ?? null,
      envSafe: record.runtime?.envSafe ?? null,
      pid: lr?.child?.pid ?? record.runtimeLog?.pid ?? null,
      // ── lifecycle classification ──────────────────────────
      currentStep: record.step ?? null,
      lastSuccessfulStep: lr?.lastSuccessfulStep ?? record.lastMeaningfulStep ?? null,
      installCompleted,
      installMode: lr?.installMode ?? null,
      serverSpawned,
      portEverOpened,
      httpEverResponded,
      childAlive: lr ? !lr.exited : null,
      processStartedAt: lr?.processStartedAt ?? null,
      processExitedAt: lr?.processExitedAt ?? null,
      exitCode: lr?.exitCode ?? null,
      exitSignal: lr?.exitSignal ?? null,
      // ── stdio tails ───────────────────────────────────────
      // Cap at 16 KB each (the runner's ring buffer is 32 KB,
      // half goes to each stream tail to keep the dump browsable).
      stdoutTail: lr?.stdoutLog ? lr.stdoutLog.slice(-16_000) : null,
      stderrTail: lr?.stderrLog ? lr.stderrLog.slice(-16_000) : null,
      // ── probe history rollup ──────────────────────────────
      probeAttemptsTotal: lr?.probeAttempts.length ?? 0,
      probeAttemptsTail: (lr?.probeAttempts ?? []).slice(-16),
      // ── install-fallback (TEMPORARY) audit trail ──────────
      installFallback: lr?.installFallback
        ? {
            triggered: lr.installFallback.triggered,
            firstAttemptHeadline: lr.installFallback.firstAttemptHeadline,
            fallbackArgs: lr.installFallback.fallbackArgs,
            fallbackSucceeded: lr.installFallback.fallbackSucceeded,
            fallbackError: lr.installFallback.fallbackError,
            dumpPath: lr.installFallback.dumpPath,
          }
        : null,
      // ── step history (lightweight) ────────────────────────
      stepDurations: record.stepDurations ?? [],
      previewStatusTransitions: (record.history ?? []).map((h) => ({ step: h.step, at: h.at })),
      // ── safe-retry history ────────────────────────────────
      // One row per local-runner start() invocation. Capped at two.
      // `localRetrySucceeded` mirrors the field of the same name on
      // PreviewRecord and is `null`/undefined when no retry was
      // attempted.
      localStartAttempts: record.localStartAttempts ?? [],
      localRetrySucceeded:
        typeof record.localRetrySucceeded === 'boolean' ? record.localRetrySucceeded : null,
    };
    try {
      await fs.mkdir(path.dirname(dumpPath), { recursive: true });
      await fs.writeFile(dumpPath, JSON.stringify(payload, null, 2), 'utf8');
      this.opts.logger.warn('local preview failure dump written', {
        event: 'preview:local-failure-dump',
        projectId: record.projectId,
        previewId: record.previewId,
        runtime: payload.runtime,
        currentStep: payload.currentStep,
        lastSuccessfulStep: payload.lastSuccessfulStep,
        installCompleted,
        serverSpawned,
        portEverOpened,
        pid: payload.pid,
        // Reproduction surface — engineers can copy these directly
        // from the structured log without opening the dump file.
        runtimePath,
        packageJsonPath,
        installCommand: installCommandStandard,
        startCommand,
        dumpPath,
      });
      // Human-readable reproduction block, emitted as a separate
      // single-line log so it shows up cleanly in the terminal /
      // log aggregator without being buried inside a JSON blob.
      this.opts.logger.warn(
        `preview: to reproduce manually, run:\n${reproduceCommand.map((l) => `  ${l}`).join('\n')}`,
        {
          event: 'preview:local-failure-repro-block',
          projectId: record.projectId,
          previewId: record.previewId,
          runtimePath,
        },
      );
    } catch (writeErr) {
      this.opts.logger.error('failed to write last-local-preview-failure.json', {
        projectId: record.projectId,
        dumpPath,
        err: (writeErr as Error).message,
      });
    }
  }

  private async evictIfFull(): Promise<void> {
    const running = [...this.records.values()].filter((r) => r.state === 'ready' || r.state === 'starting' || r.state === 'building');
    if (running.length < this.opts.maxConcurrent) return;
    // Evict the least-recently-accessed ready container.
    const candidates = running
      .filter((r) => r.state === 'ready')
      .sort((a, b) => a.lastAccessedAt - b.lastAccessedAt);
    const victim = candidates[0];
    if (victim) {
      this.opts.logger.info('Evicting idle preview to make room', { projectId: victim.projectId });
      await this.stop(victim.projectId);
    }
  }

  private async sweepIdle(): Promise<void> {
    const now = Date.now();
    for (const rec of [...this.records.values()]) {
      if (rec.state !== 'ready') continue;
      if (now - rec.lastAccessedAt > this.opts.idleTtlMs) {
        this.opts.logger.info('Stopping idle preview', { projectId: rec.projectId, idleMs: now - rec.lastAccessedAt });
        await this.stop(rec.projectId);
      }
    }
  }

  /**
   * Persist a structured snapshot of the project record's `files`
   * array when preview staging cannot proceed. Lets us audit which
   * file shape (`content` vs `contents`, undefined, null, non-string)
   * the storage layer is producing without having to re-run the
   * pipeline.
   */
  private async dumpStageFailure(
    projectId: string,
    files: ReadonlyArray<{ path?: unknown; content?: unknown; contents?: unknown }>,
    skipped: ReadonlyArray<{ path: string; reason: string; typeofContent: string }>,
    err: Error | null,
  ): Promise<void> {
    const dumpPath = path.resolve(
      // apps/api/src/preview/preview-manager.ts → apps/api/src/testing/last-preview-stage-failure.json
      fileURLToPath(import.meta.url),
      '..', '..', 'testing', 'last-preview-stage-failure.json',
    );
    const inspect = files.slice(0, 50).map((f, i) => {
      const raw = f as { path?: unknown; content?: unknown; contents?: unknown };
      const text = typeof raw.content === 'string'
        ? raw.content
        : typeof raw.contents === 'string'
          ? raw.contents
          : null;
      return {
        index: i,
        path: typeof raw.path === 'string' ? raw.path : `<${typeof raw.path}>`,
        hasContent: 'content' in raw,
        hasContents: 'contents' in raw,
        typeofContent: typeof raw.content,
        typeofContents: typeof raw.contents,
        contentBytes: text === null ? null : text.length,
        preview: text === null ? null : text.slice(0, 200),
      };
    });
    const payload = {
      timestamp: new Date().toISOString(),
      projectId,
      totalFiles: files.length,
      skippedCount: skipped.length,
      skipped,
      filesInspected: inspect,
      error: err
        ? { message: err.message, stack: err.stack ?? null }
        : null,
    };
    try {
      await fs.mkdir(path.dirname(dumpPath), { recursive: true });
      await fs.writeFile(dumpPath, JSON.stringify(payload, null, 2), 'utf8');
      this.opts.logger.warn('preview stage failure dump written', { projectId, dumpPath });
    } catch (writeErr) {
      this.opts.logger.error('failed to write preview stage failure dump', {
        projectId, dumpPath, err: (writeErr as Error).message,
      });
    }
  }
}

const DEFAULT_DOCKERIGNORE = [
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  'coverage',
  '.env',
  '.env.local',
  'Dockerfile',
  'Dockerfile.preview',
  'docker-compose.yml',
  'docker-compose.*.yml',
].join('\n');
