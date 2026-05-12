// API Routes — REST endpoints for project generation.
// LLM routes live in ./llm-routes.ts; versioning routes in ./version-routes.ts.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import archiver from 'archiver';
import { z } from 'zod';
import type { ProjectGenerator } from '../pipeline/project-generator.js';
import type { ProjectStore } from '../storage/project-store.js';
import { ProjectRecordCorruptError } from '../storage/project-store.js';
import type { SessionManager } from '../pipeline/session-manager.js';
import type { FileMemoryStore } from '../storage/memory-store.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { SmartLLMRouter } from '../llm/smart-router.js';
import type { PreviewManager } from '../preview/preview-manager.js';
import { config } from '../config.js';
import { registerLLMRoutes } from './llm-routes.js';
import { registerVersionRoutes } from './version-routes.js';
import {
  getActiveGenerations,
  getHeartbeat,
  getLastUnhandledError,
} from '../crash-logger.js';
import type { createAuthGuards } from '../security/auth.js';
import { getAuthPrincipal, withOwnership } from '../security/auth.js';
import { toSafeArchiveEntryPath, UnsafeProjectPathError } from '../security/safe-path.js';

const GenerateSchema = z.object({
  prompts: z.array(z.string().min(10).max(5000)).min(1).max(3),
  userId: z.string().optional(),
  preferences: z.record(z.unknown()).optional(),
});

function safeArchivePath(filePath: string): string {
  return toSafeArchiveEntryPath(filePath);
}

function safeDownloadName(value: string): string {
  const normalized = value.replace(/[^a-z0-9-_]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return normalized || 'devteam-project';
}

export function registerRoutes(
  app: FastifyInstance,
  deps: {
    generator: ProjectGenerator;
    projectStore: ProjectStore;
    sessionManager: SessionManager;
    memoryStore: FileMemoryStore;
    llm: SmartLLMRouter;
    logger: Logger;
    /** Optional: enables preview-job listing in /debug/runtime. */
    preview?: PreviewManager;
    auth: ReturnType<typeof createAuthGuards>;
  },
): void {
  const { generator, projectStore, sessionManager, memoryStore, llm, preview, auth } = deps;

  app.get('/health', async () => {
    const hb = getHeartbeat();
    // Count "active" projects as those currently in 'generating'.
    let activeProjectCount = 0;
    let activeProjectIds: string[] = [];
    try {
      const all = await projectStore.list();
      const generating = all.filter((p) => p.status === 'generating');
      activeProjectCount = generating.length;
      activeProjectIds = generating.map((p) => p.id).slice(0, 50);
    } catch {
      // Best-effort. /health must never throw.
    }
    const active = getActiveGenerations();
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      auth: {
        devBypassEnabled: config.isDev && config.auth.devBypass,
        devPrincipal: config.isDev && config.auth.devBypass
          ? {
            userId: config.auth.devUserId,
            email: config.auth.devUserEmail,
            workspaceId: config.auth.devWorkspaceId,
            role: config.auth.devRole,
          }
          : null,
      },
      pid: hb.pid,
      uptime: hb.uptimeSeconds,
      startedAt: hb.startedAt,
      firstStartedAt: hb.firstStartedAt,
      restartCounter: hb.restartCounter,
      lastBeatAt: hb.lastBeatAt,
      beatCount: hb.beatCount,
      watchMode: hb.watchMode,
      reloadedFromPid: hb.reloadedFromPid,
      activeProjectCount,
      activeProjectIds,
      activeGenerationIds: active.map((g) => g.sessionId).filter((s): s is string => !!s),
      activeGenerationCount: active.length,
    };
  });

  app.get('/debug/runtime', { preHandler: [auth.requireRole('admin')] }, async () => {
    const hb = getHeartbeat();
    const previews = preview
      ? preview.listAll().map((p) => ({
          projectId: p.projectId,
          state: p.state,
          stack: p.stack ?? null,
          url: p.url ?? null,
          uptimeMs: p.uptimeMs ?? 0,
        }))
      : [];
    return {
      pid: hb.pid,
      uptimeSeconds: hb.uptimeSeconds,
      startedAt: hb.startedAt,
      firstStartedAt: hb.firstStartedAt,
      restartCounter: hb.restartCounter,
      lastBeatAt: hb.lastBeatAt,
      beatCount: hb.beatCount,
      watchMode: hb.watchMode,
      reloadedFromPid: hb.reloadedFromPid,
      memoryUsage: hb.memoryUsage,
      lastUnhandledError: getLastUnhandledError(),
      activeGenerations: getActiveGenerations(),
      activePreviews: previews,
    };
  });

  const GenerateOrPromptSchema = z.union([
    GenerateSchema,
    z.object({
      prompt: z.string().min(1).max(5000),
      preferences: z.record(z.unknown()).optional(),
      scope: z.enum(['code', 'design', 'full']).optional(),
    }),
  ]);

  const handleGenerate = async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = getAuthPrincipal(request);
    request.log.info(
      { event: 'route:generate:received', reqId: request.id, bodyLen: JSON.stringify(request.body ?? {}).length },
      '[route:generate] request received',
    );
    const parsed = GenerateOrPromptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parsed.error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }
    const data = parsed.data as { prompt?: string; prompts?: string[]; preferences?: Record<string, unknown>; scope?: 'code' | 'design' | 'full' };
    const prompts = data.prompts ?? (data.prompt ? [data.prompt] : []);
    if (prompts.length === 0) {
      return reply.status(400).send({ error: 'At least one prompt is required' });
    }

    // Reserve IDs up-front so we can respond immediately and the WS client can
    // subscribe before the pipeline starts emitting events.
    const reservation = generator.reserve({
      prompts,
      userId: principal.userId,
      workspaceId: principal.workspaceId,
      preferences: data.preferences,
    });
    await projectStore.update(reservation.projectId, (project) => {
      const withMeta = withOwnership(project, principal);
      project.ownership = withMeta.ownership;
    }, {
      phase: 'auth:project-ownership-init',
      caller: 'routes:api:generate',
      reason: `set ownership from authenticated principal ${principal.userId}`,
    });
    request.log.info(
      { event: 'route:generate:reserved', projectId: reservation.projectId, sessionId: reservation.sessionId, promptCount: prompts.length },
      '[route:generate] project reserved \u2014 launching background runner',
    );

    // Kick off the pipeline in the background. Errors are surfaced to the
    // session/WS stream by the generator itself; we never want this promise
    // to crash the process. runReserved() is now responsible for marking
    // the placeholder as 'failed' on any error \u2014 we just log here.
    void generator.runReserved(reservation).catch((err) => {
      request.log.error(
        { err, projectId: reservation.projectId, sessionId: reservation.sessionId },
        '[route:generate] runReserved threw \u2014 should have been handled internally',
      );
    });

    return reply.status(202).send({
      projectId: reservation.projectId,
      sessionId: reservation.sessionId,
      project:  { id: reservation.projectId, name: reservation.projectName, status: 'generating', projectStatus: 'generating', verificationStatus: 'pending', previewHealthStatus: 'unknown', fileCount: 0, totalTokens: 0, totalCostUsd: 0, durationMs: 0 },
      pipeline: { sessionId: reservation.sessionId },
    });
  };

  app.post('/api/projects/generate', { preHandler: [auth.requireRole('member')] }, handleGenerate);
  app.post('/api/projects', { preHandler: [auth.requireRole('member')] }, handleGenerate);

  app.get('/api/projects/:id/diagnostics/pipeline-ledger', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const ledger = project.diagnostics?.pipelineLedger ?? null;
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');
    return {
      projectId: id,
      sessionId: project.sessionId,
      ledger,
      records: ledger?.records ?? [],
    };
  });

  app.get('/api/projects/:id/diagnostics', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');
    return {
      projectId: id,
      sessionId: project.sessionId,
      diagnostics: project.diagnostics ?? {},
      pipelineLedger: project.diagnostics?.pipelineLedger ?? null,
    };
  });

  app.get('/api/projects/:id/diagnostics/preview-validation-artifacts', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    const artifacts = (project.diagnostics?.previewValidationArtifacts ?? null) as Record<string, unknown> | null;
    reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
    reply.header('Pragma', 'no-cache');
    return {
      projectId: id,
      sessionId: project.sessionId,
      artifacts,
    };
  });

  app.get('/api/projects/:id', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    request.log.info(
      { event: 'route:get-project', projectId: id, reqId: request.id },
      '[route:get-project] lookup',
    );
    try {
      // Always read fresh from disk via projectStore.get(). The store
      // does NOT cache — every call enters the per-project lock and
      // re-reads project.json so we never observe an in-flight write.
      // Combined with PreviewManager's durability gate (await
      // record.pendingSync before returning ready/failed), any preview
      // transition that has been acknowledged to its caller MUST be
      // visible here.
      const project = request.project ?? await projectStore.get(id);
      if (!project) {
        request.log.info(
          { event: 'route:get-project:not-found', projectId: id, reqId: request.id },
          '[route:get-project] 404',
        );
        return reply.status(404).send({ error: 'Project not found' });
      }
      // Defensive normalisation of the preview block. The persisted
      // shape uses optional fields (`?:`) — when no preview has ever
      // been started they're `undefined`, which can render as
      // "missing" to a JSON consumer. Materialise the six contract
      // fields explicitly so every response carries them, even on a
      // freshly-generated project that hasn't been previewed yet.
      // This is the API surface contract for the dashboard.
      const p = project.preview ?? null;
      const previewBlock = {
        previewStatus: p?.previewStatus ?? 'idle',
        previewHealth: p?.previewHealth ?? (p?.previewStatus === 'ready' ? 'healthy' : 'unknown'),
        previewReady: p?.previewReady ?? false,
        previewUrl: p?.previewUrl ?? null,
        previewStartedAt: p?.previewStartedAt ?? null,
        previewReadyAt: p?.previewReadyAt ?? null,
        previewFailedAt: p?.previewFailedAt ?? null,
        previewError: p?.previewError ?? null,
        // Spread the original preview block last so any additional
        // forensic fields (probeAttempts, exitInfo, timeline, …) flow
        // through unchanged. The explicit-keys above only act as
        // defaults; if `p` provides a value, this `...p` overrides.
        ...(p ?? {}),
      };
      const responseBody = { ...project, preview: previewBlock };

      // Disable any intermediate caching. Preview state changes
      // multiple times per second during boot — no proxy or browser
      // cache layer should serve a stale snapshot. Belt-and-braces
      // alongside the frontend's `cache: 'no-store'` fetch option.
      reply.header('Cache-Control', 'no-store, no-cache, must-revalidate');
      reply.header('Pragma', 'no-cache');

      request.log.info(
        {
          event: 'route:get-project:served',
          projectId: id,
          reqId: request.id,
          projectStatus: project.status,
          previewStatus: previewBlock.previewStatus,
          previewUrl: previewBlock.previewUrl,
          previewReadyAt: previewBlock.previewReadyAt,
          stateVersion: project.stateVersion ?? null,
        },
        '[route:get-project] served',
      );
      return responseBody;
    } catch (err) {
      if (err instanceof ProjectRecordCorruptError) {
        request.log.error(
          {
            event: 'route:get-project:corrupt',
            projectId: id,
            reqId: request.id,
            recovery: err.recovery,
            quarantinePath: err.quarantinePath,
            err: err.message,
          },
          '[route:get-project] project record corrupt — returning 500 with structured payload',
        );
        return reply.status(500).send({
          error: 'Project record is corrupt',
          code: err.code,
          projectId: err.projectId,
          corruption: true,
          recovery: err.recovery, // 'unavailable' | 'failed'
          recovered: false,
          quarantinePath: err.quarantinePath,
          message: err.message,
        });
      }
      request.log.error(
        { event: 'route:get-project:error', projectId: id, reqId: request.id, err: (err as Error).message, stack: (err as Error).stack },
        '[route:get-project] threw — returning 500 instead of crashing the process',
      );
      return reply.status(500).send({ error: 'Internal Error', code: 'GET_PROJECT_FAILED', projectId: id, message: (err as Error).message });
    }
  });

  app.get('/api/projects', async (request) => {
    const principal = getAuthPrincipal(request);
    const projects = await projectStore.list();
    return projects.filter((project) => auth.canAccessProject(principal, project));
  });

  app.get('/api/projects/:id/files', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return project.files.map(f => ({ path: f.path, size: f.content.length }));
  });

  app.get('/api/projects/:id/files/*', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = (request.params as Record<string, string>)['*'];
    const project = request.project ?? await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const file = project.files.find(f => f.path === filePath);
    if (!file) return reply.status(404).send({ error: 'File not found' });
    return { path: file.path, content: file.content };
  });

  app.get('/api/projects/:id/export', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    if (project.status !== 'generated') {
      return reply.status(409).send({ error: 'Export is available only after code generation completes (projectStatus=generated).' });
    }
    if (!project.files.length) {
      return reply.status(404).send({ error: 'Project has no source files to export' });
    }

    const exportEntries: Array<{ name: string; content: string }> = [];
    const unsafePaths: Array<{ path: string; reason: string }> = [];
    for (const file of project.files) {
      if (typeof file.content !== 'string') {
        unsafePaths.push({ path: file.path, reason: `invalid-content-type:${typeof file.content}` });
        continue;
      }
      try {
        exportEntries.push({ name: safeArchivePath(file.path), content: file.content });
      } catch (err) {
        const pathErr = err as UnsafeProjectPathError;
        unsafePaths.push({ path: file.path, reason: pathErr.reason ?? 'invalid-path' });
      }
    }
    if (unsafePaths.length > 0) {
      request.log.error(
        {
          event: 'route:export-project:unsafe-paths',
          projectId: id,
          count: unsafePaths.length,
          paths: unsafePaths.slice(0, 20),
        },
        'Refusing export due to unsafe file paths',
      );
      await projectStore.update(id, (current) => {
        current.diagnostics = current.diagnostics ?? {};
        const existing = (current.diagnostics.pathSafety ?? {}) as Record<string, unknown>;
        current.diagnostics.pathSafety = {
          ...existing,
          lastUnsafeExportAt: new Date().toISOString(),
          unsafeExportPaths: unsafePaths,
        };
      }, {
        phase: 'export:path-safety-block',
        caller: 'routes:api:export',
        reason: `blocked unsafe export paths (${unsafePaths.length})`,
      }).catch(() => {});
      return reply.status(422).send({
        error: 'Project contains unsafe file paths and cannot be exported',
        code: 'UNSAFE_PROJECT_PATH',
        unsafePaths,
      });
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    archive.on('error', (error) => {
      request.log.error({ event: 'route:export-project:error', projectId: id, err: error.message }, 'project export stream failed');
      reply.raw.destroy(error);
    });

    const manifest = {
      projectId: project.id,
      name: project.name,
      status: project.status,
      sessionId: project.sessionId,
      prompts: project.prompts,
      stackSelectionMode: project.stackSelectionMode ?? 'auto',
      techStack: project.techStack ?? null,
      exportedAt: new Date().toISOString(),
    };

    archive.append(`${JSON.stringify(manifest, null, 2)}\n`, { name: 'devteam-export.json' });
    for (const file of exportEntries) {
      archive.append(file.content, { name: file.name });
    }

    reply
      .header('Content-Type', 'application/zip')
      .header('Content-Disposition', `attachment; filename="${safeDownloadName(project.name ?? id)}-${id}-export.zip"`);

    void archive.finalize();
    return reply.send(archive);
  });

  app.delete('/api/projects/:id', { preHandler: [auth.requireProjectAccess('member')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await projectStore.delete(id);
    if (!deleted) return reply.status(404).send({ error: 'Project not found' });
    return { deleted: true };
  });

  app.get('/api/sessions/:id/progress', async (request, reply) => {
    const { id } = request.params as { id: string };
    const principal = getAuthPrincipal(request);
    const projects = await projectStore.list();
    const allowedSessionIds = new Set(
      projects
        .filter((project) => auth.canAccessProject(principal, project))
        .map((project) => project.sessionId)
        .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
    );
    if (!allowedSessionIds.has(id)) {
      return reply.status(403).send({ error: 'Session belongs to a different workspace' });
    }
    const progress = sessionManager.getProgress(id);
    if (!progress) return reply.status(404).send({ error: 'Session not found' });
    return {
      sessionId: progress.sessionId, status: progress.status, progress: progress.progress,
      currentStep: progress.currentStep ? {
        stepId: progress.currentStep.stepId, name: progress.currentStep.name,
        agent: progress.currentStep.agent, description: progress.currentStep.description,
        attempt: progress.currentStep.attempt,
      } : null,
      steps: progress.steps.map(s => ({
        stepId: s.stepId, name: s.name, agent: s.agent, status: s.status,
        durationMs: s.durationMs, error: s.error,
      })),
      completedAgents: progress.completedAgents, failedAgents: progress.failedAgents,
      durationMs: progress.durationMs, eventCount: progress.events.length,
    };
  });

  app.get('/api/sessions/active', async (request) => {
    const principal = getAuthPrincipal(request);
    const projects = await projectStore.list();
    const allowedSessionIds = new Set(
      projects
        .filter((project) => auth.canAccessProject(principal, project))
        .map((project) => project.sessionId)
        .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
    );
    return sessionManager.listActive().filter((session) => {
      const sid = (session as { sessionId?: string; id?: string }).sessionId ?? (session as { id?: string }).id;
      return typeof sid === 'string' && allowedSessionIds.has(sid);
    });
  });

  app.get('/api/memory/stats', { preHandler: [auth.requireRole('admin')] }, async () => memoryStore.getStats());

  app.post('/api/memory/decay', { preHandler: [auth.requireRole('admin')] }, async () => {
    await memoryStore.runDecay();
    return { status: 'ok', stats: memoryStore.getStats() };
  });

  registerLLMRoutes(app, llm, auth);
  registerVersionRoutes(app, generator, projectStore, auth);
}
