// ─────────────────────────────────────────────────────────────
// Process-level crash logger
//
// Centralises every place the API process can die unexpectedly so we
// can answer the simple question "why did the API stop responding mid
// generation?" by reading a single file:
//
//     apps/api/src/testing/last-api-crash.json
//
// Captures:
//   • uncaughtException
//   • unhandledRejection
//   • SIGINT / SIGTERM / SIGHUP / SIGBREAK
//   • beforeExit (last gasp)
//
// Always logs to console too. The file is overwritten per crash, with
// an append-only history mirror at last-api-crash.history.jsonl so
// nothing is lost if the file is overwritten on rapid tsx-watch reloads.
//
// Active-generation context: ProjectGenerator / BuilderAgent register
// the in-flight session(s) so the crash dump knows what was running.
// ─────────────────────────────────────────────────────────────

import { mkdirSync, readFileSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const TESTING_DIR = resolve(dirname(__filename), 'testing');
export const LAST_CRASH_PATH = resolve(TESTING_DIR, 'last-api-crash.json');
const HISTORY_PATH = resolve(TESTING_DIR, 'last-api-crash.history.jsonl');
const PID_FILE = resolve(TESTING_DIR, '.last-api-pid.json');
const RESTART_COUNTER_FILE = resolve(TESTING_DIR, '.api-restart-counter.json');

// ─────────────────────────────────────────────────────────────
// Active-generation registry
// ─────────────────────────────────────────────────────────────

export interface ActiveGenerationContext {
  projectId: string | null;
  sessionId: string | null;
  phase: string | null;
  step: string | null;
  startedAt: string;
  /** Free-form extra context (e.g. sliceId, attempt). */
  extra?: Record<string, unknown>;
}

const activeGenerations = new Map<string, ActiveGenerationContext>();

/** Register or update an in-flight generation. Keyed by sessionId. */
export function setActiveGeneration(sessionId: string, ctx: Omit<ActiveGenerationContext, 'startedAt'> & { startedAt?: string }): void {
  if (!sessionId) return;
  const existing = activeGenerations.get(sessionId);
  activeGenerations.set(sessionId, {
    ...existing,
    ...ctx,
    startedAt: ctx.startedAt ?? existing?.startedAt ?? new Date().toISOString(),
  });
}

/** Update phase/step on an existing entry without resetting startedAt. */
export function updateActiveGeneration(sessionId: string, patch: Partial<Omit<ActiveGenerationContext, 'startedAt'>>): void {
  const existing = activeGenerations.get(sessionId);
  if (!existing) return;
  activeGenerations.set(sessionId, { ...existing, ...patch });
}

export function clearActiveGeneration(sessionId: string): void {
  activeGenerations.delete(sessionId);
}

export function getActiveGenerations(): ActiveGenerationContext[] {
  return Array.from(activeGenerations.values());
}

// ─────────────────────────────────────────────────────────────
// Restart counter (cumulative across the lifetime of this checkout).
// Persisted on disk so tsx-watch reloads, supervisor restarts, and
// crash-loops are all visible from a single number.
// ─────────────────────────────────────────────────────────────

interface RestartCounterFile {
  restartCount: number;
  firstStartedAt: string;
  lastStartedAt: string;
  lastPid: number;
}

let restartCounter = 0;
let processStartedAt: string = new Date().toISOString();
let firstStartedAt: string = processStartedAt;

function bumpRestartCounter(): void {
  let prev: RestartCounterFile | null = null;
  try {
    if (existsSync(RESTART_COUNTER_FILE)) {
      prev = JSON.parse(readFileSync(RESTART_COUNTER_FILE, 'utf8')) as RestartCounterFile;
    }
  } catch { /* corrupt → reset */ }
  restartCounter = (prev?.restartCount ?? 0) + 1;
  firstStartedAt = prev?.firstStartedAt ?? processStartedAt;
  const next: RestartCounterFile = {
    restartCount: restartCounter,
    firstStartedAt,
    lastStartedAt: processStartedAt,
    lastPid: process.pid,
  };
  try {
    mkdirSync(dirname(RESTART_COUNTER_FILE), { recursive: true });
    writeFileSync(RESTART_COUNTER_FILE, JSON.stringify(next, null, 2), 'utf8');
  } catch { /* best-effort */ }
}

export function getRestartCounter(): number { return restartCounter; }
export function getProcessStartedAt(): string { return processStartedAt; }
export function getFirstStartedAt(): string { return firstStartedAt; }

// ─────────────────────────────────────────────────────────────
// Last-unhandled-error tracking (in-memory, exposed via /debug/runtime)
// ─────────────────────────────────────────────────────────────

export interface LastUnhandledError {
  timestamp: string;
  kind: 'uncaughtException' | 'unhandledRejection';
  message: string;
  stack: string | null;
  errorName: string | null;
  activeGenerations: ActiveGenerationContext[];
}

let lastUnhandledError: LastUnhandledError | null = null;

export function getLastUnhandledError(): LastUnhandledError | null {
  return lastUnhandledError;
}

// ─────────────────────────────────────────────────────────────
// Heartbeat
// ─────────────────────────────────────────────────────────────
//
// Updated every HEARTBEAT_INTERVAL_MS so we can prove the event loop
// is alive. Exposed via /health and /debug/runtime. If `lastBeatAt`
// stops advancing, the event loop is blocked (long sync work,
// deadlock) — distinct from a process death.
// ─────────────────────────────────────────────────────────────

const HEARTBEAT_INTERVAL_MS = 5_000;

export interface HeartbeatSnapshot {
  pid: number;
  startedAt: string;
  firstStartedAt: string;
  uptimeSeconds: number;
  restartCounter: number;
  lastBeatAt: string;
  beatCount: number;
  watchMode: boolean;
  reloadedFromPid: number | null;
  memoryUsage: NodeJS.MemoryUsage;
}

let beatCount = 0;
let lastBeatAt: string = processStartedAt;
let heartbeatHandle: NodeJS.Timeout | null = null;

function beatOnce(): void {
  beatCount++;
  lastBeatAt = new Date().toISOString();
}

export function getHeartbeat(): HeartbeatSnapshot {
  return {
    pid: process.pid,
    startedAt: processStartedAt,
    firstStartedAt,
    uptimeSeconds: Math.round(process.uptime()),
    restartCounter,
    lastBeatAt,
    beatCount,
    watchMode: currentPidInfo?.watchMode ?? false,
    reloadedFromPid: currentPidInfo?.reloadedFromPid ?? null,
    memoryUsage: process.memoryUsage(),
  };
}

// ─────────────────────────────────────────────────────────────
// PID / restart tracking (tsx watch reload detection)
// ─────────────────────────────────────────────────────────────

interface PidInfo {
  pid: number;
  startedAt: string;
  argv: string[];
  watchMode: boolean;
  /** True when the previous PID file existed at startup — i.e. tsx-watch
   *  killed an earlier process and respawned us. */
  reloadedFromPid?: number | null;
  reloadedFromStartedAt?: string | null;
}

let currentPidInfo: PidInfo | null = null;

function detectWatchMode(): boolean {
  // tsx watch sets TSX_TSCONFIG_PATH and runs as a child of `tsx watch`.
  // Best heuristic: process.execArgv contains tsx loader hooks and the
  // parent argv has 'watch'. Fall back to env hint.
  const argvJoined = process.argv.join(' ');
  if (argvJoined.includes('tsx') && process.env.TSX_WATCH !== '0') {
    // Check the parent process command line where possible.
    const ppidEnv = process.env.npm_lifecycle_event;
    if (ppidEnv === 'dev') return true;
  }
  return process.env.NODE_ENV !== 'production' && process.env.TSX_WATCH !== '0';
}

function readPreviousPid(): PidInfo | null {
  try {
    if (!existsSync(PID_FILE)) return null;
    const raw = readFileSync(PID_FILE, 'utf8');
    return JSON.parse(raw) as PidInfo;
  } catch {
    return null;
  }
}

function writeCurrentPid(info: PidInfo): void {
  try {
    mkdirSync(dirname(PID_FILE), { recursive: true });
    writeFileSync(PID_FILE, JSON.stringify(info, null, 2), 'utf8');
  } catch {
    // best-effort
  }
}

// ─────────────────────────────────────────────────────────────
// Crash dump
// ─────────────────────────────────────────────────────────────

interface MinimalLogger {
  info: (msg: string, meta?: Record<string, unknown>) => void;
  warn: (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
}

function shapeLogger(logger: unknown): MinimalLogger {
  const l = logger as Record<string, unknown> | null | undefined;
  const call = (lvl: 'info' | 'warn' | 'error') =>
    (msg: string, meta?: Record<string, unknown>) => {
      const fn = l && typeof l[lvl] === 'function' ? (l[lvl] as (...a: unknown[]) => void) : null;
      if (fn) {
        try { fn.call(l, meta ?? {}, msg); return; } catch { /* fall through */ }
      }
      // Console fallback (always works, even if logger is broken).
       
      console[lvl === 'info' ? 'log' : lvl](`[crash-logger] ${msg}`, meta ?? {});
    };
  return { info: call('info'), warn: call('warn'), error: call('error') };
}

interface CrashRecord {
  timestamp: string;
  kind: 'uncaughtException' | 'unhandledRejection' | 'signal' | 'beforeExit';
  signal?: NodeJS.Signals;
  message: string;
  stack: string | null;
  errorName: string | null;
  pid: number;
  uptimeSeconds: number;
  watchMode: boolean;
  pidInfo: PidInfo | null;
  activeGenerations: ActiveGenerationContext[];
  memoryUsage: NodeJS.MemoryUsage;
  /** Raw error JSON if it serialises (useful for non-Error rejections). */
  rawErrorJson?: unknown;
}

function buildCrashRecord(args: {
  kind: CrashRecord['kind'];
  signal?: NodeJS.Signals;
  err: unknown;
}): CrashRecord {
  const { kind, signal, err } = args;
  const isErr = err instanceof Error;
  let rawErrorJson: unknown;
  try { rawErrorJson = JSON.parse(JSON.stringify(err)); } catch { rawErrorJson = String(err); }
  return {
    timestamp: new Date().toISOString(),
    kind,
    signal,
    message: isErr ? err.message : (typeof err === 'string' ? err : safeStringify(err)),
    stack: isErr ? (err.stack ?? null) : null,
    errorName: isErr ? err.name : null,
    pid: process.pid,
    uptimeSeconds: Math.round(process.uptime()),
    watchMode: currentPidInfo?.watchMode ?? false,
    pidInfo: currentPidInfo,
    activeGenerations: getActiveGenerations(),
    memoryUsage: process.memoryUsage(),
    rawErrorJson,
  };
}

function safeStringify(v: unknown): string {
  try {
    const s = String(v);
    if (s && s !== '[object Object]') return s;
  } catch { /* ignore */ }
  try { return JSON.stringify(v) ?? 'unknown'; } catch { return 'unknown'; }
}

function persistCrash(record: CrashRecord): void {
  // Use SYNC fs APIs — by the time uncaughtException fires we may be
  // milliseconds away from process exit, and async writes are not
  // guaranteed to flush.
  try {
    mkdirSync(TESTING_DIR, { recursive: true });
    writeFileSync(LAST_CRASH_PATH, JSON.stringify(record, null, 2), 'utf8');
    appendFileSync(HISTORY_PATH, JSON.stringify(record) + '\n', 'utf8');
  } catch (e) {
    // Last-ditch: dump to stderr.
     
    console.error('[crash-logger] failed to persist crash dump:', (e as Error).message);
     
    console.error('[crash-logger] crash record:', JSON.stringify(record, null, 2));
  }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

let installed = false;

export function installCrashHandlers(rawLogger: unknown): void {
  if (installed) return;
  installed = true;

  const logger = shapeLogger(rawLogger);
  const watchMode = detectWatchMode();

  const previous = readPreviousPid();
  const reloadedFromPid = previous && previous.pid !== process.pid ? previous.pid : null;
  const reloadedFromStartedAt = previous?.startedAt ?? null;

  processStartedAt = new Date().toISOString();
  bumpRestartCounter();

  currentPidInfo = {
    pid: process.pid,
    startedAt: processStartedAt,
    argv: process.argv,
    watchMode,
    reloadedFromPid,
    reloadedFromStartedAt,
  };
  writeCurrentPid(currentPidInfo);

  // Start the heartbeat. unref() so it never holds the event loop open
  // by itself during shutdown.
  beatOnce();
  heartbeatHandle = setInterval(beatOnce, HEARTBEAT_INTERVAL_MS);
  heartbeatHandle.unref?.();

  if (reloadedFromPid) {
    logger.warn('[server:reload-detected] previous API process recorded — likely tsx-watch restart', {
      event: 'server:reload-detected',
      previousPid: reloadedFromPid,
      previousStartedAt: reloadedFromStartedAt,
      currentPid: process.pid,
      watchMode,
      restartCounter,
    });
  } else {
    logger.info('[server:cold-start] no prior PID file found — fresh start', {
      event: 'server:cold-start', pid: process.pid, watchMode, restartCounter,
    });
  }

  process.on('uncaughtException', (err) => {
    const record = buildCrashRecord({ kind: 'uncaughtException', err });
    lastUnhandledError = {
      timestamp: record.timestamp,
      kind: 'uncaughtException',
      message: record.message,
      stack: record.stack,
      errorName: record.errorName,
      activeGenerations: record.activeGenerations,
    };
    logger.error('[crash:uncaught-exception] API process is dying', {
      event: 'crash:uncaught-exception',
      message: record.message,
      stack: record.stack,
      activeGenerations: record.activeGenerations,
      restartCounter,
    });
    persistCrash(record);
    // Match prior behaviour: exit non-zero so tsx-watch / supervisor
    // sees a real failure and can decide whether to restart.
    process.exit(1);
  });

  process.on('unhandledRejection', (reason) => {
    const record = buildCrashRecord({ kind: 'unhandledRejection', err: reason });
    lastUnhandledError = {
      timestamp: record.timestamp,
      kind: 'unhandledRejection',
      message: record.message,
      stack: record.stack,
      errorName: record.errorName,
      activeGenerations: record.activeGenerations,
    };
    logger.error('[crash:unhandled-rejection] promise rejected with no catch', {
      event: 'crash:unhandled-rejection',
      message: record.message,
      stack: record.stack,
      activeGenerations: record.activeGenerations,
      restartCounter,
    });
    persistCrash(record);
    // Node's default future behaviour is to terminate; do it explicitly
    // so the failure mode is observable instead of silent.
    process.exit(1);
  });

  const recordSignal = (signal: NodeJS.Signals) => {
    const record = buildCrashRecord({
      kind: 'signal',
      signal,
      err: new Error(`Process received signal ${signal}`),
    });
    logger.warn(`[server:signal] received ${signal} — shutting down`, {
      event: 'server:signal',
      signal,
      activeGenerations: record.activeGenerations,
      uptimeSeconds: record.uptimeSeconds,
      watchMode,
    });
    persistCrash(record);
  };

  // SIGINT / SIGTERM are recorded BUT not forced-exited here — the app
  // installs its own graceful close handler that will exit(0) afterwards.
  // We just make sure the dump is on disk before that runs.
  for (const sig of ['SIGINT', 'SIGTERM'] as const) {
    process.on(sig, () => recordSignal(sig));
  }
  // SIGHUP / SIGBREAK: tsx-watch sends SIGTERM by default but Windows
  // can deliver SIGBREAK on Ctrl-Break. Capture both.
  // SIGHUP is unsupported on Windows; guard the listener install.
  try { process.on('SIGHUP', () => recordSignal('SIGHUP')); } catch { /* unsupported */ }
  try { process.on('SIGBREAK' as NodeJS.Signals, () => recordSignal('SIGBREAK' as NodeJS.Signals)); } catch { /* unsupported */ }

  process.on('beforeExit', (code) => {
    if (code === 0) return; // clean exit, nothing to dump
    const record = buildCrashRecord({
      kind: 'beforeExit',
      err: new Error(`Process exiting with code ${code}`),
    });
    persistCrash(record);
  });

  logger.info('[crash-logger:installed] global crash handlers active', {
    event: 'crash-logger:installed',
    pid: process.pid,
    watchMode,
    reloadedFromPid,
    restartCounter,
    lastCrashPath: LAST_CRASH_PATH,
  });
}
