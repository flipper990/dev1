// ─────────────────────────────────────────────────────────────
// spawn-logger — Uniform instrumentation for every child_process
// in the API. Wrap a ChildProcess immediately after `spawn(...)`
// so we get:
//   • start log (cmd, args, pid, cwd, projectId, port, label)
//   • exit  log (code, signal, durationMs, expected / unexpected)
//   • error log (spawn ENOENT / EACCES / etc.)
//   • a guaranteed `'error'` listener so an EventEmitter
//     'unhandled error' can NEVER bubble out and crash the API.
//   • data-listener wrappers that swallow exceptions inside log
//     accumulation paths so a memory blip in one project's
//     dev-server output cannot uncaughtException the parent.
//
// This module is read-only towards process logic — it never
// rewrites stdio, never kills, never resolves promises. Call
// sites keep their own lifecycle. We only attach observers.
// ─────────────────────────────────────────────────────────────

import type { ChildProcess } from 'node:child_process';

/** Minimal structural logger — accepts both the agent-core `Logger`
 *  and any local equivalent (ExecutionLogger, Fastify pino, console). */
export interface ChildLogger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
}

export interface SpawnContext {
  /** Short tag used in every log line, e.g. 'docker-run', 'local-dev', 'qa-exec'. */
  label: string;
  cmd: string;
  args: ReadonlyArray<string>;
  cwd?: string;
  projectId?: string | null;
  port?: number | null;
  /** Caller declares whether a clean exit before stop() is normal. Default: false (treat as unexpected). */
  expectsLongRunning?: boolean;
}

interface InstrumentResult {
  /** Total wall time the child has been alive. */
  durationMs(): number;
  /** Set just before we deliberately kill (so we don't log it as "unexpected"). */
  markStopRequested(): void;
}

/**
 * Attach lifecycle logging + a hard `'error'` floor to a freshly-spawned child.
 *
 * IMPORTANT: this MUST be called synchronously after `spawn(...)`, before any
 * `await` and before any other listener is attached, so the safety-net
 * `'error'` listener is in place by the time Node's spawn-failure logic
 * decides whether to emit `error` synchronously.
 */
export function instrumentChild(
  child: ChildProcess,
  ctx: SpawnContext,
  logger: ChildLogger,
): InstrumentResult {
  const startedAt = Date.now();
  let stopRequested = false;
  let exited = false;

  const baseFields = {
    label: ctx.label,
    cmd: ctx.cmd,
    argv: ctx.args.slice(0, 8), // cap so a 200-arg npm install doesn't flood logs
    pid: child.pid ?? null,
    cwd: ctx.cwd ?? null,
    projectId: ctx.projectId ?? null,
    port: ctx.port ?? null,
  };

  logger.info('child-process: spawn', baseFields);

  // 1. Floor 'error' listener — guarantees no EventEmitter
  //    'unhandled error' ever throws out of this child. Attached
  //    FIRST so it's present even if the child dies on the same
  //    tick as spawn (ENOENT path).
  child.on('error', (err) => {
    logger.error('child-process: error', {
      ...baseFields,
      err: err.message,
      code: (err as NodeJS.ErrnoException).code ?? null,
    });
  });

  // 2. Stream-listener wrapper — the user's data handlers may throw
  //    on memory pressure (string concat with cap can OOM). We
  //    cannot replace their handlers, but we CAN attach our own
  //    after-the-fact 'error' listeners on the streams so a
  //    failed read doesn't bubble.
  child.stdout?.on('error', (err) => {
    logger.warn('child-process: stdout error', { ...baseFields, err: err.message });
  });
  child.stderr?.on('error', (err) => {
    logger.warn('child-process: stderr error', { ...baseFields, err: err.message });
  });

  // 3. Single exit observer. We use 'exit' (process gone, streams may still flush)
  //    rather than 'close' so the log carries the timing of the actual exit
  //    rather than the drain of stdio buffers.
  child.once('exit', (code, signal) => {
    if (exited) return;
    exited = true;
    const durationMs = Date.now() - startedAt;
    const unexpected =
      !stopRequested &&
      (ctx.expectsLongRunning === true /* dev server: any exit is unexpected */ ||
        (code !== 0 && code !== null) ||
        signal !== null);
    const fields = {
      ...baseFields,
      code,
      signal,
      durationMs,
      stopRequested,
      unexpected,
    };
    if (unexpected) {
      logger.warn('child-process: exited unexpectedly', fields);
    } else {
      logger.info('child-process: exited', fields);
    }
  });

  return {
    durationMs: () => Date.now() - startedAt,
    markStopRequested: () => { stopRequested = true; },
  };
}
