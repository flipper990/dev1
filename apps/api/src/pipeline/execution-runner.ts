// ─────────────────────────────────────────────────────────────
// Execution Runner — real-environment validation for generated
// projects.
//
// Writes the generated files to disk (or runs against an existing
// project directory), then executes `npm install` → `npm run build`
// → `npm run dev` with bounded timeouts. Captures stdout / stderr /
// exit codes for each step and returns a structured result the
// pipeline can use to decide whether to ship the build, request a
// repair pass, or roll back.
//
// We use Node's child_process directly. Each step gets its own
// timeout; the dev server in particular is started, watched until
// it logs that it is "ready", and then killed — we are validating
// that it boots, not running a long-lived process.
// ─────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, isAbsolute } from 'node:path';
import { request as httpRequest } from 'node:http';
import { URL } from 'node:url';
import { instrumentChild } from '../preview/spawn-logger.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

/** A single generated file the runner can write before executing. */
export interface ExecutionFile {
  path: string;     // project-relative
  content: string;
}

/** Logger surface — matches the BaseAgent / Fastify pattern in this repo. */
export interface ExecutionLogger {
  info:  (msg: string, meta?: Record<string, unknown>) => void;
  warn:  (msg: string, meta?: Record<string, unknown>) => void;
  error: (msg: string, meta?: Record<string, unknown>) => void;
  debug?: (msg: string, meta?: Record<string, unknown>) => void;
}

export interface ExecutionRunnerOptions {
  /**
   * Either an existing on-disk project directory to validate, OR a
   * directory the runner should create / overwrite using `files`.
   * Required.
   */
  projectDir?: string;

  /**
   * If provided, the runner writes these files into `projectDir`
   * (or a fresh tempdir if `projectDir` is omitted) before running.
   */
  files?: ReadonlyArray<ExecutionFile>;

  /** Defaults to npm. Use 'pnpm' or 'yarn' to switch. */
  packageManager?: 'npm' | 'pnpm' | 'yarn';

  /** Per-step timeouts in milliseconds. Sensible defaults below. */
  timeouts?: {
    install?:  number; // default 180_000 (3 min — install can be slow)
    build?:    number; // default 120_000 (2 min)
    dev?:      number; // default  60_000 (1 min — long enough to boot)
  };

  /**
   * Substrings whose appearance in dev-server stdout marks "ready".
   * Once any one of these is seen, the runner kills the dev process
   * and reports success. Defaults cover Next.js, Vite, and Astro.
   */
  readyMarkers?: string[];

  /**
   * If false, runner does NOT start the dev server (install + build
   * only). Useful when the caller only cares about compile errors.
   */
  startDevServer?: boolean;

  /** When true, also run `npm run typecheck` if a script exists. */
  runTypecheck?: boolean;

  /** Truncate captured stdout/stderr per step. Default 64 KB each. */
  maxLogBytesPerStep?: number;

  /**
   * After the dev server reaches its ready marker, probe these HTTP
   * paths before killing the process. A path is considered healthy when:
   *   • status is in `expectStatusRange` (default 200–399, redirects ok)
   *   • body length ≥ `minBodyBytes` (default 200)
   *   • body contains every substring in `expectMarkers`
   *     (defaults: at least one of `<html`, `<body`, `<div`, `<main`)
   *
   * If `routes` is empty AND `startDevServer` is true, the runner probes
   * `'/'` by default. Set `routes: []` AND `disableHttpProbes: true` to
   * skip probing entirely.
   */
  httpProbes?: {
    /** Paths to probe, relative to the dev server root (e.g. ['/', '/dashboard']). */
    routes?: string[];
    /** Acceptable HTTP status range. Defaults to [200, 399]. */
    expectStatusRange?: [number, number];
    /** Required substrings (case-insensitive) inside the response body. */
    expectMarkers?: string[];
    /** Minimum response body length in bytes. Default 200. */
    minBodyBytes?: number;
    /** Per-probe HTTP timeout in milliseconds. Default 10_000. */
    requestTimeoutMs?: number;
    /** How long to wait for the server to accept the FIRST connection
     *  after the ready marker fires. Some frameworks log "ready" before
     *  the listener is actually accepting. Default 5_000. */
    warmupTimeoutMs?: number;
    /** Override the host/port. By default the runner extracts the port
     *  from the dev-server output (`http://localhost:<port>`) or falls
     *  back to the `PORT` env we set. */
    host?: string;
    port?: number;
  };

  /** When true, skip HTTP probes even if the dev server is running. */
  disableHttpProbes?: boolean;

  /** When true, delete the project directory after running. Only
   *  honoured when the runner created the directory itself (i.e.
   *  `projectDir` was not provided). */
  cleanup?: boolean;

  /** Optional project id surfaced into child-process lifecycle logs. */
  projectId?: string | null;

  logger?: ExecutionLogger;
}

export interface ExecutionStepResult {
  step: 'install' | 'build' | 'dev' | 'typecheck';
  ran: boolean;
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  /** True iff the step succeeded (exit 0, or for dev: ready marker seen). */
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Errors extracted from stdout/stderr — most relevant lines first. */
  errors: string[];
}

/** Outcome of a single HTTP probe against the running dev server. */
export interface HttpProbeResult {
  path: string;
  url: string;
  ok: boolean;
  status: number | null;
  /** Total request duration including connect + body read. */
  durationMs: number;
  /** Length of the response body in bytes. */
  bodyBytes: number;
  /** First ~2 KB of the response body for diagnostics. */
  bodySample: string;
  /** Reason the probe failed, if any. */
  error?: string;
  /** Required markers that were missing from the body. */
  missingMarkers?: string[];
}

export interface ExecutionValidationResult {
  /**
   * Overall success. STRICT: every required step must have actually run
   * AND succeeded, AND at least one HTTP probe must have passed.
   * A skipped or never-ran step is NEVER counted as success.
   *
   * Specifically:
   *   success === installRan && installOk
   *           && buildRan   && buildOk
   *           && devRan     && devOk
   *           && httpProbes.length > 0 && every probe ok
   */
  success: boolean;
  /**
   * Explicit, machine-readable reasons the run failed. Populated even
   * when the underlying step never ran (e.g. "no package.json",
   * "missing build script"). Empty iff `success === true`.
   */
  failureReasons: string[];
  /** Compile-time / install / type errors. */
  buildErrors: string[];
  /** Errors emitted while the dev server was booting OR detected by HTTP probes. */
  runtimeErrors: string[];
  /** A human-readable concatenation of all step logs (capped). */
  logs: string;
  /** Per-step detail for callers that need it. */
  steps: ExecutionStepResult[];
  /** Per-route HTTP probe results (empty when probes are disabled or dev didn't run). */
  httpProbes: HttpProbeResult[];
  /** The directory that was actually used. */
  projectDir: string;
}

// ─────────────────────────────────────────────────────────────
// Defaults & helpers
// ─────────────────────────────────────────────────────────────

const DEFAULT_INSTALL_TIMEOUT_MS = 180_000;
const DEFAULT_BUILD_TIMEOUT_MS   = 120_000;
const DEFAULT_DEV_TIMEOUT_MS     =  60_000;
const DEFAULT_MAX_LOG_BYTES      =  64_000;

const DEFAULT_READY_MARKERS = [
  // Next.js (App Router & Pages Router)
  'ready in',           // Next 13/14/15 banner: "✓ Ready in 1.2s"
  'started server on',
  '- local:',           // Next dev "▲ Local: http://localhost:3000"
  // Vite
  'vite v',
  'local:   http',
  // Astro / Remix
  'astro v',
  'remix dev server',
  // Generic
  'listening on',
  'server running',
];

// On Windows, npm/pnpm/yarn are batch shims that must be invoked
// through the shell. We spawn them by name and let the shell resolve.
const IS_WINDOWS = process.platform === 'win32';

function noopLogger(): ExecutionLogger {
  return { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
}

/** Append to a length-capped buffer; returns the new buffer. */
function appendCapped(buf: string, chunk: string, max: number): string {
  if (buf.length >= max) return buf;
  return buf + chunk.slice(0, max - buf.length);
}

/**
 * Pull the most useful error lines out of mixed stdout/stderr. We look
 * for the common error markers across npm / TypeScript / Next / Vite /
 * generic Node and return de-duplicated lines. At most `limit` lines.
 */
function extractErrors(stdout: string, stderr: string, limit = 25): string[] {
  const text = `${stderr}\n${stdout}`;
  const lines = text.split(/\r?\n/);
  const out: string[] = [];
  const seen = new Set<string>();

  const ERROR_PATTERNS: RegExp[] = [
    /\bERR!\b/i,                                // npm ERR!
    /\bERROR\b/,                                // generic
    /^error[: ]/i,                              // generic
    /\b(TS\d{4,5})\b/,                          // TypeScript diagnostics
    /^\s*at .*:\d+:\d+\)?$/,                    // stack frames
    /Module not found/i,
    /Cannot find module/i,
    /SyntaxError\b/,
    /TypeError\b/,
    /ReferenceError\b/,
    /Failed to compile/i,
    /Build failed/i,
    /Unhandled\s+(?:Promise\s+)?[Rr]ejection/,
    /EADDRINUSE/,
    /ENOENT/,
  ];

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length > 500) continue; // skip enormous progress dumps
    if (!ERROR_PATTERNS.some((re) => re.test(line))) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    out.push(line);
    if (out.length >= limit) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// HTTP probing
// ─────────────────────────────────────────────────────────────

/** Default markers we consider "non-blank HTML page". Any one matches. */
const DEFAULT_BODY_MARKERS_ANY: string[] = [
  '<html', '<body', '<div', '<main', '<root', 'id="__next"', 'id="root"', 'id="app"',
];

/** Substrings that indicate the rendered page is a generic error/blank state. */
const BLANK_PAGE_MARKERS: RegExp[] = [
  /this page (?:can(?:'|\u2019)t|cannot) be reached/i,
  /\bECONNREFUSED\b/,
  /\bcompilation failed\b/i,
  /^\s*<\/?\s*$/,
  /^[\s\u200b]*$/,
];

interface ProbeSpec {
  url: string;
  path: string;
  expectStatusRange: [number, number];
  /** All markers must be present (case-insensitive). */
  expectMarkersAll?: string[];
  /** At least one marker must be present (case-insensitive). */
  expectMarkersAny?: string[];
  minBodyBytes: number;
  timeoutMs: number;
}

/** Single HTTP probe against the running dev server. */
function probeUrl(spec: ProbeSpec): Promise<HttpProbeResult> {
  return new Promise((resolve) => {
    const t0 = Date.now();
    let parsed: URL;
    try {
      parsed = new URL(spec.url);
    } catch (err) {
      resolve({
        path: spec.path, url: spec.url, ok: false, status: null,
        durationMs: 0, bodyBytes: 0, bodySample: '',
        error: `invalid URL: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    let body = '';
    let received = 0;
    let settled = false;
    const finish = (out: HttpProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(out);
    };

    const req = httpRequest(
      {
        host: parsed.hostname,
        port: parsed.port ? Number(parsed.port) : 80,
        path: parsed.pathname + (parsed.search ?? ''),
        method: 'GET',
        headers: {
          'user-agent': 'execution-runner/1.0',
          'accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
        timeout: spec.timeoutMs,
      },
      (res) => {
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          received += Buffer.byteLength(chunk, 'utf8');
          if (body.length < 8_192) {
            body += chunk.slice(0, 8_192 - body.length);
          }
        });
        res.on('end', () => {
          const status = res.statusCode ?? null;
          const [min, max] = spec.expectStatusRange;
          const statusOk = status !== null && status >= min && status <= max;

          // Strip whitespace for the "is it blank?" check, but keep the
          // sample for diagnostics.
          const trimmed = body.trim();
          const sizeOk = received >= spec.minBodyBytes;
          const blank = BLANK_PAGE_MARKERS.some((re) => re.test(trimmed));

          const lower = body.toLowerCase();
          const allMissing = (spec.expectMarkersAll ?? [])
            .filter((m) => !lower.includes(m.toLowerCase()));
          const anyHit = !spec.expectMarkersAny || spec.expectMarkersAny.length === 0
            || spec.expectMarkersAny.some((m) => lower.includes(m.toLowerCase()));

          const ok = statusOk && sizeOk && !blank && allMissing.length === 0 && anyHit;

          let error: string | undefined;
          const missingMarkers: string[] = [];
          if (!statusOk) error = `unexpected status ${status}`;
          else if (!sizeOk) error = `response body too small (${received} bytes < ${spec.minBodyBytes} required)`;
          else if (blank) error = 'response body looks blank or is an error page';
          else if (allMissing.length > 0) {
            error = `missing required markers: ${allMissing.join(', ')}`;
            missingMarkers.push(...allMissing);
          } else if (!anyHit) {
            error = `body did not contain any of: ${(spec.expectMarkersAny ?? []).join(', ')}`;
            missingMarkers.push(...(spec.expectMarkersAny ?? []));
          }

          finish({
            path: spec.path, url: spec.url, ok, status,
            durationMs: Date.now() - t0,
            bodyBytes: received,
            bodySample: body.slice(0, 2_048),
            error,
            missingMarkers: missingMarkers.length > 0 ? missingMarkers : undefined,
          });
        });
        res.on('error', (err) => {
          finish({
            path: spec.path, url: spec.url, ok: false, status: res.statusCode ?? null,
            durationMs: Date.now() - t0,
            bodyBytes: received, bodySample: body.slice(0, 2_048),
            error: `response error: ${err.message}`,
          });
        });
      },
    );

    req.on('timeout', () => {
      try { req.destroy(); } catch { /* ignore */ }
      finish({
        path: spec.path, url: spec.url, ok: false, status: null,
        durationMs: Date.now() - t0,
        bodyBytes: 0, bodySample: '',
        error: `request timed out after ${spec.timeoutMs}ms`,
      });
    });
    req.on('error', (err) => {
      finish({
        path: spec.path, url: spec.url, ok: false, status: null,
        durationMs: Date.now() - t0,
        bodyBytes: 0, bodySample: '',
        error: `request error: ${err.message}`,
      });
    });
    req.end();
  });
}

/**
 * Wait for the server to accept TCP connections on the given port.
 * Some frameworks log "Ready" before the listener is fully bound;
 * this polls every 250 ms until a HEAD request returns *anything*
 * (even a 404) or the timeout fires.
 */
async function waitForServerWarmup(host: string, port: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const req = httpRequest(
        { host, port, method: 'HEAD', path: '/', timeout: 1_000 },
        (res) => { res.resume(); resolve(true); },
      );
      req.on('error', () => resolve(false));
      req.on('timeout', () => { try { req.destroy(); } catch {/* */} resolve(false); });
      req.end();
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/** Extract the first `http://host:port` URL from dev-server output. */
function extractServerOrigin(output: string): { host: string; port: number } | null {
  const m = output.match(/https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]):(\d{2,5})/i);
  if (!m) return null;
  let host = m[1];
  if (host === '0.0.0.0') host = '127.0.0.1';
  if (host === '[::1]' || host === '[::]') host = '127.0.0.1';
  return { host, port: Number(m[2]) };
}

// ─────────────────────────────────────────────────────────────
// Process runner
// ─────────────────────────────────────────────────────────────

interface RunSpec {
  cmd: string;
  args: string[];
  cwd: string;
  timeoutMs: number;
  /** Used for structured child-process lifecycle logging. */
  logger?: ExecutionLogger;
  label?: string;
  projectId?: string | null;
  /** When set, the runner watches stdout and resolves with ok=true as
   *  soon as a marker is seen, even though the process is still running. */
  readyMarkers?: string[];
  maxLogBytes: number;
  /**
   * Invoked the moment a ready marker matches. The process is NOT killed
   * until the callback resolves — this is how we run HTTP probes against
   * the live dev server. The callback receives the captured output so far
   * so it can extract the bound port. Throwing inside the callback is
   * caught and recorded as a runtime error.
   */
  onReady?: (capturedOutput: string) => Promise<void> | void;
}

interface RawRunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  /** True if the process was killed because a ready marker matched. */
  killedAfterReady: boolean;
}

/** Spawn a process and capture all output with the given timeout. */
function runProcess(spec: RunSpec): Promise<RawRunResult> {
  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killedAfterReady = false;
    let timer: NodeJS.Timeout | null = null;
    const startedAt = Date.now();

    let proc: ChildProcess;
    try {
      proc = spawn(spec.cmd, spec.args, {
        cwd: spec.cwd,
        shell: IS_WINDOWS, // batch shims (npm.cmd, pnpm.cmd) need shell on Win
        windowsHide: true,
        env: {
          ...process.env,
          // Force non-interactive output and disable colour codes so
          // the captured logs are easy to parse.
          CI: '1',
          FORCE_COLOR: '0',
          NO_COLOR: '1',
          // Pick a port unlikely to clash with the API/web during tests.
          PORT: process.env.EXECUTION_RUNNER_PORT ?? '4310',
        },
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      resolve({
        exitCode: -1,
        stdout: '',
        stderr: `failed to spawn ${spec.cmd}: ${msg}`,
        durationMs: Date.now() - startedAt,
        timedOut: false,
        killedAfterReady: false,
      });
      return;
    }

    // Lifecycle log + EventEmitter floor 'error' listener so a spawn
    // failure on this child can never become an uncaughtException.
    const lifecycle = spec.logger
      ? instrumentChild(proc, {
          label: spec.label ?? 'execution-runner',
          cmd: spec.cmd,
          args: spec.args,
          cwd: spec.cwd,
          projectId: spec.projectId ?? null,
          port: Number(process.env.EXECUTION_RUNNER_PORT ?? '4310'),
        }, spec.logger)
      : null;

    const checkReady = (chunk: string) => {
      if (!spec.readyMarkers || spec.readyMarkers.length === 0) return;
      if (killedAfterReady) return; // already firing
      const lower = chunk.toLowerCase();
      if (!spec.readyMarkers.some((m) => lower.includes(m.toLowerCase()))) return;

      killedAfterReady = true;
      // Pause the per-step timeout while onReady runs so a slow probe
      // doesn't get cut off. We restart it with a short grace window
      // afterwards in case onReady itself misbehaves.
      if (timer) { clearTimeout(timer); timer = null; }

      const fire = async () => {
        if (spec.onReady) {
          try {
            await spec.onReady(stdout + '\n' + stderr);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            stderr = appendCapped(stderr, `\n[onReady error] ${msg}\n`, spec.maxLogBytes);
          }
        }
        lifecycle?.markStopRequested();
        try { proc.kill('SIGKILL'); } catch { /* best-effort */ }
      };
      // Don't await — let the spawn promise's 'close' handler resolve.
      void fire();
    };

    proc.stdout?.on('data', (c: Buffer) => {
      const s = c.toString('utf8');
      stdout = appendCapped(stdout, s, spec.maxLogBytes);
      checkReady(s);
    });
    proc.stderr?.on('data', (c: Buffer) => {
      const s = c.toString('utf8');
      stderr = appendCapped(stderr, s, spec.maxLogBytes);
      checkReady(s);
    });

    timer = setTimeout(() => {
      timedOut = true;
      lifecycle?.markStopRequested();
      try { proc.kill('SIGKILL'); } catch { /* best-effort */ }
    }, spec.timeoutMs);

    let resolved = false;
    const finalize = (result: RawRunResult) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    proc.on('error', (err) => {
      // The 'close' event normally still fires after 'error' for ENOENT,
      // but on some Node + Windows shell:true paths it does not, so we
      // resolve here too. `finalize` is idempotent so a later 'close'
      // is a no-op.
      stderr = appendCapped(stderr, `\n[spawn error] ${err.message}\n`, spec.maxLogBytes);
      finalize({
        exitCode: -1,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        killedAfterReady,
      });
    });

    proc.on('close', (code) => {
      finalize({
        exitCode: code,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
        timedOut,
        killedAfterReady,
      });
    });
  });
}

// ─────────────────────────────────────────────────────────────
// File materialisation
// ─────────────────────────────────────────────────────────────

async function writeFiles(targetDir: string, files: ReadonlyArray<ExecutionFile>): Promise<void> {
  for (const f of files) {
    if (isAbsolute(f.path) || f.path.includes('..')) {
      throw new Error(`refusing to write file outside project root: ${f.path}`);
    }
    const full = join(targetDir, f.path);
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, f.content, 'utf8');
  }
}

async function hasScript(pkgJsonPath: string, name: string): Promise<boolean> {
  try {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(pkgJsonPath, 'utf8');
    const pkg = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Boolean(pkg.scripts && pkg.scripts[name]);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────

/**
 * Validate a generated project by running it in a real environment.
 *
 *   1. Materialise files (if `files` provided).
 *   2. `npm install` (or pnpm/yarn).
 *   3. `npm run typecheck` (optional, only if script exists).
 *   4. `npm run build`.
 *   5. `npm run dev` — boots the dev server, watches for "ready"
 *      marker, then kills the process. A timeout without a ready
 *      marker counts as a runtime failure.
 *
 * Each step is bounded by its own timeout. The first failed step
 * short-circuits remaining steps (no point booting a build that
 * didn't compile).
 */
export async function runExecutionValidation(
  opts: ExecutionRunnerOptions,
): Promise<ExecutionValidationResult> {
  const log = opts.logger ?? noopLogger();
  const pm = opts.packageManager ?? 'npm';
  const maxBytes = opts.maxLogBytesPerStep ?? DEFAULT_MAX_LOG_BYTES;
  const startDev = opts.startDevServer !== false;
  const readyMarkers = opts.readyMarkers ?? DEFAULT_READY_MARKERS;

  // ── Resolve / create the project directory ────────────────
  let projectDir = opts.projectDir;
  let createdDir = false;
  if (!projectDir) {
    projectDir = await mkdtemp(join(tmpdir(), 'exec-runner-'));
    createdDir = true;
  } else {
    await mkdir(projectDir, { recursive: true });
  }

  if (opts.files && opts.files.length > 0) {
    await writeFiles(projectDir, opts.files);
    log.info(`[execution-runner] wrote ${opts.files.length} file(s) to ${projectDir}`, {
      event: 'execution-runner:files-written',
      count: opts.files.length,
      projectDir,
    });
  }

  const pkgJsonPath = join(projectDir, 'package.json');

  // ── Pre-flight: package.json MUST exist ───────────────────
  // Without it there is nothing to install/build/run, so this is a
  // hard, non-recoverable validation failure regardless of any other
  // settings. We surface it as both a buildError (so existing log
  // surfaces show it) and a structured failureReason.
  if (!existsSync(pkgJsonPath)) {
    log.error(`[execution-runner] no package.json at ${pkgJsonPath} — validation cannot proceed`, {
      event: 'execution-runner:no-package-json', projectDir,
    });
    return finalise(
      projectDir,
      [
        { step: 'install', ran: false, exitCode: null, durationMs: 0, timedOut: false, ok: false, stdout: '', stderr: '', errors: ['skipped: no package.json'] },
        { step: 'build',   ran: false, exitCode: null, durationMs: 0, timedOut: false, ok: false, stdout: '', stderr: '', errors: ['skipped: no package.json'] },
        { step: 'dev',     ran: false, exitCode: null, durationMs: 0, timedOut: false, ok: false, stdout: '', stderr: '', errors: ['skipped: no package.json'] },
      ],
      [`no package.json at ${projectDir}`],
      [],
      [],
      ['no package.json'],
      createdDir,
      opts.cleanup,
    );
  }

  const steps: ExecutionStepResult[] = [];
  const failureReasons: string[] = [];

  const stepCmd = (script: string): { cmd: string; args: string[] } => {
    if (pm === 'pnpm') return { cmd: 'pnpm', args: [script === 'install' ? 'install' : 'run', ...(script === 'install' ? [] : [script])] };
    if (pm === 'yarn') return { cmd: 'yarn', args: script === 'install' ? ['install'] : [script] };
    return { cmd: 'npm', args: script === 'install' ? ['install'] : ['run', script] };
  };

  // Helper to run + record a step.
  const runStep = async (
    step: ExecutionStepResult['step'],
    script: string,
    timeoutMs: number,
    extra: { readyMarkers?: string[]; onReady?: (output: string) => Promise<void> | void } = {},
  ): Promise<ExecutionStepResult> => {
    const { cmd, args } = stepCmd(script);
    log.info(`[execution-runner] ▶ ${step}: ${cmd} ${args.join(' ')}`, {
      event: 'execution-runner:step-start',
      step, cmd, args, timeoutMs, projectDir,
    });
    const raw = await runProcess({
      cmd, args,
      cwd: projectDir!,
      timeoutMs,
      readyMarkers: extra.readyMarkers,
      maxLogBytes: maxBytes,
      onReady: extra.onReady,
      logger: log,
      label: `exec-${step}`,
      projectId: opts.projectId ?? null,
    });
    const ok = step === 'dev'
      ? raw.killedAfterReady
      : raw.exitCode === 0;
    const errors = ok ? [] : extractErrors(raw.stdout, raw.stderr);
    const result: ExecutionStepResult = {
      step,
      ran: true,
      exitCode: raw.exitCode,
      durationMs: raw.durationMs,
      timedOut: raw.timedOut,
      ok,
      stdout: raw.stdout,
      stderr: raw.stderr,
      errors,
    };
    log[ok ? 'info' : 'error'](
      `[execution-runner] ${ok ? '✓' : '✗'} ${step} (exit=${raw.exitCode}, ${raw.durationMs}ms${raw.timedOut ? ', TIMEOUT' : ''})`,
      {
        event: ok ? 'execution-runner:step-ok' : 'execution-runner:step-fail',
        step,
        exitCode: raw.exitCode,
        durationMs: raw.durationMs,
        timedOut: raw.timedOut,
        errorCount: errors.length,
      },
    );
    steps.push(result);
    return result;
  };

  const skipStep = (step: ExecutionStepResult['step'], reason: string): void => {
    log.warn(`[execution-runner] skipping ${step}: ${reason}`, {
      event: 'execution-runner:step-skipped', step, reason,
    });
    steps.push({
      step, ran: false, exitCode: null, durationMs: 0,
      timedOut: false, ok: false, stdout: '', stderr: '',
      errors: [`skipped: ${reason}`],
    });
  };

  // ── 1. Install ────────────────────────────────────────────
  const install = await runStep('install', 'install',
    opts.timeouts?.install ?? DEFAULT_INSTALL_TIMEOUT_MS);

  let buildErrors: string[] = [];
  let runtimeErrors: string[] = [];

  if (!install.ok) {
    buildErrors = install.errors.length > 0 ? install.errors : [
      install.timedOut
        ? `install timed out after ${install.durationMs}ms`
        : `install exited with code ${install.exitCode}`,
    ];
    failureReasons.push(install.timedOut ? 'npm install timed out' : 'npm install failed');
    skipStep('typecheck', 'install failed');
    skipStep('build',     'install failed');
    skipStep('dev',       'install failed');
    return finalise(projectDir, steps, buildErrors, runtimeErrors, [], failureReasons, createdDir, opts.cleanup);
  }

  // ── 2. Optional typecheck ─────────────────────────────────
  if (opts.runTypecheck && await hasScript(pkgJsonPath, 'typecheck')) {
    const tc = await runStep('typecheck', 'typecheck', 90_000);
    if (!tc.ok) {
      buildErrors.push(...(tc.errors.length > 0 ? tc.errors :
        [tc.timedOut ? 'typecheck timed out' : `typecheck exited with code ${tc.exitCode}`]));
    }
  } else {
    skipStep('typecheck', opts.runTypecheck ? 'no typecheck script' : 'not requested');
  }

  // ── 3. Build (REQUIRED) ─────────────────────────────
  // A package.json without a `build` script is now a hard validation
  // failure: a project that can't build cannot ship. The previous
  // "skip = success" behaviour silently passed broken projects.
  const hasBuild = await hasScript(pkgJsonPath, 'build');
  if (!hasBuild) {
    skipStep('build', 'no build script in package.json');
    buildErrors.push('missing build script in package.json');
    failureReasons.push('missing build script');
    skipStep('dev', 'no build script');
    return finalise(projectDir, steps, buildErrors, runtimeErrors, [], failureReasons, createdDir, opts.cleanup);
  }
  const build = await runStep('build', 'build',
    opts.timeouts?.build ?? DEFAULT_BUILD_TIMEOUT_MS);
  if (!build.ok) {
    buildErrors.push(...(build.errors.length > 0 ? build.errors : [
      build.timedOut
        ? `build timed out after ${build.durationMs}ms`
        : `build exited with code ${build.exitCode}`,
    ]));
    failureReasons.push(build.timedOut ? 'build timed out' : 'build failed');
    skipStep('dev', 'build failed');
    return finalise(projectDir, steps, buildErrors, runtimeErrors, [], failureReasons, createdDir, opts.cleanup);
  }

  // ── 4. Dev server boot test + HTTP probes (REQUIRED) ─────
  // Strict: validation passes only if the dev server actually starts
  // AND at least one HTTP probe verifies a non-empty HTML response.
  let httpProbes: HttpProbeResult[] = [];

  if (!startDev) {
    skipStep('dev', 'startDevServer=false');
    runtimeErrors.push('dev server was not started (startDevServer=false)');
    failureReasons.push('server not started');
    return finalise(projectDir, steps, buildErrors, runtimeErrors, [], failureReasons, createdDir, opts.cleanup);
  }
  if (!(await hasScript(pkgJsonPath, 'dev'))) {
    skipStep('dev', 'no dev script in package.json');
    runtimeErrors.push('missing dev script in package.json');
    failureReasons.push('missing dev script');
    return finalise(projectDir, steps, buildErrors, runtimeErrors, [], failureReasons, createdDir, opts.cleanup);
  }
  if (opts.disableHttpProbes) {
    runtimeErrors.push('HTTP probes disabled — cannot verify the running server');
    failureReasons.push('HTTP not verified');
    return finalise(projectDir, steps, buildErrors, runtimeErrors, [], failureReasons, createdDir, opts.cleanup);
  }
  {
    // Resolve probe configuration. Default to probing '/' once the
    // server is ready, with a permissive set of HTML markers.
    const probesEnabled = !opts.disableHttpProbes;
    const probeOpts = opts.httpProbes ?? {};
    const probeRoutes = probesEnabled
      ? (probeOpts.routes && probeOpts.routes.length > 0 ? probeOpts.routes : ['/'])
      : [];
    const expectStatusRange: [number, number] = probeOpts.expectStatusRange ?? [200, 399];
    const expectMarkersAll = probeOpts.expectMarkers;
    const minBodyBytes = probeOpts.minBodyBytes ?? 200;
    const requestTimeoutMs = probeOpts.requestTimeoutMs ?? 10_000;
    const warmupTimeoutMs = probeOpts.warmupTimeoutMs ?? 5_000;
    const overrideHost = probeOpts.host;
    const overridePort = probeOpts.port;
    const fallbackPort = Number(process.env.EXECUTION_RUNNER_PORT ?? '4310');

    const onReady = probesEnabled && probeRoutes.length > 0
      ? async (output: string): Promise<void> => {
          const detected = extractServerOrigin(output);
          const host = overrideHost ?? detected?.host ?? '127.0.0.1';
          const port = overridePort ?? detected?.port ?? fallbackPort;

          // Wait until the listener actually accepts connections.
          const ready = await waitForServerWarmup(host, port, warmupTimeoutMs);
          if (!ready) {
            httpProbes.push({
              path: '*', url: `http://${host}:${port}`, ok: false, status: null,
              durationMs: warmupTimeoutMs, bodyBytes: 0, bodySample: '',
              error: `server did not accept connections at ${host}:${port} within ${warmupTimeoutMs}ms`,
            });
            return;
          }

          for (const route of probeRoutes) {
            const path = route.startsWith('/') ? route : `/${route}`;
            const url = `http://${host}:${port}${path}`;
            log.info(`[execution-runner] HTTP probe → ${url}`, {
              event: 'execution-runner:probe-start', url, path,
            });
            const result = await probeUrl({
              url, path,
              expectStatusRange,
              expectMarkersAll,
              expectMarkersAny: expectMarkersAll && expectMarkersAll.length > 0
                ? undefined
                : DEFAULT_BODY_MARKERS_ANY,
              minBodyBytes,
              timeoutMs: requestTimeoutMs,
            });
            httpProbes.push(result);
            log[result.ok ? 'info' : 'error'](
              `[execution-runner] HTTP probe ${result.ok ? '✓' : '✗'} ${path} (status=${result.status}, ${result.bodyBytes}B, ${result.durationMs}ms)${result.error ? ` — ${result.error}` : ''}`,
              {
                event: result.ok ? 'execution-runner:probe-ok' : 'execution-runner:probe-fail',
                url, path, status: result.status, bodyBytes: result.bodyBytes,
                durationMs: result.durationMs, error: result.error,
              },
            );
          }
        }
      : undefined;

    const dev = await runStep('dev', 'dev',
      opts.timeouts?.dev ?? DEFAULT_DEV_TIMEOUT_MS,
      { readyMarkers, onReady });
    if (!dev.ok) {
      runtimeErrors.push(...(dev.errors.length > 0 ? dev.errors : [
        dev.timedOut
          ? `dev server did not become ready within ${dev.durationMs}ms`
          : `dev server exited with code ${dev.exitCode} before ready marker`,
      ]));
      failureReasons.push(dev.timedOut ? 'dev server did not become ready' : 'dev server failed to start');
    }

    // HTTP probe failures count as runtime errors. The dev step itself
    // succeeded (the server booted) but it didn't actually serve a real
    // page — that's a runtime-level failure.
    for (const p of httpProbes) {
      if (p.ok) continue;
      const detail = p.error
        ?? `probe ${p.path} returned status ${p.status} with ${p.bodyBytes} bytes`;
      runtimeErrors.push(`HTTP ${p.path}: ${detail}`);
    }
    if (httpProbes.length === 0) {
      failureReasons.push('HTTP not verified');
    } else if (!httpProbes.every((p) => p.ok)) {
      failureReasons.push('HTTP probe failed');
    }
  }

  return finalise(projectDir, steps, buildErrors, runtimeErrors, httpProbes, failureReasons, createdDir, opts.cleanup);
}

async function finalise(
  projectDir: string,
  steps: ExecutionStepResult[],
  buildErrors: string[],
  runtimeErrors: string[],
  httpProbes: HttpProbeResult[],
  failureReasons: string[],
  createdDir: boolean,
  cleanup: boolean | undefined,
): Promise<ExecutionValidationResult> {
  // STRICT success: install + build + dev MUST have actually run AND
  // succeeded, AND at least one HTTP probe must have passed. A skipped
  // step is never a pass. If no failureReasons were collected upstream,
  // we derive any missing ones from the steps themselves so the caller
  // always sees something machine-readable.
  const reasons = [...failureReasons];
  const find = (s: ExecutionStepResult['step']): ExecutionStepResult | undefined =>
    steps.find((x) => x.step === s);
  const installStep = find('install');
  const buildStep = find('build');
  const devStep = find('dev');
  const installRan = !!installStep?.ran;
  const installOk = !!installStep?.ok;
  const buildRan = !!buildStep?.ran;
  const buildOk = !!buildStep?.ok;
  const devRan = !!devStep?.ran;
  const devOk = !!devStep?.ok;
  const httpRan = httpProbes.length > 0;
  const httpOk = httpRan && httpProbes.every((p) => p.ok);

  const success = installRan && installOk
    && buildRan && buildOk
    && devRan && devOk
    && httpRan && httpOk;

  if (!success && reasons.length === 0) {
    if (!installRan) reasons.push('npm install not run');
    else if (!installOk) reasons.push('npm install failed');
    if (!buildRan) reasons.push('build not run');
    else if (!buildOk) reasons.push('build failed');
    if (!devRan) reasons.push('server not started');
    else if (!devOk) reasons.push('dev server failed to start');
    if (!httpRan) reasons.push('HTTP not verified');
    else if (!httpOk) reasons.push('HTTP probe failed');
  }

  // Build a single capped log blob for callers that just want a summary.
  const logs = steps
    .map((s) => {
      const header = `── ${s.step.toUpperCase()} ${s.ran ? `(exit=${s.exitCode}, ${s.durationMs}ms${s.timedOut ? ', TIMEOUT' : ''})` : '(skipped)'} ──`;
      const body = [
        s.stdout ? `[stdout]\n${s.stdout}` : '',
        s.stderr ? `[stderr]\n${s.stderr}` : '',
      ].filter(Boolean).join('\n');
      return `${header}\n${body}`.trimEnd();
    })
    .join('\n\n');

  // Append probe summaries to the logs blob.
  let probeLog = '';
  if (httpProbes.length > 0) {
    probeLog = '\n\n── HTTP PROBES ──\n' + httpProbes.map((p) => {
      const tag = p.ok ? '✓' : '✗';
      const hdr = `${tag} ${p.path}  status=${p.status}  body=${p.bodyBytes}B  ${p.durationMs}ms`;
      const err = p.error ? `\n  error: ${p.error}` : '';
      const sample = p.bodySample
        ? `\n  body[0..${Math.min(p.bodySample.length, 200)}]: ${p.bodySample.replace(/\s+/g, ' ').slice(0, 200)}`
        : '';
      return `${hdr}${err}${sample}`;
    }).join('\n');
  }

  if (createdDir && cleanup) {
    try {
      await rm(projectDir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }

  return {
    success,
    failureReasons: dedupe(reasons),
    buildErrors:   dedupe(buildErrors),
    runtimeErrors: dedupe(runtimeErrors),
    logs: logs + probeLog,
    steps,
    httpProbes,
    projectDir,
  };
}

function dedupe(xs: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of xs) {
    if (seen.has(x)) continue;
    seen.add(x);
    out.push(x);
  }
  return out;
}
