// API Routes — REST endpoints for project generation.
// LLM routes live in ./llm-routes.ts; versioning routes in ./version-routes.ts.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ProjectGenerator } from '../pipeline/project-generator.js';
import type { ProjectStore } from '../storage/project-store.js';
import { ProjectRecordCorruptError } from '../storage/project-store.js';
import type { SessionManager } from '../pipeline/session-manager.js';
import type { FileMemoryStore } from '../storage/memory-store.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { SmartLLMRouter } from '../llm/smart-router.js';
import type { PreviewManager } from '../preview/preview-manager.js';
import { registerLLMRoutes } from './llm-routes.js';
import { registerVersionRoutes } from './version-routes.js';
import {
  getActiveGenerations,
  getHeartbeat,
  getLastUnhandledError,
} from '../crash-logger.js';

const GenerateSchema = z.object({
  prompts: z.array(z.string().min(10).max(5000)).min(1).max(3),
  userId: z.string().optional(),
  preferences: z.record(z.unknown()).optional(),
});

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
  },
): void {
  const { generator, projectStore, sessionManager, memoryStore, llm, preview } = deps;

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

  app.get('/debug/runtime', async () => {
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
      userId: z.string().optional(),
      preferences: z.record(z.unknown()).optional(),
      scope: z.enum(['code', 'design', 'full']).optional(),
    }),
  ]);

  const handleGenerate = async (request: FastifyRequest, reply: FastifyReply) => {
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
    const data = parsed.data as { prompt?: string; prompts?: string[]; userId?: string; preferences?: Record<string, unknown>; scope?: 'code' | 'design' | 'full' };
    const prompts = data.prompts ?? (data.prompt ? [data.prompt] : []);
    if (prompts.length === 0) {
      return reply.status(400).send({ error: 'At least one prompt is required' });
    }

    // Reserve IDs up-front so we can respond immediately and the WS client can
    // subscribe before the pipeline starts emitting events.
    const reservation = generator.reserve({
      prompts,
      userId: data.userId,
      preferences: data.preferences,
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
      project:  { id: reservation.projectId, name: reservation.projectName, status: 'generating', fileCount: 0, totalTokens: 0, totalCostUsd: 0, durationMs: 0 },
      pipeline: { sessionId: reservation.sessionId },
    });
  };

  app.post('/api/projects/generate', handleGenerate);
  app.post('/api/projects', handleGenerate);

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    request.log.info(
      { event: 'route:get-project', projectId: id, reqId: request.id },
      '[route:get-project] lookup',
    );
    try {
      const project = await projectStore.get(id);
      if (!project) {
        request.log.info(
          { event: 'route:get-project:not-found', projectId: id, reqId: request.id },
          '[route:get-project] 404',
        );
        return reply.status(404).send({ error: 'Project not found' });
      }
      return project;
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

  app.get('/api/projects', async () => projectStore.list());

  app.get('/api/projects/:id/files', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return project.files.map(f => ({ path: f.path, size: f.content.length }));
  });

  app.get('/api/projects/:id/files/*', async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = (request.params as Record<string, string>)['*'];
    const project = await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const file = project.files.find(f => f.path === filePath);
    if (!file) return reply.status(404).send({ error: 'File not found' });
    return { path: file.path, content: file.content };
  });

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await projectStore.delete(id);
    if (!deleted) return reply.status(404).send({ error: 'Project not found' });
    return { deleted: true };
  });

  app.get('/api/sessions/:id/progress', async (request, reply) => {
    const { id } = request.params as { id: string };
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

  app.get('/api/sessions/active', async () => sessionManager.listActive());

  app.get('/api/memory/stats', async () => memoryStore.getStats());

  app.post('/api/memory/decay', async () => {
    await memoryStore.runDecay();
    return { status: 'ok', stats: memoryStore.getStats() };
  });

  registerLLMRoutes(app, llm);
  registerVersionRoutes(app, generator, projectStore);
}
