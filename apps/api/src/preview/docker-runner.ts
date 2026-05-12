// ─────────────────────────────────────────────────────────────
// Docker runner — thin async wrapper around the docker CLI.
// We deliberately avoid the dockerode npm package: it bundles
// its own protocol implementation and adds 4 MB of deps. The
// docker CLI is on the PATH for anyone running this and gives
// us a stable contract.
// ─────────────────────────────────────────────────────────────

import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { request as httpRequest } from 'node:http';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import { instrumentChild } from './spawn-logger.js';
import { recordProbe, type ProbeAttempt } from './probe-recorder.js';
import { resolvePathWithinRoot, UnsafeProjectPathError } from '../security/safe-path.js';

export interface SpawnResult {
  code: number;
  stdout: string;
  stderr: string;
  /** Combined output, capped at maxLogBytes for log readability. */
  combined: string;
}

const DEFAULT_MAX_LOG_BYTES = 64_000;

/** Spawn a process and resolve with all captured output. */
function runOnce(
  cmd: string,
  args: string[],
  opts: { cwd?: string; timeoutMs?: number; maxLogBytes?: number; logger?: Logger; label?: string } = {},
): Promise<SpawnResult> {
  return new Promise((resolve) => {
    const max = opts.maxLogBytes ?? DEFAULT_MAX_LOG_BYTES;
    let stdout = '';
    let stderr = '';
    let combined = '';
    let timer: NodeJS.Timeout | null = null;
    let timedOut = false;

    const proc: ChildProcess = spawn(cmd, args, {
      cwd: opts.cwd,
      shell: false,
      windowsHide: true,
    });
    const lifecycle = opts.logger
      ? instrumentChild(proc, {
          label: opts.label ?? 'docker-cli',
          cmd, args, cwd: opts.cwd,
        }, opts.logger)
      : null;

    const append = (target: 'stdout' | 'stderr', chunk: Buffer) => {
      const str = chunk.toString('utf8');
      if (target === 'stdout' && stdout.length < max) stdout += str.slice(0, max - stdout.length);
      if (target === 'stderr' && stderr.length < max) stderr += str.slice(0, max - stderr.length);
      if (combined.length < max) combined += str.slice(0, max - combined.length);
    };

    proc.stdout?.on('data', (c) => append('stdout', c));
    proc.stderr?.on('data', (c) => append('stderr', c));

    if (opts.timeoutMs) {
      timer = setTimeout(() => {
        timedOut = true;
        lifecycle?.markStopRequested();
        try { proc.kill('SIGKILL'); } catch { /* best-effort */ }
      }, opts.timeoutMs);
    }

    let resolved = false;
    const finalize = (result: SpawnResult) => {
      if (resolved) return;
      resolved = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };

    proc.on('close', (code) => {
      if (timedOut) {
        stderr += `\n[runner] killed after ${opts.timeoutMs}ms timeout`;
        combined += `\n[runner] killed after ${opts.timeoutMs}ms timeout`;
      }
      finalize({ code: code ?? -1, stdout, stderr, combined });
    });

    // Note: the floor 'error' listener attached by instrumentChild
    // ensures EventEmitter never throws. We add OUR resolver as a
    // separate listener so the promise still resolves on ENOENT et al.
    proc.on('error', (err) => {
      stderr += `\n[runner] spawn error: ${err.message}`;
      combined += `\n[runner] spawn error: ${err.message}`;
      finalize({ code: -1, stdout, stderr, combined });
    });
  });
}

export interface DockerBuildOptions {
  contextDir: string;
  dockerfileContents: string;
  imageTag: string;
  /** Extra files we want to ensure exist in the build context (path relative to contextDir → contents). */
  ensureFiles?: Record<string, string>;
  timeoutMs?: number;
}

export interface DockerRunOptions {
  imageTag: string;
  containerName: string;
  hostPort: number;
  containerPort: number;
  /** Memory limit (e.g. '1g'). Optional. */
  memory?: string;
  /** CPU limit (e.g. '1'). Optional. */
  cpus?: string;
  /** Extra env vars. */
  env?: Record<string, string>;
}

export interface DockerComposeUpOptions {
  contextDir: string;
  /** Compose project name — uniquely scopes networks/volumes/containers per preview. */
  projectName: string;
  /** Extra compose override file contents (e.g. port remapping). Written to contextDir. */
  overrideContents?: string;
  timeoutMs?: number;
}

export interface DockerRunner {
  /** Returns true when `docker info` succeeds, otherwise false. */
  isAvailable(): Promise<boolean>;
  /** Build an image. Resolves with build log. */
  build(opts: DockerBuildOptions): Promise<{ ok: boolean; log: string }>;
  /** Run an image detached. Resolves with the container ID (long form). */
  run(opts: DockerRunOptions): Promise<{ ok: boolean; containerId: string | null; log: string }>;
  /** Best-effort stop + rm. Idempotent. */
  stop(containerId: string): Promise<void>;
  /** Read recent container logs (stdout+stderr). */
  logs(containerId: string, opts?: { tail?: number }): Promise<string>;
  /** Returns 'running' | 'exited' | 'missing'. */
  inspectState(containerId: string): Promise<'running' | 'exited' | 'missing'>;
  /**
   * Read forensic exit metadata for a container — invoked when the
   * preview manager has decided the container is no longer healthy and
   * wants to surface a faithful failure reason. The returned shape maps
   * onto PreviewRecord.exitInfo. Best-effort: missing/destroyed
   * containers resolve with all-null fields rather than rejecting.
   */
  inspectExit(containerId: string): Promise<{
    exitCode: number | null;
    oomKilled: boolean;
    error: string | null;
    finishedAt: string | null;
  }>;
  /** GET against http://127.0.0.1:hostPort{path} with a short timeout. */
  httpProbe(hostPort: number, path: string, timeoutMs: number): Promise<{ ok: boolean; status: number | null }>;
  /**
   * Wait until httpProbe returns ok=true OR budget elapses. Each
   * underlying probe attempt is captured as a structured
   * `ProbeAttempt` (timestamp / URL / connection result / status /
   * body sample / error code+message) and surfaced via the optional
   * `onProbe` callback so the PreviewManager can mirror the history
   * onto the persisted preview record. The final probe (just before
   * giving up, OR the first successful one) requests with GET so a
   * body sample is always available for the timeout dump.
   */
  awaitHealthy(
    hostPort: number,
    path: string,
    budgetMs: number,
    onProbe?: (attempt: ProbeAttempt) => void,
  ): Promise<{ ok: boolean; lastStatus: number | null }>;
  /** Bring up a docker compose stack scoped by projectName. Returns build/up log. */
  composeUp(opts: DockerComposeUpOptions): Promise<{ ok: boolean; log: string }>;
  /** Tear down a compose stack (containers + volumes). Idempotent. */
  composeDown(projectName: string, contextDir: string): Promise<void>;
  /** Tail logs from a single compose service. */
  composeLogs(projectName: string, contextDir: string, service: string, tail?: number): Promise<string>;
}

export function createDockerRunner(logger: Logger, dockerBin = 'docker'): DockerRunner {
  return {
    async isAvailable() {
      const r = await runOnce(dockerBin, ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 5_000, logger, label: 'docker-info' });
      return r.code === 0 && r.stdout.trim().length > 0;
    },

    async build(opts) {
      // Write Dockerfile + ensureFiles into contextDir, then docker build.
      const dockerfilePath = resolvePathWithinRoot(opts.contextDir, 'Dockerfile.preview').absolutePath;
      try {
        await writeFile(dockerfilePath, opts.dockerfileContents, 'utf8');
        if (opts.ensureFiles) {
          for (const [rel, contents] of Object.entries(opts.ensureFiles)) {
            const safePath = resolvePathWithinRoot(opts.contextDir, rel).absolutePath;
            await mkdir(dirname(safePath), { recursive: true });
            await writeFile(safePath, contents, 'utf8');
          }
        }
      } catch (err) {
        const pathErr = err as UnsafeProjectPathError;
        if (pathErr?.code === 'UNSAFE_PROJECT_PATH') {
          return {
            ok: false,
            log: `[runner] unsafe build-context path "${pathErr.inputPath}" (${pathErr.reason})`,
          };
        }
        return { ok: false, log: `[runner] failed to stage build context: ${(err as Error).message}` };
      }

      const args = [
        'build',
        '-f', dockerfilePath,
        '-t', opts.imageTag,
        '--progress', 'plain',
        '--quiet=false',
        opts.contextDir,
      ];
      logger.info('docker build starting', { imageTag: opts.imageTag });
      const r = await runOnce(dockerBin, args, { timeoutMs: opts.timeoutMs ?? 240_000, maxLogBytes: 200_000, logger, label: 'docker-build' });
      const ok = r.code === 0;
      logger.info('docker build finished', { imageTag: opts.imageTag, ok, code: r.code });
      return { ok, log: r.combined };
    },

    async run(opts) {
      // Idempotent: if a container with this name already exists (e.g. left
      // over from a previous API process crash / restart), remove it first.
      // `docker rm -f` is safe to call against missing containers — it returns
      // a non-zero exit code we ignore.
      await runOnce(dockerBin, ['rm', '-f', opts.containerName], { timeoutMs: 8_000, logger, label: 'docker-rm-pre' });

      // Detached, port-published, auto-removed on stop.
      const args: string[] = [
        'run',
        '-d',
        '--rm',
        '--name', opts.containerName,
        '-p', `${opts.hostPort}:${opts.containerPort}`,
      ];
      if (opts.memory) args.push('--memory', opts.memory);
      if (opts.cpus)   args.push('--cpus',   opts.cpus);
      for (const [k, v] of Object.entries(opts.env ?? {})) {
        args.push('-e', `${k}=${v}`);
      }
      args.push(opts.imageTag);

      const r = await runOnce(dockerBin, args, { timeoutMs: 30_000, logger, label: 'docker-run' });
      if (r.code !== 0) {
        return { ok: false, containerId: null, log: r.combined };
      }
      const id = r.stdout.trim().split(/\r?\n/).pop() ?? '';
      return { ok: id.length > 0, containerId: id || null, log: r.combined };
    },

    async stop(containerId) {
      // --time 2 = grace period before SIGKILL. Errors swallowed (idempotent).
      await runOnce(dockerBin, ['stop', '--time', '2', containerId], { timeoutMs: 10_000, logger, label: 'docker-stop' });
      // --rm at run time removes the container automatically; this is belt-and-braces.
      await runOnce(dockerBin, ['rm', '-f', containerId], { timeoutMs: 5_000, logger, label: 'docker-rm' });
    },

    async logs(containerId, opts) {
      const tail = opts?.tail ?? 200;
      const r = await runOnce(dockerBin, ['logs', '--tail', String(tail), containerId], { timeoutMs: 5_000, logger, label: 'docker-logs' });
      return r.combined;
    },

    async inspectState(containerId) {
      const r = await runOnce(dockerBin, ['inspect', '-f', '{{.State.Status}}', containerId], { timeoutMs: 5_000, logger, label: 'docker-inspect' });
      if (r.code !== 0) return 'missing';
      const status = r.stdout.trim();
      if (status === 'running') return 'running';
      if (status.length > 0)    return 'exited';
      return 'missing';
    },

    async inspectExit(containerId) {
      // We pipe through a delimited template so a single `docker inspect`
      // call yields all four fields. JSON-formatted output would be
      // cleaner but adds parsing failure modes; the pipe-delimited form
      // is robust because none of the underlying values can legally
      // contain a `|` (ExitCode = number, OOMKilled = bool, Error =
      // single line, FinishedAt = ISO timestamp).
      const fmt = '{{.State.ExitCode}}|{{.State.OOMKilled}}|{{.State.Error}}|{{.State.FinishedAt}}';
      const r = await runOnce(dockerBin, ['inspect', '-f', fmt, containerId], { timeoutMs: 5_000, logger, label: 'docker-inspect-exit' });
      if (r.code !== 0) {
        return { exitCode: null, oomKilled: false, error: null, finishedAt: null };
      }
      const raw = r.stdout.trim();
      const parts = raw.split('|');
      const exitCodeStr = parts[0] ?? '';
      const oomStr = parts[1] ?? 'false';
      const errStr = parts[2] ?? '';
      const finStr = parts[3] ?? '';
      const exitCode = exitCodeStr === '' || Number.isNaN(Number(exitCodeStr)) ? null : Number(exitCodeStr);
      return {
        exitCode,
        oomKilled: oomStr.trim().toLowerCase() === 'true',
        error: errStr.trim().length > 0 ? errStr.trim() : null,
        finishedAt: finStr.trim().length > 0 && finStr.trim() !== '0001-01-01T00:00:00Z' ? finStr.trim() : null,
      };
    },

    httpProbe(hostPort, path, timeoutMs) {
      return new Promise((resolve) => {
        const req = httpRequest({
          host: '127.0.0.1',
          port: hostPort,
          path,
          method: 'GET',
          timeout: timeoutMs,
          headers: { 'User-Agent': 'devteam-preview-probe/1.0' },
        }, (res) => {
          // Drain quickly; we only care about the status.
          res.resume();
          // Treat 200-499 as "the server is responding". 5xx still counts as alive
          // because some Next dev pages return 500 momentarily during compile, but
          // we'd rather wait for a clean 2xx/3xx, so only those count as ok.
          const code = res.statusCode ?? 0;
          resolve({ ok: code >= 200 && code < 400, status: code });
        });
        req.on('error', () => resolve({ ok: false, status: null }));
        req.on('timeout', () => { req.destroy(); resolve({ ok: false, status: null }); });
        req.end();
      });
    },

    async awaitHealthy(hostPort, path, budgetMs, onProbe) {
      const deadline = Date.now() + budgetMs;
      let lastStatus: number | null = null;
      let attemptIdx = 0;
      // First few seconds: probe quickly. Then back off to once per 2s.
      let delay = 500;
      while (Date.now() < deadline) {
        // Capture body on the FIRST attempt and every 4th attempt
        // thereafter so the probe history always has at least one
        // bodySample for the timeout dump.
        const captureBody = attemptIdx === 0 || attemptIdx % 4 === 0;
        const attempt = await recordProbe({
          host: '127.0.0.1', port: hostPort, path,
          timeoutMs: 3_000,
          captureBody,
        });
        attemptIdx++;
        lastStatus = attempt.status;
        try { onProbe?.(attempt); } catch { /* mirror callbacks must never abort boot */ }
        if (attempt.ok) return { ok: true, lastStatus };
        await new Promise((r) => setTimeout(r, delay));
        if (delay < 2_000) delay = Math.min(delay * 1.5, 2_000);
      }
      return { ok: false, lastStatus };
    },

    async composeUp(opts) {
      // Stage override file, if provided.
      const overridePath = resolvePathWithinRoot(opts.contextDir, 'docker-compose.preview.override.yml').absolutePath;
      try {
        if (opts.overrideContents) {
          await writeFile(overridePath, opts.overrideContents, 'utf8');
        }
      } catch (err) {
        return { ok: false, log: `[runner] failed to stage compose override: ${(err as Error).message}` };
      }
      const args = [
        'compose',
        '-p', opts.projectName,
        '-f', 'docker-compose.yml',
      ];
      if (opts.overrideContents) {
        args.push('-f', 'docker-compose.preview.override.yml');
      }
      args.push('up', '-d', '--build', '--remove-orphans');

      logger.info('docker compose up starting', { projectName: opts.projectName });
      const r = await runOnce(dockerBin, args, {
        cwd: opts.contextDir,
        timeoutMs: opts.timeoutMs ?? 480_000,
        maxLogBytes: 200_000,
        logger,
        label: 'docker-compose-up',
      });
      const ok = r.code === 0;
      logger.info('docker compose up finished', { projectName: opts.projectName, ok, code: r.code });
      return { ok, log: r.combined };
    },

    async composeDown(projectName, contextDir) {
      // -v removes named volumes (postgres data) so subsequent runs start clean.
      await runOnce(dockerBin, ['compose', '-p', projectName, 'down', '-v', '--remove-orphans'], {
        cwd: contextDir,
        timeoutMs: 30_000,
        logger,
        label: 'docker-compose-down',
      });
    },

    async composeLogs(projectName, contextDir, service, tail = 200) {
      const r = await runOnce(
        dockerBin,
        ['compose', '-p', projectName, 'logs', '--tail', String(tail), '--no-color', service],
        { cwd: contextDir, timeoutMs: 8_000, logger, label: 'docker-compose-logs' },
      );
      return r.combined;
    },
  };
}
