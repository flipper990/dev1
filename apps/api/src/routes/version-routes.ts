import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { ProjectGenerator } from '../pipeline/project-generator.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { createAuthGuards } from '../security/auth.js';
import { getAuthPrincipal } from '../security/auth.js';

const UpdateSchema = z.object({
  prompts: z.array(z.string().min(10).max(5000)).min(1).max(3),
  userId: z.string().optional(),
  preferences: z.record(z.unknown()).optional(),
  scope: z.enum(['code', 'design', 'full']).optional(),
});

export function registerVersionRoutes(
  app: FastifyInstance,
  generator: ProjectGenerator,
  projectStore: ProjectStore,
  auth: ReturnType<typeof createAuthGuards>,
): void {
  // Accepts either { prompt: string } (frontend shape) or { prompts: string[] } (legacy).
  const PromptsOrPromptSchema = z.union([
    UpdateSchema,
    z.object({
      prompt: z.string().min(1).max(5000),
      preferences: z.record(z.unknown()).optional(),
      scope: z.enum(['code', 'design', 'full']).optional(),
    }),
  ]);

  const handleUpdate = async (request: FastifyRequest, reply: FastifyReply) => {
    const principal = getAuthPrincipal(request);
    const { id } = request.params as { id: string };
    const authorized = await auth.ensureProjectAccess(request, reply, id, { minRole: 'member' });
    if (!authorized) return;
    const parsed = PromptsOrPromptSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid update request', details: parsed.error.issues });
    }
    const data = parsed.data as { prompt?: string; prompts?: string[]; preferences?: Record<string, unknown>; scope?: 'code' | 'design' | 'full' };
    const prompts = data.prompts ?? (data.prompt ? [data.prompt] : []);
    if (prompts.length === 0) {
      return reply.status(400).send({ error: 'At least one prompt is required' });
    }

    // Quick existence check so the caller gets a fast 404 instead of a
    // background failure they can only see in logs.
    const existing = await projectStore.get(id);
    if (!existing) return reply.status(404).send({ error: `Project ${id} not found` });
    if (existing.status === 'generating') {
      return reply.status(409).send({ error: 'Project is still generating; wait for it to complete before updating' });
    }

    const reservation = generator.reserveUpdate({
      projectId: id,
      prompts,
      userId: principal.userId,
      preferences: data.preferences,
      scope: data.scope,
    });

    // Persist the new sessionId + 'generating' status synchronously so the
    // dashboard's poll/auto-attach picks up the new run instead of the
    // stale one from the original generation. Without this, the
    // websocket attaches to the dead original session and the UI shows
    // no progress even though the pipeline is running fine in the bg.
    // Use update() so the read-modify-write is held under the
    // per-project lock — protects against a racing updatePreview()
    // from a still-warm preview container clobbering this status flip.
    await projectStore.update(id, (rec) => {
      rec.sessionId = reservation.sessionId;
      rec.status = 'generating';
      rec.projectStatus = 'generating';
      rec.verificationStatus = 'pending';
    }, {
      phase: 'update-route:reserve-session',
      caller: 'version-routes:update',
      reason: 'user-initiated update flow flips generated→generating',
      allowStatusDowngrade: true,
    });

    void generator.runReservedUpdate(reservation).catch((err) => {
      request.log.error({ err, projectId: id }, 'Background update failed');
    });

    return reply.status(202).send({
      projectId: id,
      sessionId: reservation.sessionId,
      project:  { id: existing.id, name: existing.name, sessionId: reservation.sessionId, status: 'generating', projectStatus: 'generating', verificationStatus: 'pending', fileCount: existing.files.length, totalTokens: existing.totalTokens, totalCostUsd: existing.totalCostUsd, durationMs: existing.durationMs },
      pipeline: { sessionId: reservation.sessionId },
    });
  };

  // Canonical route + frontend-facing alias.
  app.post('/api/projects/:id/update', handleUpdate);
  app.post('/api/projects/:id/prompts', handleUpdate);

  // Prompt history — used by frontend to render the prompt timeline.
  app.get('/api/projects/:id/prompts', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    const history = (project.versionHistory ?? []).flatMap((v) =>
      (v.prompts ?? []).map((text) => ({
        text,
        createdAt: v.createdAt,
        snapshotVersionId: String(v.version),
        changedFiles: (v.diffs ?? []).map((d) => d.path),
        added:    (v.diffs ?? []).filter((d) => d.op === 'added').map((d) => d.path),
        modified: (v.diffs ?? []).filter((d) => d.op === 'modified').map((d) => d.path),
        removed:  (v.diffs ?? []).filter((d) => d.op === 'deleted').map((d) => d.path),
      })),
    );
    // If versionHistory is empty (single-version project), fall back to the
    // top-level prompts list so the UI still has something to show.
    if (history.length === 0 && project.prompts?.length) {
      for (const text of project.prompts) {
        history.push({
          text,
          createdAt: project.createdAt,
          snapshotVersionId: '1',
          changedFiles: [],
          added: [],
          modified: [],
          removed: [],
        });
      }
    }
    return { prompts: history };
  });

  app.get('/api/projects/:id/versions', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = request.project ?? await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return { projectId: id, currentVersion: project.version ?? 1, history: project.versionHistory ?? [] };
  });

  app.get('/api/projects/:id/versions/:version', { preHandler: [auth.requireProjectAccess('viewer')] }, async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string };
    const v = parseInt(version, 10);
    if (isNaN(v) || v < 1) return reply.status(400).send({ error: 'Version must be a positive integer' });
    const snapshot = await projectStore.getSnapshot(id, v);
    if (!snapshot) return reply.status(404).send({ error: `Version ${v} not found for project ${id}` });
    return snapshot;
  });
}
