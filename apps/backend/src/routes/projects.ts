import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@devteam/core';
import type { CreateProjectRequest } from '@devteam/core';
import { Orchestrator, sessionManager } from '@devteam/orchestration';
import { globalMemoryStore } from '@devteam/memory';
import { globalLLMRouter } from '@devteam/api-routing';
import { projectStore } from '../storage/project-store.js';

function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

// ─── Shared orchestrator instance ─────────────────────────────────────────────

const orchestrator = new Orchestrator({
  memory: globalMemoryStore,
  llm: { complete: (req) => globalLLMRouter.complete(req) },
  onProjectSave: async (project) => {
    await projectStore.save(project);
  },
  onEvent: (sessionId, type, data) => {
    sessionManager.emit(sessionId, type, data);
  },
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

  // GET /api/projects/:id/files — list files in a project
  app.get<{ Params: { id: string } }>('/:id/files', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const seen = new Set<string>();
    const files = (project.artifacts?.files ?? [])
      .map((f) => ({
        path: normalizeFilePath(f.path),
        size: f.content.length,
      }))
      .filter((f) => {
        if (seen.has(f.path)) return false;
        seen.add(f.path);
        return true;
      });
    return reply.send(files);
  });

  // GET /api/projects/:id/file?path=... — robust file lookup
  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/:id/file', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const rawPath = req.query.path;

    if (!rawPath || typeof rawPath !== 'string') {
      throw new ValidationError('path query parameter is required');
    }

    const targetPath = normalizeFilePath(rawPath);
    const file = (project.artifacts?.files ?? []).find((f) => normalizeFilePath(f.path) === targetPath);

    if (!file) {
      return reply.status(404).send({ error: 'File not found', statusCode: 404 });
    }

    return reply.send({ path: normalizeFilePath(file.path), content: file.content });
  });

  // GET /api/projects/:id/files/* — get file content
  app.get<{ Params: { id: string; '*': string } }>('/:id/files/*', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const filePath = normalizeFilePath(req.params['*']);
    const file = (project.artifacts?.files ?? []).find((f) => normalizeFilePath(f.path) === filePath);
    if (!file) {
      return reply.status(404).send({ error: 'File not found', statusCode: 404 });
    }
    return reply.send({ path: normalizeFilePath(file.path), content: file.content });
  });

  // DELETE /api/projects/:id — delete project
  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await projectStore.delete(req.params.id);
    return reply.status(204).send();
  });
}
