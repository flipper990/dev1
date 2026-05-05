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
import { request as httpRequest } from 'node:http';
import { join, dirname } from 'node:path';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { PortAllocator } from './port-allocator.js';
import type { StackInfo } from './types.js';
import { detectStack } from './stack-detector.js';
import { instrumentChild } from './spawn-logger.js';

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
  log: string;          // ring buffer
  ready: boolean;
  error: string | null;
  /** Lifecycle handle for the dev process — used to flag a kill as expected. */
  markStopRequested?: () => void;
}

const IS_WIN = process.platform === 'win32';
const MAX_LOG_BYTES = 32_000;
const READY_TIMEOUT_MS = 90_000;
const READY_POLL_INTERVAL_MS = 500;
const STOP_GRACE_MS = 5_000;

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
   */
  async start(projectId: string, files: LocalPreviewFile[]): Promise<LocalPreviewRecord> {
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
      ready: false,
      error: null,
    };
    this.records.set(projectId, record);

    if (needsInstall) {
      this.opts.logger.info('local-runner: running install', { projectId, pm, stagingDir });
      try {
        await this.runInstall(stagingDir, pm, record);
        await writeFile(fpPath, fp, 'utf8');
      } catch (err) {
        this.opts.ports.release(port);
        this.records.delete(projectId);
        throw new Error(`npm install failed: ${(err as Error).message}`);
      }
    } else {
      this.opts.logger.info('local-runner: install cache hit', { projectId, fp });
    }

    // ── Spawn dev ──────────────────────────────────────────
    this.opts.logger.info('local-runner: starting dev server', { projectId, pm, port, stagingDir });
    const child = spawn(pmExe(pm), ['run', 'dev'], {
      cwd: stagingDir,
      shell: IS_WIN,
      windowsHide: true,
      env: {
        ...process.env,
        PORT: String(port),
        HOST: '127.0.0.1',
        HOSTNAME: '127.0.0.1',
        BROWSER: 'none',
        CI: '1',
        FORCE_COLOR: '0',
        NO_COLOR: '1',
        // Keep Next.js / Vite bound to localhost only.
        NEXT_TELEMETRY_DISABLED: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const devLifecycle = instrumentChild(child, {
      label: 'local-dev',
      cmd: pmExe(pm),
      args: ['run', 'dev'],
      cwd: stagingDir,
      projectId,
      port,
      // We treat a dev-server exit before stop() as unexpected.
      expectsLongRunning: true,
    }, this.opts.logger);
    record.child = child;
    record.markStopRequested = devLifecycle.markStopRequested;

    const appendLog = (chunk: Buffer | string) => {
      const s = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      record.log = (record.log + s).slice(-MAX_LOG_BYTES);
    };
    child.stdout?.on('data', appendLog);
    child.stderr?.on('data', appendLog);

    child.once('exit', (code, signal) => {
      this.opts.logger.warn('local-runner: dev process exited', { projectId, code, signal });
      record.ready = false;
      if (!record.error && code !== 0 && code !== null) {
        record.error = `dev server exited with code ${code}${signal ? ` (signal ${signal})` : ''}`;
      }
    });
    child.once('error', (err) => {
      this.opts.logger.error('local-runner: dev process error', { projectId, err: err.message });
      record.error = err.message;
      record.ready = false;
    });

    // ── Wait for readiness ────────────────────────────────
    try {
      await this.waitForReady(port, READY_TIMEOUT_MS, child);
      record.ready = true;
      this.opts.logger.info('local-runner: dev server READY', { projectId, port });
      return record;
    } catch (err) {
      // Tear down — readiness failed.
      this.opts.logger.error('local-runner: dev server failed readiness', {
        projectId, err: (err as Error).message,
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
      const dest = join(rootDir, file.path);
      await mkdir(dirname(dest), { recursive: true });
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
      const child = spawn(pmExe(pm), args, {
        cwd: stagingDir,
        shell: IS_WIN,
        windowsHide: true,
        env: { ...process.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      instrumentChild(child, {
        label: 'local-install',
        cmd: pmExe(pm),
        args,
        cwd: stagingDir,
        projectId: record.projectId,
      }, this.opts.logger);
      const append = (chunk: Buffer) => {
        record.log = (record.log + chunk.toString('utf8')).slice(-MAX_LOG_BYTES);
      };
      child.stdout?.on('data', append);
      child.stderr?.on('data', append);
      const timer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
        reject(new Error(`install timed out after 240s`));
      }, 240_000);
      child.once('error', (err) => { clearTimeout(timer); reject(err); });
      child.once('exit', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(`${pm} install exited ${code}`));
      });
    });
  }

  /**
   * Poll the allocated port with HEAD `/` until we get any HTTP response
   * (status code irrelevant — we just need TCP+HTTP to be alive). Aborts
   * early if the child process dies.
   */
  private async waitForReady(port: number, timeoutMs: number, child: ChildProcess): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (child.exitCode !== null || child.killed) {
        throw new Error(`dev server exited before becoming ready (code=${child.exitCode})`);
      }
      const ok = await this.probeOnce(port).catch(() => false);
      if (ok) return;
      await new Promise((r) => setTimeout(r, READY_POLL_INTERVAL_MS));
    }
    throw new Error(`dev server did not become ready on port ${port} within ${timeoutMs}ms`);
  }

  private probeOnce(port: number): Promise<boolean> {
    return new Promise((resolve) => {
      const req = httpRequest({
        host: '127.0.0.1', port, method: 'HEAD', path: '/', timeout: 1_500,
      }, (res) => {
        // Any HTTP response = dev server is up.
        res.resume();
        resolve((res.statusCode ?? 0) > 0);
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.end();
    });
  }
}
