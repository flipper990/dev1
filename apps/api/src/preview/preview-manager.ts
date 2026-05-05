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
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { DockerRunner } from './docker-runner.js';
import type { PortAllocator } from './port-allocator.js';
import type { LocalPreviewRunner } from './local-runner.js';
import type { PreviewRecord, PreviewState, PreviewStatus, PreviewTimelineEvent, PreviewTimelineEventName, StackInfo } from './types.js';
import { detectStack, isRunnableStack } from './stack-detector.js';
import { getDockerfile, bootBudgetMs } from './dev-dockerfiles.js';

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
    record.state = nextState;
    record.lastMeaningfulStep = step;
    if (nextState === 'ready' && !record.readyAtIso) record.readyAtIso = at;
    if (!record.startedAtIso) record.startedAtIso = new Date(record.startedAt).toISOString();
    record.history = record.history ?? [];
    record.history.push({ step: `${nextState}:${step}`, at });
    if (record.history.length > 32) record.history = record.history.slice(-32);
    this.opts.logger.info('preview:step', {
      projectId: record.projectId, state: nextState, step,
      llmCalled: false, // placeholder so log shape is consistent across systems
    });

    // Mirror onto ProjectRecord.preview so polling clients of GET
    // /api/projects/:id can drive UI off a single source of truth without
    // having to fan-out a second request to /preview/status. Decoupled
    // from project.status (which stays generation-only). Best-effort:
    // failures are non-fatal — preview lifecycle continues either way.
    void this.syncPreviewToProject(record).catch((err) => {
      this.opts.logger.warn('syncPreviewToProject failed', {
        projectId: record.projectId, error: (err as Error).message,
      });
    });
  }

  /** Translate internal PreviewState → public previewStatus vocabulary. */
  private toPublicPreviewStatus(
    state: PreviewState,
  ): NonNullable<NonNullable<Awaited<ReturnType<ProjectStore['get']>>>['preview']>['previewStatus'] {
    switch (state) {
      case 'ready':      return 'ready';
      case 'failed':     return 'failed';
      case 'starting':   return 'starting';
      case 'building':   return 'building';
      case 'installing': return 'installing';
      case 'detecting':
      case 'preparing':  return 'preparing';
      case 'idle':
      case 'stopped':
      case 'fallback':
      default:           return 'idle';
    }
  }

  private async syncPreviewToProject(record: PreviewRecord): Promise<void> {
    const previewStatus = this.toPublicPreviewStatus(record.state);
    const url = record.state === 'ready' && record.hostPort != null
      ? `/preview/${record.projectId}/`
      : null;
    await this.opts.projectStore.updatePreview(record.projectId, {
      previewStatus,
      previewReady: previewStatus === 'ready',
      previewUrl: url,
      previewStartedAt: record.startedAtIso ?? null,
      previewReadyAt: record.readyAtIso ?? null,
      previewError: record.error ?? null,
      timeline: record.timeline,
    });
  }

  /** Tail-truncate a string to `max` chars, keeping the trailing portion. */
  private static tail(s: string | undefined | null, max = 2_000): string | undefined {
    if (!s) return undefined;
    return s.length <= max ? s : s.slice(-max);
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
      previewStatus: this.toPublicPreviewStatus(record.state),
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
      if (existing.state === 'ready' && existing.mode === 'local') {
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

    const promise = this.dockerAvailable
      ? this.doStart(projectId)
      : this.doStartLocal(projectId);
    this.starting.set(projectId, promise);
    try {
      return await promise;
    } finally {
      this.starting.delete(projectId);
    }
  }

  /** Stop and remove the container; releases its port. Idempotent. */
  async stop(projectId: string): Promise<void> {
    const rec = this.records.get(projectId);
    if (!rec) return;
    // Local runner: kill the dev process.
    if (rec.mode === 'local') {
      await this.opts.localRunner?.stop(projectId).catch(() => {});
      // localRunner releases its own allocated port internally.
      this.markPreviewStep(rec, 'stopped', 'local-runner stopped');
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
    return {
      projectId: rec.projectId,
      state: rec.state,
      stack: rec.stack?.kind ?? null,
      url: rec.state === 'ready' && rec.hostPort != null
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
    };
  }

  private async doStart(projectId: string): Promise<PreviewStatus> {
    const contextDir = this.opts.projectStore.getOutputDir(projectId);

    // Evict if over capacity.
    await this.evictIfFull();

    const startTs = Date.now();
    const record: PreviewRecord = {
      projectId,
      state: 'detecting',
      stack: null,
      imageTag: null,
      containerId: null,
      hostPort: null,
      startedAt: startTs,
      lastAccessedAt: startTs,
      error: null,
      log: '',
      startedAtIso: new Date(startTs).toISOString(),
      readyAtIso: null,
      lastMeaningfulStep: 'detecting stack',
      history: [{ step: 'detecting:start', at: new Date(startTs).toISOString() }],
    };
    this.records.set(projectId, record);

    // Initial mirror onto ProjectRecord.preview ('preparing'). Lets
    // polling clients show "Preview starting…" the instant generation
    // completes, even before docker build kicks in.
    void this.syncPreviewToProject(record).catch(() => {});
    this.recordTimelineEvent(record, 'runner-start', {
      details: { mode: 'docker', contextDir },
    });

    // 1. Detect stack
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

    // 2. Build
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
      return this.fail(record, 'Docker build failed — see log');
    }
    this.recordTimelineEvent(record, 'build-end', {
      details: { ok: true, imageTag },
      stdout: build.log,
    });

    // 3. Run
    this.markPreviewStep(record, 'starting', 'docker run + health probe');
    const hostPort = await this.opts.ports.allocate();
    record.hostPort = hostPort;
    this.recordTimelineEvent(record, 'port-assigned', {
      details: { hostPort, containerPort: stack.port },
    });
    const containerName = `devteam-preview-${projectId.toLowerCase()}`;
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
      return this.fail(record, 'Docker run failed — see log');
    }
    record.containerId = run.containerId;
    this.recordTimelineEvent(record, 'devserver-start', {
      details: { containerId: run.containerId, containerName, hostPort },
      stdout: run.log,
    });

    // 4. Health check
    const budget = bootBudgetMs(stack.kind);
    const healthy = await this.opts.docker.awaitHealthy(hostPort, stack.healthPath, budget);
    if (!healthy.ok) {
      // Append container logs to help diagnose.
      const tail = await this.opts.docker.logs(run.containerId).catch(() => '');
      record.log = `${record.log}\n\n=== container logs (tail) ===\n${tail}`;
      return this.fail(record, `Dev server did not become healthy within ${budget}ms (last status: ${healthy.lastStatus ?? 'no response'})`);
    }
    this.recordTimelineEvent(record, 'http-probe-ok', {
      details: { hostPort, healthPath: stack.healthPath, lastStatus: healthy.lastStatus ?? null },
    });

    this.markPreviewStep(record, 'ready', `dev server healthy on :${record.hostPort}`);
    this.recordTimelineEvent(record, 'url-published', {
      details: { url: `/preview/${projectId}/`, hostPort, stack: stack.kind },
    });
    record.lastAccessedAt = Date.now();
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
  private async doStartLocal(projectId: string): Promise<PreviewStatus> {
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
    const record: PreviewRecord = {
      projectId,
      state: 'starting',
      stack: null,
      imageTag: null,
      containerId: null,
      hostPort: null,
      startedAt: startTs,
      lastAccessedAt: startTs,
      error: null,
      log: '',
      mode: 'local',
      startedAtIso: new Date(startTs).toISOString(),
      readyAtIso: null,
      lastMeaningfulStep: 'local runner starting',
      history: [{ step: 'starting:local-runner', at: new Date(startTs).toISOString() }],
    };
    this.records.set(projectId, record);

    // Initial mirror onto ProjectRecord.preview. Local runner goes
    // straight to 'installing' (npm install) before flipping to 'ready'.
    void this.syncPreviewToProject(record).catch(() => {});
    this.recordTimelineEvent(record, 'runner-start', {
      details: { mode: 'local', fileCount: project.files.length },
    });
    this.recordTimelineEvent(record, 'install-start', {
      details: { mode: 'local' },
    });

    try {
      const lr = await this.opts.localRunner.start(
        projectId,
        project.files.map((f) => ({ path: f.path, contents: f.contents })),
      );
      record.stack = lr.stack;
      record.hostPort = lr.port;
      record.log = lr.log;
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
      this.markPreviewStep(record, 'ready', `local dev server on :${lr.port}`);
      this.recordTimelineEvent(record, 'url-published', {
        details: { url: `/preview/${projectId}/`, hostPort: lr.port, mode: 'local', stack: lr.stack.kind },
      });
      record.lastAccessedAt = Date.now();
      this.opts.logger.info('Local preview ready', {
        projectId, hostPort: lr.port, stack: lr.stack.kind,
      });
      return this.toStatus(record);
    } catch (err) {
      const msg = (err as Error).message;
      const lr = this.opts.localRunner.get(projectId);
      if (lr?.log) record.log = lr.log;
      this.recordTimelineEvent(record, 'install-end', {
        details: { ok: false, error: msg },
        stderr: lr?.log,
      });
      return this.fail(record, `Local preview failed: ${msg}`);
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
      return this.fail(record, 'docker compose up failed — see log');
    }
    this.recordTimelineEvent(record, 'build-end', {
      details: { ok: true, composeProject }, stdout: up.log,
    });

    // Health-check loop: web first (the iframe target). If web becomes
    // healthy, return ready. We also probe the api separately and surface
    // its log tail when web is up but api is down — so the QA auto-fix loop
    // can pick up the failure as runtimeFeedback.
    this.markPreviewStep(record, 'starting', 'compose up — awaiting web health');
    this.recordTimelineEvent(record, 'devserver-start', {
      details: { webHostPort, apiHostPort, composeProject },
    });
    const budget = bootBudgetMs('fullstack');
    const webHealthy = await this.opts.docker.awaitHealthy(webHostPort, '/', budget);
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
      return this.fail(record, `web service did not become healthy within ${budget}ms (last status: ${webHealthy.lastStatus ?? 'no response'})`);
    }
    this.recordTimelineEvent(record, 'http-probe-ok', {
      details: { hostPort: webHostPort, healthPath: '/', lastStatus: webHealthy.lastStatus ?? null, service: 'web' },
    });

    // Verify api too — non-fatal if down, but include in log so the runtime
    // validator + auto-fix loop can drive QA to fix it.
    const apiProbe = await this.opts.docker.httpProbe(apiHostPort, '/health', 4_000);
    if (!apiProbe.ok) {
      const apiLog = await this.opts.docker.composeLogs(composeProject, contextDir, 'api', 200).catch(() => '');
      record.log = `${record.log}\n\n=== api /health probe failed (status: ${apiProbe.status ?? 'no response'}) ===\n${apiLog}`;
      this.opts.logger.warn('Fullstack preview: web up but api unhealthy', { projectId, apiHostPort });
    }

    this.markPreviewStep(record, 'ready', `fullstack web=:${record.hostPort} api=:${record.apiHostPort}`);
    this.recordTimelineEvent(record, 'url-published', {
      details: {
        url: `/preview/${projectId}/`,
        webHostPort, apiHostPort, composeProject,
        apiHealthy: apiProbe.ok,
      },
    });
    record.lastAccessedAt = Date.now();
    this.opts.logger.info('Fullstack preview ready', {
      projectId, webHostPort, apiHostPort, composeProject, apiHealthy: apiProbe.ok,
    });
    return this.toStatus(record);
  }

  private fail(record: PreviewRecord, message: string): PreviewStatus {
    this.markPreviewStep(record, 'failed', message.slice(0, 200));
    record.error = message;
    this.recordTimelineEvent(record, 'failed', {
      details: { message },
      stderr: record.log,
    });
    this.opts.logger.warn('Preview failed', { projectId: record.projectId, message });
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
    return this.toStatus(record);
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
