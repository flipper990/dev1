import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProjectGenerator } from '../pipeline/project-generator.js';
import type { ProjectStore } from '../storage/project-store.js';

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
): void {
  app.post('/api/projects/:id/update', async (request, reply) => {
    const { id } = request.params as { id: string };
    const parsed = UpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid update request', details: parsed.error.issues });
    }
    const result = await generator.update({ projectId: id, ...parsed.data });
    if (!result.success) {
      const status = result.error?.includes('not found') ? 404 : result.error?.includes('generating') ? 409 : 500;
      return reply.status(status).send({ error: result.error });
    }
    return reply.status(200).send(result);
  });

  app.get('/api/projects/:id/versions', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await projectStore.get(id);
    if (!project) return reply.status(404).send({ error: 'Project not found' });
    return { projectId: id, currentVersion: project.version ?? 1, history: project.versionHistory ?? [] };
  });

  app.get('/api/projects/:id/versions/:version', async (request, reply) => {
    const { id, version } = request.params as { id: string; version: string };
    const v = parseInt(version, 10);
    if (isNaN(v) || v < 1) return reply.status(400).send({ error: 'Version must be a positive integer' });
    const snapshot = await projectStore.getSnapshot(id, v);
    if (!snapshot) return reply.status(404).send({ error: `Version ${v} not found for project ${id}` });
    return snapshot;
  });
}
