import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@devteam/core';
import type { CreateProjectRequest } from '@devteam/core';
import { Orchestrator } from '@devteam/orchestration';
import { globalMemoryStore } from '@devteam/memory';
import { globalLLMRouter } from '@devteam/api-routing';
import { projectStore } from '../storage/project-store.js';

// ─── Shared orchestrator instance ─────────────────────────────────────────────

const orchestrator = new Orchestrator({
  memory: globalMemoryStore,
  llm: { complete: (req) => globalLLMRouter.complete(req) },
  onProjectSave: (project) => projectStore.save(project),
});

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function projectRoutes(app: FastifyInstance) {
  // POST /api/projects — create + run pipeline
  app.post<{ Body: CreateProjectRequest }>('/', async (req, reply) => {
    const { prompt, preferences } = req.body ?? {};

    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      throw new ValidationError('prompt must be at least 10 characters');
    }
    if (prompt.length > 10_000) {
      throw new ValidationError('prompt must not exceed 10,000 characters');
    }

    const { project, pipeline } = await orchestrator.run({ prompt: prompt.trim(), preferences });

    return reply.status(201).send({ project, pipeline });
  });

  // GET /api/projects — list all projects
  app.get<{ Querystring: { limit?: string; offset?: string } }>('/', async (req, reply) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Number(req.query.offset ?? 0);

    if (Number.isNaN(limit) || Number.isNaN(offset)) {
      throw new ValidationError('limit and offset must be numbers');
    }

    const result = await projectStore.list(limit, offset);
    return reply.send(result);
  });

  // GET /api/projects/:id — get single project
  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    return reply.send({ project });
  });

  // DELETE /api/projects/:id — delete project
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await projectStore.delete(req.params.id);
    return reply.status(204).send();
  });
}
