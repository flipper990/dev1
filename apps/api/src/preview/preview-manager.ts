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
import type { PreviewRecord, PreviewStatus, StackInfo } from './types.js';
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
  private readonly opts: Required<Omit<PreviewManagerOptions, 'projectStore' | 'docker' | 'ports' | 'logger'>> &
    Pick<PreviewManagerOptions, 'projectStore' | 'docker' | 'ports' | 'logger'>;
  private cleanupTimer: NodeJS.Timeout | null = null;
  private dockerAvailable: boolean | null = null;

  constructor(o: PreviewManagerOptions) {
    this.opts = {
      projectStore: o.projectStore,
      docker: o.docker,
      ports: o.ports,
      logger: o.logger,
      maxConcurrent: o.maxConcurrent ?? 3,
      idleTtlMs: o.idleTtlMs ?? 10 * 60_000,
      buildTimeoutMs: o.buildTimeoutMs ?? 300_000,
    };
  }

  /** Should be called once at startup. */
  async init(): Promise<void> {
    this.dockerAvailable = await this.opts.docker.isAvailable();
    if (this.dockerAvailable) {
      this.opts.logger.info('Preview manager initialised (Docker available)');
    } else {
      this.opts.logger.warn('Preview manager initialised but Docker is NOT available — preview/start calls will fail');
    }
    // Sweep idle containers periodically.
    this.cleanupTimer = setInterval(() => { void this.sweepIdle(); }, 60_000);
  }

  isDockerAvailable(): boolean {
    return this.dockerAvailable === true;
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
   * Start (or return existing) preview container for the given project.
   * Concurrent calls share one start promise.
   */
  async start(projectId: string): Promise<PreviewStatus> {
    if (!this.dockerAvailable) {
      throw new Error('Docker is not available on this host. Start Docker Desktop and retry.');
    }

    // Already running and healthy → return immediately.
    const existing = this.records.get(projectId);
    if (existing && (existing.state === 'ready' || existing.state === 'starting' || existing.state === 'building')) {
      existing.lastAccessedAt = Date.now();
      // If state is ready but the container actually died, fall through to restart.
      if (existing.state === 'ready' && existing.containerId) {
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

    const promise = this.doStart(projectId);
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
    rec.state = 'stopped';
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
    };
  }

  private async doStart(projectId: string): Promise<PreviewStatus> {
    const contextDir = this.opts.projectStore.getOutputDir(projectId);

    // Evict if over capacity.
    await this.evictIfFull();

    const record: PreviewRecord = {
      projectId,
      state: 'detecting',
      stack: null,
      imageTag: null,
      containerId: null,
      hostPort: null,
      startedAt: Date.now(),
      lastAccessedAt: Date.now(),
      error: null,
      log: '',
    };
    this.records.set(projectId, record);

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
    record.state = 'building';
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
      return this.fail(record, 'Docker build failed — see log');
    }

    // 3. Run
    record.state = 'starting';
    const hostPort = await this.opts.ports.allocate();
    record.hostPort = hostPort;
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

    // 4. Health check
    const budget = bootBudgetMs(stack.kind);
    const healthy = await this.opts.docker.awaitHealthy(hostPort, stack.healthPath, budget);
    if (!healthy.ok) {
      // Append container logs to help diagnose.
      const tail = await this.opts.docker.logs(run.containerId).catch(() => '');
      record.log = `${record.log}\n\n=== container logs (tail) ===\n${tail}`;
      return this.fail(record, `Dev server did not become healthy within ${budget}ms (last status: ${healthy.lastStatus ?? 'no response'})`);
    }

    record.state = 'ready';
    record.lastAccessedAt = Date.now();
    this.opts.logger.info('Preview ready', { projectId, hostPort, stack: stack.kind });
    return this.toStatus(record);
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
    record.state = 'building';

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
      return this.fail(record, 'docker compose up failed — see log');
    }

    // Health-check loop: web first (the iframe target). If web becomes
    // healthy, return ready. We also probe the api separately and surface
    // its log tail when web is up but api is down — so the QA auto-fix loop
    // can pick up the failure as runtimeFeedback.
    record.state = 'starting';
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

    // Verify api too — non-fatal if down, but include in log so the runtime
    // validator + auto-fix loop can drive QA to fix it.
    const apiProbe = await this.opts.docker.httpProbe(apiHostPort, '/health', 4_000);
    if (!apiProbe.ok) {
      const apiLog = await this.opts.docker.composeLogs(composeProject, contextDir, 'api', 200).catch(() => '');
      record.log = `${record.log}\n\n=== api /health probe failed (status: ${apiProbe.status ?? 'no response'}) ===\n${apiLog}`;
      this.opts.logger.warn('Fullstack preview: web up but api unhealthy', { projectId, apiHostPort });
    }

    record.state = 'ready';
    record.lastAccessedAt = Date.now();
    this.opts.logger.info('Fullstack preview ready', {
      projectId, webHostPort, apiHostPort, composeProject, apiHealthy: apiProbe.ok,
    });
    return this.toStatus(record);
  }

  private fail(record: PreviewRecord, message: string): PreviewStatus {
    record.state = 'failed';
    record.error = message;
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
