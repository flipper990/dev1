import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@devteam/core';
import type { CreateProjectRequest } from '@devteam/core';
import { Orchestrator, sessionManager } from '@devteam/orchestration';
import { globalMemoryStore } from '@devteam/memory';
import { globalLLMRouter } from '@devteam/api-routing';
import { projectStore } from '../storage/project-store.js';
import { dockerService } from '../services/docker-service.js';
import { buildReactPreviewHtml } from './preview-renderer.js';

function normalizeFilePath(path: string): string {
  return path.replace(/\\/g, '/').trim();
}

const orchestrator = new Orchestrator({
  memory: globalMemoryStore,
  llm: { complete: (req) => globalLLMRouter.complete(req) },
  onProjectSave: async (project) => {
    await projectStore.save(project);
    const files = project.artifacts?.files ?? [];
    if (files.length > 0 && dockerService.isAvailable()) {
      setImmediate(() => {
        dockerService['_pendingLaunch'] = dockerService['_pendingLaunch'] ?? new Set();
        (dockerService['_pendingLaunch'] as Set<string>).add(project.id);
      });
    }
  },
  onEvent: (sessionId, type, data) => {
    sessionManager.emit(sessionId, type, data);
  },
});

export async function projectRoutes(app: FastifyInstance) {
  app.post<{ Body: CreateProjectRequest }>('/', async (req, reply) => {
    const { prompt, preferences } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      throw new ValidationError('prompt must be at least 10 characters');
    }
    if (prompt.length > 10_000) {
      throw new ValidationError('prompt must not exceed 10,000 characters');
    }
    const { project, sessionId, projectId } = orchestrator.startAsync({ prompt: prompt.trim(), preferences });
    return reply.status(202).send({ project, pipeline: { sessionId, projectId } });
  });

  app.get<{ Querystring: { limit?: string; offset?: string } }>('/', async (req, reply) => {
    const limit = Math.min(Number(req.query.limit ?? 20), 100);
    const offset = Number(req.query.offset ?? 0);
    if (Number.isNaN(limit) || Number.isNaN(offset)) throw new ValidationError('limit and offset must be numbers');
    return reply.send(await projectStore.list(limit, offset));
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    return reply.send({ project: await projectStore.get(req.params.id) });
  });

  app.get<{ Params: { id: string } }>('/:id/files', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const seen = new Set<string>();
    const files = (project.artifacts?.files ?? [])
      .map(f => ({ path: normalizeFilePath(f.path), size: f.content.length }))
      .filter(f => { if (seen.has(f.path)) return false; seen.add(f.path); return true; });
    return reply.send(files);
  });

  app.get<{ Params: { id: string }; Querystring: { path?: string } }>('/:id/file', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const rawPath = req.query.path;
    if (!rawPath || typeof rawPath !== 'string') throw new ValidationError('path query parameter is required');
    const targetPath = normalizeFilePath(rawPath);
    const file = (project.artifacts?.files ?? []).find(f => normalizeFilePath(f.path) === targetPath);
    if (!file) return reply.status(404).send({ error: 'File not found', statusCode: 404 });
    return reply.send({ path: normalizeFilePath(file.path), content: file.content });
  });

  app.get<{ Params: { id: string; '*': string } }>('/:id/files/*', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const filePath = normalizeFilePath(req.params['*']);
    const file = (project.artifacts?.files ?? []).find(f => normalizeFilePath(f.path) === filePath);
    if (!file) return reply.status(404).send({ error: 'File not found', statusCode: 404 });
    return reply.send({ path: normalizeFilePath(file.path), content: file.content });
  });

  app.get<{ Params: { id: string } }>('/:id/preview', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const files = project.artifacts?.files ?? [];

    const isTestFile = (p: string) =>
      p.endsWith('.test.js') || p.endsWith('.test.jsx') || p.endsWith('.test.ts') || p.endsWith('.test.tsx') ||
      p.endsWith('.spec.js') || p.endsWith('.spec.ts') || p.includes('setupTests') || p.includes('__tests__');

    const htmlFiles = files.filter(f => normalizeFilePath(f.path).endsWith('.html'));
    const cssFiles  = files.filter(f => normalizeFilePath(f.path).endsWith('.css'));
    const jsxFiles  = files.filter(f => {
      const p = normalizeFilePath(f.path);
      return (p.endsWith('.js') || p.endsWith('.jsx') || p.endsWith('.ts') || p.endsWith('.tsx')) && !isTestFile(p);
    });

    const isReact = jsxFiles.some(f => /from ['"]react['"]/.test(f.content) || /require\(['"]react['"]\)/.test(f.content));

    if (isReact) {
      const html = buildReactPreviewHtml({
        projectId: project.id, projectName: project.name ?? 'Preview',
        componentFiles: jsxFiles, cssFiles, normalizeFilePath, dockerService,
      });
      const pending = (dockerService as unknown as { _pendingLaunch?: Set<string> })._pendingLaunch;
      pending?.delete(project.id);
      return reply.header('Content-Type', 'text/html; charset=utf-8').send(html);
    }

    if (htmlFiles.length === 0) {
      const fileList = files.map(f => `<li><code>${normalizeFilePath(f.path)}</code> (${f.content.length} B)</li>`).join('\n');
      return reply.header('Content-Type', 'text/html; charset=utf-8').send(`<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><title>Preview</title><style>body{font-family:system-ui,sans-serif;background:#0e1322;color:#d4def7;padding:2rem}h2{color:#33e6be}li{margin:.4rem 0}code{background:rgba(255,255,255,.1);padding:.1rem .3rem;border-radius:4px;font-size:.9em}p{color:#8fa1c7}</style></head><body><h2>Generated Project: ${project.name ?? project.id}</h2><p>No HTML entry point found. Files generated:</p><ul>${fileList}</ul></body></html>`);
    }

    const entryHtml = htmlFiles.find(f => normalizeFilePath(f.path).endsWith('index.html')) ?? htmlFiles[0];
    let doc = entryHtml.content;
    const cssBlock = cssFiles.map(f => `<style>/* ${normalizeFilePath(f.path)} */\n${f.content}\n</style>`).join('\n');
    const jsBlock  = jsxFiles.map(f => `<script>/* ${normalizeFilePath(f.path)} */\n${f.content}\n</script>`).join('\n');
    doc = doc.replace(/<link[^>]+rel=["']stylesheet["'][^>]*>/gi, '');
    doc = doc.replace(/<script[^>]+src=["'][^"']*["'][^>]*><\/script>/gi, '');
    doc = doc.includes('</head>') ? doc.replace('</head>', `${cssBlock}\n</head>`) : cssBlock + '\n' + doc;
    doc = doc.includes('</body>') ? doc.replace('</body>', `${jsBlock}\n</body>`) : doc + '\n' + jsBlock;
    return reply.header('Content-Type', 'text/html; charset=utf-8').send(doc);
  });

  app.get<{ Params: { id: string } }>('/:id/container', async (req, reply) => {
    if (!dockerService.isAvailable()) return reply.send({ available: false, status: 'unavailable', url: null });
    const info = dockerService.getInfo(req.params.id);
    if (!info) return reply.send({ available: true, status: 'none', url: null });
    return reply.send({ available: true, status: info.status, url: info.url || null });
  });

  app.delete<{ Params: { id: string } }>('/:id', async (req, reply) => {
    await projectStore.delete(req.params.id);
    if (dockerService.isAvailable()) dockerService.stop(req.params.id).catch(() => {});
    return reply.status(204).send();
  });

  app.post<{ Params: { id: string }; Body: { prompt: string } }>('/:id/prompts', async (req, reply) => {
    const { prompt } = req.body ?? {};
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 3) throw new ValidationError('prompt must be at least 3 characters');
    if (prompt.length > 10_000) throw new ValidationError('prompt must not exceed 10,000 characters');
    const existingProject = await projectStore.get(req.params.id);
    const { sessionId } = orchestrator.startUpdateAsync(existingProject, prompt.trim());
    return reply.status(202).send({ project: { ...existingProject, sessionId, status: 'running' }, pipeline: { sessionId, projectId: existingProject.id } });
  });

  app.get<{ Params: { id: string } }>('/:id/prompts', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    return reply.send({ prompts: project.prompts ?? [{ text: project.prompt, createdAt: project.createdAt }] });
  });

  app.get<{ Params: { id: string } }>('/:id/versions', async (req, reply) => {
    const project = await projectStore.get(req.params.id);
    const versions = (project.versions ?? []).map(v => ({ id: v.id, createdAt: v.createdAt, promptText: v.promptText, summary: v.summary, fileCount: v.files.length }));
    return reply.send({ versions });
  });
}
