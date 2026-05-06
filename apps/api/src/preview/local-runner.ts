// ─────────────────────────────────────────────────────────────
// Local preview runner — Docker fallback.
//
// Spawns the project's dev server directly on the host (no container)
// and keeps it alive. Used when Docker isn't available so the user
// still gets a real running app in the iframe instead of a static
// in-browser srcDoc preview.
//
//   start(projectId, files)     stage → install → spawn dev → wait ready
//   stop(projectId)             SIGTERM, then SIGKILL after grace
//   isAvailable()               check that node + a package manager exist
//
// Each project gets its own staging directory under
// data/projects/<id>/.preview-runtime/ so node_modules persists across
// restarts (much faster reboots).
// ─────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readdir, rm, stat, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { PortAllocator } from './port-allocator.js';
import type { StackInfo } from './types.js';
import { detectStack } from './stack-detector.js';
import { instrumentChild } from './spawn-logger.js';
import { recordProbe, type ProbeAttempt } from './probe-recorder.js';

export interface LocalPreviewFile {
  path: string;
  contents: string;
}

export interface LocalPreviewRecord {
  projectId: string;
  child: ChildProcess;
  port: number;
  stagingDir: string;
  stack: StackInfo;
  startedAt: number;
  log: string;          // ring buffer (combined stdout+stderr — kept for back-compat)
  /** Separate stdout / stderr ring buffers used to surface a faithful
   *  failure reason. The combined `log` field stays for code paths that
   *  need a single stream (e.g. UI iframe error pane); engineers reading
   *  the diagnostic dump can see which stream produced which line. */
  stdoutLog: string;
  stderrLog: string;
  ready: boolean;
  error: string | null;
  /** Captured at the moment the dev process exits. Lets the manager
   *  surface "exit code 1, signal=null, stderr tail: …" instead of a
   *  bland "container exited unexpectedly". */
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  /** ISO timestamp the child was successfully spawned (i.e.
   *  `child.pid` was populated). `null` while spawn is still in
   *  flight. Used by the manager-side liveness classifier to compute
   *  process uptime at the moment the watchdog tripped. */
  processStartedAt: string | null;
  /** ISO timestamp the `exit` event fired. `null` while the process
   *  is alive. Captured alongside exitCode / exitSignal so the
   *  postmortem can show "crashed N seconds after spawn". */
  processExitedAt: string | null;
  /** True the moment the child exits. Read by waitForReady to fail fast
   *  with the captured code/signal/stderr instead of timing out. */
  exited: boolean;
  /** Most recent successful step before exit/failure (mirrors
   *  PreviewRecord.lastMeaningfulStep but locally tracked because the
   *  child can die during install just as easily as during dev). */
  lastSuccessfulStep: string;
  /** Append-only ring buffer of every HTTP probe issued during the
   *  readiness wait. Capped at the last `MAX_PROBE_ATTEMPTS` entries.
   *  Drives the timeout-dump's "what kind of failure?" classification
   *  (port-never-opened vs tcp-opened-no-http vs http-error-status). */
  probeAttempts: ProbeAttempt[];
  /** Lifecycle handle for the dev process — used to flag a kill as expected. */
  markStopRequested?: () => void;
}

const IS_WIN = process.platform === 'win32';
const MAX_LOG_BYTES = 32_000;
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_INTERVAL_MS = 500;
const STOP_GRACE_MS = 5_000;
/** Cap on the size of the per-record probe-attempt ring buffer. The
 *  last N attempts are persisted into ProjectRecord.preview and the
 *  timeout dump. 64 attempts at 500ms cadence covers the full 30s of
 *  the readiness wait the manager-side watchdog targets, with
 *  generous head-room for retries. */
const MAX_PROBE_ATTEMPTS = 64;

/** Pick a package manager based on lockfiles in the project. */
function detectPackageManager(files: LocalPreviewFile[]): 'pnpm' | 'npm' | 'yarn' {
  const has = (name: string) => files.some((f) => f.path === name);
  if (has('pnpm-lock.yaml')) return 'pnpm';
  if (has('yarn.lock')) return 'yarn';
  return 'npm';
}

/** Resolve a Windows-friendly executable name. */
function pmExe(pm: 'pnpm' | 'npm' | 'yarn'): string {
  return IS_WIN ? `${pm}.cmd` : pm;
}

/** Hash the package.json + lockfile to decide whether install can be skipped. */
function fingerprintInstall(files: LocalPreviewFile[]): string {
  const targets = ['package.json', 'pnpm-lock.yaml', 'package-lock.json', 'yarn.lock'];
  const h = createHash('sha1');
  for (const t of targets) {
    const f = files.find((x) => x.path === t);
    if (f) { h.update(t); h.update(f.contents); }
  }
  return h.digest('hex');
}

export class LocalPreviewRunner {
  private records = new Map<string, LocalPreviewRecord>();
  private cachedAvailable: boolean | null = null;

  constructor(private opts: {
    projectStore: ProjectStore;
    ports: PortAllocator;
    logger: Logger;
  }) {}

  /** Probe once whether we have a usable package manager on the host. */
  async isAvailable(): Promise<boolean> {
    if (this.cachedAvailable !== null) return this.cachedAvailable;
    // Minimal check: try `node --version`. We always have node (we're running on it),
    // so this almost always returns true. A more thorough check would also probe npm,
    // but on Windows npm.cmd lives next to node.exe so node's presence is sufficient.
    this.cachedAvailable = await new Promise<boolean>((resolve) => {
      const child = spawn(IS_WIN ? 'node.exe' : 'node', ['--version'], {
        stdio: 'ignore',
        shell: false,
        windowsHide: true,
      });
      instrumentChild(child, {
        label: 'local-probe',
        cmd: IS_WIN ? 'node.exe' : 'node',
        args: ['--version'],
      }, this.opts.logger);
      child.once('error', () => resolve(false));
      child.once('exit', (code) => resolve(code === 0));
    });
    return this.cachedAvailable;
  }

  get(projectId: string): LocalPreviewRecord | null {
    return this.records.get(projectId) ?? null;
  }

  list(): LocalPreviewRecord[] {
    return [...this.records.values()];
  }

  /**
   * Start (or return existing) a local dev server for the project.
   * Resolves once the server has accepted at least one TCP connection
   * on the allocated port.
   *
   * `onPhase` is an optional progress callback the PreviewManager uses
   * to drive its `preview:*` step transitions. Called with one of:
   *   • `'spawning-server'`   — `child_process.spawn(npm run dev …)`
   *     just issued; child PID is being created.
   *   • `'waiting-for-port'`  — child spawned (PID known); now polling
   *     the allocated TCP port until the dev server starts listening.
   * Failures inside the callback are swallowed — progress reporting
   * must never disturb the boot sequence.
   */
  async start(
    projectId: string,
    files: LocalPreviewFile[],
    onPhase?: (phase: 'spawning-server' | 'waiting-for-port', meta?: { pid?: number | null; port?: number | null; cmd?: string; cwd?: string }) => void,
    onProbe?: (attempt: ProbeAttempt) => void,
  ): Promise<LocalPreviewRecord> {
    const existing = this.records.get(projectId);
    if (existing && existing.ready && !existing.child.killed) {
      return existing;
    }
    if (existing) {
      // Stale: kill before restarting.
      await this.stop(projectId);
    }

    const stagingDir = join(this.opts.projectStore.getOutputDir(projectId), '.preview-runtime');
    await mkdir(stagingDir, { recursive: true });

    // ── Stage files ────────────────────────────────────────
    let detected: StackInfo;
    try {
      await this.writeFiles(stagingDir, files);
      detected = detectStack(stagingDir);
    } catch (err) {
      throw new Error(`Failed to stage project files: ${(err as Error).message}`);
    }

    if (!detected.hasDevScript) {
      throw new Error(
        `Cannot run local preview: project has no "dev" script in package.json. ` +
        `Detected stack: ${detected.kind}. ${detected.detectionNote}`,
      );
    }

    const pm = detectPackageManager(files);
    const port = await this.opts.ports.allocate();

    // ── Install (cached by fingerprint) ────────────────────
    const fp = fingerprintInstall(files);
    const fpPath = join(stagingDir, '.install.fp');
    let prevFp: string | null = null;
    try { prevFp = (await readFile(fpPath, 'utf8')).trim(); } catch { /* miss */ }
    const nodeModulesExists = await stat(join(stagingDir, 'node_modules')).then(() => true).catch(() => false);
    const needsInstall = !nodeModulesExists || prevFp !== fp;

    const record: LocalPreviewRecord = {
      projectId,
      child: null as unknown as ChildProcess, // populated below
      port,
      stagingDir,
      stack: detected,
      startedAt: Date.now(),
      log: '',
      stdoutLog: '',
      stderrLog: '',
      ready: false,
      error: null,
      exitCode: null,
      exitSignal: null,
      processStartedAt: null,
      processExitedAt: null,
      exited: false,
      lastSuccessfulStep: 'staged files',
      probeAttempts: [],
    };
    this.records.set(projectId, record);

    if (needsInstall) {
      this.opts.logger.info('local-runner: running install', { projectId, pm, stagingDir });
      try {
        await this.runInstall(stagingDir, pm, record);
        await writeFile(fpPath, fp, 'utf8');
        record.lastSuccessfulStep = 'install completed';
      } catch (err) {
        this.opts.ports.release(port);
        this.records.delete(projectId);
        throw new Error(`npm install failed: ${(err as Error).message}`);
      }
    } else {
      this.opts.logger.info('local-runner: install cache hit', { projectId, fp });
      record.lastSuccessfulStep = 'install cache hit';
    }

    // ── Spawn dev ──────────────────────────────────────────
    // Verbose startup log: every field a future post-mortem might need
    // (cmd, args, cwd, port, env subset). Secrets are NEVER included —
    // we explicitly enumerate the non-secret keys to forward.
    const devCmd = pmExe(pm);
    const devArgs = ['run', 'dev'];
    const devEnvSafe: Record<string, string> = {
      PORT: String(port),
      HOST: '127.0.0.1',
      HOSTNAME: '127.0.0.1',
      BROWSER: 'none',
      CI: '1',
      FORCE_COLOR: '0',
      NO_COLOR: '1',
      NEXT_TELEMETRY_DISABLED: '1',
    };
    this.opts.logger.info('local-runner: starting dev server', {
      event: 'preview:runtime-start',
      runtime: 'local',
      projectId,
      pm,
      cmd: devCmd,
      args: devArgs,
      cwd: stagingDir,
      port,
      env: devEnvSafe,
    });
    // Phase boundary: about to spawn the dev process. The PreviewManager
    // uses this signal to flip `previewStep` from `preview:installing`
    // to `preview:spawning-server` so a stuck spawn() (rare, but
    // possible on some Windows shells) is visible in the UI.
    try {
      onPhase?.('spawning-server', {
        pid: null, port,
        cmd: `${devCmd} ${devArgs.join(' ')}`,
        cwd: stagingDir,
      });
    } catch { /* progress callbacks must never abort boot */ }
    const child = spawn(devCmd, devArgs, {
      cwd: stagingDir,
      shell: IS_WIN,
      windowsHide: true,
      env: {
        ...process.env,
        ...devEnvSafe,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const devLifecycle = instrumentChild(child, {
      label: 'local-dev',
      cmd: devCmd,
      args: devArgs,
      cwd: stagingDir,
      projectId,
      port,
      // We treat a dev-server exit before stop() as unexpected.
      expectsLongRunning: true,
    }, this.opts.logger);
    record.child = child;
    record.markStopRequested = devLifecycle.markStopRequested;
    // Stamp processStartedAt as soon as we have a valid PID. Note
    // child.pid is `undefined` if the spawn failed synchronously —
    // in that case the `error` event below fires with the failure
    // reason and processStartedAt stays null.
    if (typeof child.pid === 'number') {
      record.processStartedAt = new Date().toISOString();
    }

    // Split stdout / stderr ring buffers. The combined `log` is kept for
    // legacy consumers that just want a single stream.
    const appendStdout = (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      record.stdoutLog = (record.stdoutLog + s).slice(-MAX_LOG_BYTES);
      record.log = (record.log + s).slice(-MAX_LOG_BYTES);
    };
    const appendStderr = (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      record.stderrLog = (record.stderrLog + s).slice(-MAX_LOG_BYTES);
      record.log = (record.log + s).slice(-MAX_LOG_BYTES);
    };
    child.stdout?.on('data', appendStdout);
    child.stderr?.on('data', appendStderr);

    child.once('exit', (code, signal) => {
      record.exitCode = code;
      record.exitSignal = signal;
      record.exited = true;
      record.processExitedAt = new Date().toISOString();
      this.opts.logger.warn('local-runner: dev process exited', {
        event: 'preview:runtime-exit',
        runtime: 'local',
        projectId,
        cmd: devCmd,
        args: devArgs,
        cwd: stagingDir,
        port,
        code,
        signal,
        lastSuccessfulStep: record.lastSuccessfulStep,
        stderrTail: record.stderrLog.slice(-1_500),
      });
      record.ready = false;
      // Build a structured failure message so PreviewManager.fail() can
      // surface the real reason on the UI's `previewError`.
      if (!record.error && code !== 0 && code !== null) {
        const tail = (record.stderrLog || record.stdoutLog).trim().split(/\r?\n/).slice(-3).join(' | ').slice(-400);
        record.error =
          `dev server exited with code ${code}` +
          (signal ? ` (signal ${signal})` : '') +
          (tail ? ` — ${tail}` : '');
      } else if (!record.error && signal) {
        const tail = (record.stderrLog || record.stdoutLog).trim().split(/\r?\n/).slice(-3).join(' | ').slice(-400);
        record.error = `dev server killed by signal ${signal}` + (tail ? ` — ${tail}` : '');
      }
    });
    child.once('error', (err) => {
      this.opts.logger.error('local-runner: dev process error', {
        event: 'preview:runtime-spawn-error',
        runtime: 'local',
        projectId,
        cmd: devCmd,
        args: devArgs,
        cwd: stagingDir,
        port,
        err: err.message,
        stack: err.stack,
      });
      record.error = err.message;
      record.exited = true;
      record.ready = false;
    });

    // ── Wait for readiness ────────────────────────────────
    record.lastSuccessfulStep = 'spawned dev process';
    // Phase boundary: child PID exists, now polling for TCP-listen. The
    // PreviewManager flips `previewStep` to `preview:waiting-for-port`
    // here so the UI can distinguish "the server is starting up" from
    // "we're hung waiting for it to bind a port".
    try {
      onPhase?.('waiting-for-port', {
        pid: child.pid ?? null, port,
        cmd: `${devCmd} ${devArgs.join(' ')}`,
        cwd: stagingDir,
      });
    } catch { /* progress callbacks must never abort boot */ }
    try {
      await this.waitForReady(port, READY_TIMEOUT_MS, child, record, onProbe);
      record.ready = true;
      record.lastSuccessfulStep = 'tcp listening';
      this.opts.logger.info('local-runner: dev server READY', { projectId, port });
      return record;
    } catch (err) {
      // Tear down — readiness failed.
      this.opts.logger.error('local-runner: dev server failed readiness', {
        projectId,
        err: (err as Error).message,
        exitCode: record.exitCode,
        exitSignal: record.exitSignal,
        lastSuccessfulStep: record.lastSuccessfulStep,
        stderrTail: record.stderrLog.slice(-1_500),
      });
      record.error = (err as Error).message;
      await this.stop(projectId);
      throw err;
    }
  }

  /** Stop a running local preview. Idempotent. */
  async stop(projectId: string): Promise<void> {
    const rec = this.records.get(projectId);
    if (!rec) return;
    this.records.delete(projectId);

    if (rec.child && !rec.child.killed) {
      this.opts.logger.info('local-runner: stop requested', {
        projectId, pid: rec.child.pid ?? null, port: rec.port,
      });
      rec.markStopRequested?.();
      try {
        rec.child.kill(IS_WIN ? undefined : 'SIGTERM');
      } catch { /* already gone */ }
      // SIGKILL after grace period if still alive.
      const killTimer = setTimeout(() => {
        try { if (!rec.child.killed) rec.child.kill('SIGKILL'); } catch { /* ignore */ }
      }, STOP_GRACE_MS);
      await new Promise<void>((resolve) => {
        if (rec.child.exitCode !== null) { resolve(); return; }
        rec.child.once('exit', () => resolve());
      });
      clearTimeout(killTimer);
    }
    this.opts.ports.release(rec.port);
  }

  async shutdown(): Promise<void> {
    await Promise.all([...this.records.keys()].map((id) => this.stop(id)));
  }

  // ── internals ─────────────────────────────────────────

  private async writeFiles(rootDir: string, files: LocalPreviewFile[]): Promise<void> {
    // Wipe previous source files (but keep node_modules + .install.fp for caching).
    const keep = new Set(['node_modules', '.install.fp', '.next', '.turbo']);
    let entries: string[] = [];
    try { entries = await readdir(rootDir); } catch { /* fresh dir */ }
    await Promise.all(entries.map(async (name) => {
      if (keep.has(name)) return;
      await rm(join(rootDir, name), { recursive: true, force: true }).catch(() => { /* ignore */ });
    }));

    for (const file of files) {
      // Defence-in-depth: never let a project file escape the staging root via "..".
      if (file.path.includes('..')) continue;
      if (file.path.startsWith('/') || file.path.startsWith('\\')) continue;
      // Type-guard: writing `undefined` would throw the cryptic
      // "The 'data' argument must be of type string …" message,
      // which the user/UI surfaces as a generic preview failure.
      // Skip + log so the runner keeps going for the rest of the
      // tree.
      if (typeof file.contents !== 'string') {
        this.opts.logger.warn('local-runner: skipping file with non-string contents', {
          path: file.path,
          typeofContents: typeof file.contents,
        });
        continue;
      }
      const dest = join(rootDir, file.path);
      await mkdir(dirname(dest), { recursive: true });
      this.opts.logger.debug('local-runner: write file', {
        path: file.path,
        bytes: file.contents.length,
      });
      await writeFile(dest, file.contents, 'utf8');
    }
  }

  private runInstall(
    stagingDir: string,
    pm: 'pnpm' | 'npm' | 'yarn',
    record: LocalPreviewRecord,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const args = pm === 'yarn' ? ['install'] : ['install', '--no-audit', '--no-fund'];
      const installCmd = pmExe(pm);
      const installEnvSafe = { CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' };
      this.opts.logger.info('local-runner: starting install process', {
        event: 'preview:runtime-start',
        runtime: 'local',
        phase: 'install',
        projectId: record.projectId,
        cmd: installCmd,
        args,
        cwd: stagingDir,
        env: installEnvSafe,
      });
      const child = spawn(installCmd, args, {
        cwd: stagingDir,
        shell: IS_WIN,
        windowsHide: true,
        env: { ...process.env, ...installEnvSafe },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      instrumentChild(child, {
        label: 'local-install',
        cmd: installCmd,
        args,
        cwd: stagingDir,
        projectId: record.projectId,
      }, this.opts.logger);
      const appendStdout = (chunk: Buffer) => {
        const s = chunk.toString('utf8');
        record.stdoutLog = (record.stdoutLog + s).slice(-MAX_LOG_BYTES);
        record.log = (record.log + s).slice(-MAX_LOG_BYTES);
      };
      const appendStderr = (chunk: Buffer) => {
        const s = chunk.toString('utf8');
        record.stderrLog = (record.stderrLog + s).slice(-MAX_LOG_BYTES);
        record.log = (record.log + s).slice(-MAX_LOG_BYTES);
      };
      child.stdout?.on('data', appendStdout);
      child.stderr?.on('data', appendStderr);
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        const tail = (record.stderrLog || record.stdoutLog).trim().split(/\r?\n/).slice(-3).join(' | ').slice(-400);
        reject(new Error(`install timed out after 240s${tail ? ` — ${tail}` : ''}`));
      }, 240_000);
      child.once('error', (err) => { clearTimeout(timer); reject(err); });
      child.once('exit', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) { resolve(); return; }
        const tail = (record.stderrLog || record.stdoutLog).trim().split(/\r?\n/).slice(-3).join(' | ').slice(-400);
        reject(new Error(
          `${pm} install exited code=${code}` +
          (signal ? ` signal=${signal}` : '') +
          (tail ? ` — ${tail}` : ''),
        ));
      });
    });
  }

  /**
   * Poll the allocated port with HEAD `/` until we get any HTTP response
   * (status code irrelevant — we just need TCP+HTTP to be alive). Aborts
   * early if the child process dies. Every probe is recorded onto
   * `record.probeAttempts` (capped) so the timeout dump can answer
   * "port never opened?" / "TCP opened but HTTP failed?" / etc., and
   * `onProbe` (when supplied) is invoked once per attempt so the
   * PreviewManager can mirror attempts onto its own record.
   */
  private async waitForReady(
    port: number,
    timeoutMs: number,
    child: ChildProcess,
    record?: LocalPreviewRecord,
    onProbe?: (attempt: ProbeAttempt) => void,
  ): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.killed || record?.exited) {
        const code = child.exitCode ?? record?.exitCode ?? null;
        const signal = record?.exitSignal ?? null;
        const tail = record
          ? (record.stderrLog || record.stdoutLog).trim().split(/\r?\n/).slice(-5).join(' | ').slice(-600)
          : '';
        throw new Error(
          `dev server exited before becoming ready (code=${code}` +
          (signal ? `, signal=${signal}` : '') +
          `)` +
          (tail ? ` — ${tail}` : ''),
        );
      }
      // Capture the body on every Nth attempt (cheap GET) so the
      // probe history always has at least one bodySample for the
      // timeout dump even when the readiness wait succeeds quickly.
      // Specifically: the FIRST attempt (so a fast-fail still has a
      // body sample) and every 4th attempt thereafter.
      const attemptIdx = record?.probeAttempts.length ?? 0;
      const captureBody = attemptIdx === 0 || attemptIdx % 4 === 0;
      const attempt = await recordProbe({
        host: '127.0.0.1', port, path: '/',
        timeoutMs: 1_500,
        captureBody,
      });
      if (record) {
        record.probeAttempts.push(attempt);
        if (record.probeAttempts.length > MAX_PROBE_ATTEMPTS) {
          record.probeAttempts = record.probeAttempts.slice(-MAX_PROBE_ATTEMPTS);
        }
      }
      try { onProbe?.(attempt); } catch { /* mirror callbacks must never abort boot */ }
      if (attempt.ok) return;
      await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
    }
    throw new Error(`dev server did not become ready on port ${port} within ${timeoutMs}ms`);
  }
}
