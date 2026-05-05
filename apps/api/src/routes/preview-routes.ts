// ─────────────────────────────────────────────────────────────
// Preview routes
//
//   POST /api/projects/:id/preview/start   — start container, wait for health
//   POST /api/projects/:id/preview/stop    — stop container
//   GET  /api/projects/:id/preview/status  — current state for UI polling
//   ALL  /preview/:id/*                    — reverse proxy → container
//
// The reverse proxy is intentionally simple Node http: it forwards method,
// headers, body, and stream-pipes the response back. Per-request, we
// "touch" the manager so the idle TTL resets while the user is using it.
// ─────────────────────────────────────────────────────────────

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { request as httpRequest } from 'node:http';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { PreviewManager } from '../preview/preview-manager.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { ProjectUpdater } from '../pipeline/project-updater.js';
import { validateAndAutoFix } from '../pipeline/auto-fix.js';

export interface PreviewRoutesDeps {
  preview: PreviewManager;
  projectStore: ProjectStore;
  updater: ProjectUpdater;
  apiBaseUrl: string;
  logger: Logger;
}

const PROJECT_ID_RE = /^[A-Za-z0-9_-]{8,32}$/;

export function registerPreviewRoutes(app: FastifyInstance, deps: PreviewRoutesDeps): void {
  const { preview, projectStore, updater, apiBaseUrl, logger } = deps;

  // ── REST control plane ───────────────────────────────────

  app.post('/api/projects/:id/preview/start', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    req.log.info({ event: 'route:preview:start', projectId: id, reqId: req.id }, '[route:preview:start] request received');
    if (!PROJECT_ID_RE.test(id)) return reply.status(400).send({ error: 'Invalid project id' });
    const exists = await projectStore.get(id);
    if (!exists) return reply.status(404).send({ error: 'Project not found' });

    // ── No backend at all ──
    // Only short-circuit when neither Docker nor the local runner is
    // available. Otherwise let preview.start() pick the best available
    // backend (Docker first, then local-runner fallback).
    if (!preview.isAnyAvailable()) {
      return reply.status(200).send({
        projectId: id,
        state: 'fallback',
        stack: null,
        url: null,
        hostPort: null,
        error: null,
        log: '',
        uptimeMs: 0,
        fallback: true,
        fallbackReason: 'docker-unavailable',
        notice: 'Full preview unavailable, showing frontend only',
        hint: 'Install / start Docker Desktop or ensure Node.js is on PATH to enable the live preview.',
      });
    }

    try {
      const status = await preview.start(id);
      const code = status.state === 'ready' ? 200 : 502;
      return reply.status(code).send(status);
    } catch (err) {
      logger.error('preview/start failed', { projectId: id, err: String(err) });
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  app.post('/api/projects/:id/preview/stop', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    req.log.info({ event: 'route:preview:stop', projectId: id, reqId: req.id }, '[route:preview:stop] request received');
    if (!PROJECT_ID_RE.test(id)) return reply.status(400).send({ error: 'Invalid project id' });
    await preview.stop(id);
    return reply.status(200).send({ stopped: true });
  });

  app.get('/api/projects/:id/preview/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    // status is high-frequency-polled; log at debug level to avoid spam.
    req.log.debug({ event: 'route:preview:status', projectId: id, reqId: req.id }, '[route:preview:status] poll');
    if (!PROJECT_ID_RE.test(id)) return reply.status(400).send({ error: 'Invalid project id' });
    const status = preview.getStatus(id);
    if (!status) {
      // No record yet. If NO backend is available at all, surface the fallback
      // signal so polling clients can render the static preview without first
      // hitting /start. Otherwise return idle (start will pick docker or local).
      if (!preview.isAnyAvailable()) {
        return reply.status(200).send({
          projectId: id,
          state: 'fallback',
          stack: null,
          url: null,
          hostPort: null,
          error: null,
          log: '',
          uptimeMs: 0,
          fallback: true,
          fallbackReason: 'docker-unavailable',
          notice: 'Full preview unavailable, showing frontend only',
        });
      }
      return reply.status(200).send({
        projectId: id,
        state: 'idle',
        stack: null,
        url: null,
        hostPort: null,
        error: null,
        log: '',
        uptimeMs: 0,
      });
    }
    return reply.status(200).send(status);
  });

  app.post('/api/projects/:id/preview/iframe-ready', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!PROJECT_ID_RE.test(id)) return reply.status(400).send({ error: 'Invalid project id' });
    const body = (req.body ?? {}) as { url?: string; viewport?: string; loadDurationMs?: number };
    preview.reportIframeReady(id, {
      url: typeof body.url === 'string' ? body.url.slice(0, 500) : undefined,
      viewport: typeof body.viewport === 'string' ? body.viewport.slice(0, 32) : undefined,
      loadDurationMs: typeof body.loadDurationMs === 'number' && Number.isFinite(body.loadDurationMs)
        ? body.loadDurationMs : undefined,
    });
    return reply.status(204).send();
  });

  app.get('/api/preview/health', async () => ({
    dockerAvailable: preview.isDockerAvailable(),
    localAvailable: preview.isLocalAvailable(),
    anyAvailable: preview.isAnyAvailable(),
    running: preview.listAll(),
  }));

  // Validate the running preview and (optionally) trigger auto-fix iterations
  // when validation fails.
  //
  //   POST /api/projects/:id/preview/validate
  //   body: { autoFix?: boolean (default true), maxIterations?: number (1-3) }
  //
  // This is synchronous and can take several minutes when auto-fix kicks in,
  // because each fix iteration runs the full agent pipeline. Callers that
  // want progress should subscribe to the WebSocket for updater session
  // events as usual.
  app.post('/api/projects/:id/preview/validate', async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = req.params as { id: string };
    if (!PROJECT_ID_RE.test(id)) return reply.status(400).send({ error: 'Invalid project id' });
    if (!preview.isDockerAvailable()) {
      return reply.status(503).send({ error: 'Docker not available', code: 'DOCKER_UNAVAILABLE' });
    }
    const exists = await projectStore.get(id);
    if (!exists) return reply.status(404).send({ error: 'Project not found' });

    const body = (req.body ?? {}) as { autoFix?: boolean; maxIterations?: number };
    const autoFix = body.autoFix !== false;
    const maxIterations = Math.min(Math.max(body.maxIterations ?? 2, 0), 3);

    try {
      const summary = await validateAndAutoFix(id, {
        previewManager: preview,
        updater,
        apiBaseUrl,
        logger,
        spec: exists.spec,
      }, { maxIterations: autoFix ? maxIterations : 0 });
      return reply.status(summary.finalVerdict === 'pass' ? 200 : 422).send(summary);
    } catch (err) {
      logger.error('preview/validate failed', { projectId: id, err: String(err) });
      return reply.status(500).send({ error: (err as Error).message });
    }
  });

  // ── Reverse proxy ────────────────────────────────────────
  // Match any method, any sub-path under /preview/:id/*

  app.route({
    method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'],
    url: '/preview/:id/*',
    handler: (req, reply) => proxyHandler(req, reply, preview, logger),
  });
  // Also handle the "no trailing slash" form by redirecting to the slash form
  // so relative asset URLs in the iframe resolve correctly.
  app.route({
    method: ['GET'],
    url: '/preview/:id',
    handler: (req, reply) => {
      const { id } = req.params as { id: string };
      reply.redirect(`/preview/${id}/`, 308);
    },
  });
}

/* ── Reverse proxy implementation ──────────────────────────── */

function proxyHandler(
  req: FastifyRequest,
  reply: FastifyReply,
  preview: PreviewManager,
  logger: Logger,
): void {
  const params = req.params as { id: string; '*'?: string };
  const id = params.id;
  if (!PROJECT_ID_RE.test(id)) {
    void reply.status(400).send({ error: 'Invalid project id' });
    return;
  }
  const status = preview.getStatus(id);
  if (!status || status.state !== 'ready' || status.hostPort == null) {
    void reply.status(503).send({
      error: 'Preview not running',
      hint: 'POST /api/projects/:id/preview/start first',
      state: status?.state ?? 'idle',
    });
    return;
  }
  preview.touch(id);

  // Strip the /preview/:id prefix so the upstream sees the original path.
  const tail = params['*'] ?? '';
  const queryStr = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';
  const upstreamPath = `/${tail}${queryStr}`;

  // Filter out hop-by-hop and host headers — the upstream will set its own.
  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (v == null) continue;
    const key = k.toLowerCase();
    if (HOP_BY_HOP.has(key) || key === 'host') continue;
    headers[k] = Array.isArray(v) ? v.join(',') : String(v);
  }

  const upstream = httpRequest({
    host: '127.0.0.1',
    port: status.hostPort,
    path: upstreamPath,
    method: req.method,
    headers,
    timeout: 30_000,
  }, (upRes) => {
    // Forward status + headers (skipping hop-by-hop).
    const outHeaders: Record<string, string | string[]> = {};
    for (const [k, v] of Object.entries(upRes.headers)) {
      if (v == null) continue;
      if (HOP_BY_HOP.has(k.toLowerCase())) continue;
      outHeaders[k] = v;
    }
    void reply.status(upRes.statusCode ?? 502).headers(outHeaders).send(upRes);
  });

  upstream.on('error', (err) => {
    logger.warn('preview proxy upstream error', { projectId: id, err: err.message });
    if (!reply.sent) {
      void reply.status(502).send({ error: 'Upstream preview server error', detail: err.message });
    }
  });
  upstream.on('timeout', () => {
    upstream.destroy();
    if (!reply.sent) {
      void reply.status(504).send({ error: 'Upstream preview server timeout' });
    }
  });

  // Pipe request body for non-GET methods. Fastify exposes the raw IncomingMessage.
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    upstream.end();
  } else {
    req.raw.pipe(upstream);
  }
}

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);
