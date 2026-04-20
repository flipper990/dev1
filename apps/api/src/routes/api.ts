// ─────────────────────────────────────────────────────────────
// API Routes — REST endpoints for project generation
// ─────────────────────────────────────────────────────────────

import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { ProjectGenerator } from '../pipeline/project-generator.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { SessionManager } from '../pipeline/session-manager.js';
import type { FileMemoryStore } from '../storage/memory-store.js';
import type { Logger } from '../../../packages/agent-core/src/base-agent.js';
import type { SmartLLMRouter } from '../llm/smart-router.js';
import type { AgentRole, LLMProvider } from '../../../packages/agent-core/src/types.js';
import type { TaskCategory } from '../llm/types.js';

// ── Request Schemas ─────────────────────────────────────────

const GenerateSchema = z.object({
  prompts: z.array(z.string().min(10).max(5000)).min(1).max(3),
  userId: z.string().optional(),
  preferences: z.record(z.unknown()).optional(),
});

// ── Route Registration ──────────────────────────────────────

export function registerRoutes(
  app: FastifyInstance,
  deps: {
    generator: ProjectGenerator;
    projectStore: ProjectStore;
    sessionManager: SessionManager;
    memoryStore: FileMemoryStore;
    llm: SmartLLMRouter;
    logger: Logger;
  },
): void {
  const { generator, projectStore, sessionManager, memoryStore, llm, logger } = deps;

  // ── Health Check ──────────────────────────────────────

  app.get('/health', async () => {
    return { status: 'ok', timestamp: new Date().toISOString() };
  });

  // ── Generate Project ──────────────────────────────────

  app.post('/api/projects/generate', async (request, reply) => {
    const parsed = GenerateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid request',
        details: parsed.error.issues.map(i => ({
          path: i.path.join('.'),
          message: i.message,
        })),
      });
    }

    const result = await generator.generate(parsed.data);

    if (!result.success) {
      return reply.status(500).send({
        error: 'Generation failed',
        message: result.error,
        projectId: result.projectId,
        sessionId: result.sessionId,
      });
    }

    return reply.status(201).send({
      projectId: result.projectId,
      sessionId: result.sessionId,
      cached: result.cached ?? false,
      project: {
        id: result.project!.id,
        name: result.project!.name,
        status: result.project!.status,
        fileCount: result.project!.files.length,
        totalTokens: result.project!.totalTokens,
        totalCostUsd: result.project!.totalCostUsd,
        durationMs: result.project!.durationMs,
      },
      steps: result.steps,
      optimization: result.optimization,
    });
  });

  // ── Get Project ───────────────────────────────────────

  app.get('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await projectStore.get(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return project;
  });

  // ── List Projects ─────────────────────────────────────

  app.get('/api/projects', async () => {
    return projectStore.list();
  });

  // ── Get Project Files ─────────────────────────────────

  app.get('/api/projects/:id/files', async (request, reply) => {
    const { id } = request.params as { id: string };
    const project = await projectStore.get(id);
    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return project.files.map(f => ({ path: f.path, size: f.content.length }));
  });

  // ── Get Single File ───────────────────────────────────

  app.get('/api/projects/:id/files/*', async (request, reply) => {
    const { id } = request.params as { id: string };
    const filePath = (request.params as Record<string, string>)['*'];
    const project = await projectStore.get(id);

    if (!project) {
      return reply.status(404).send({ error: 'Project not found' });
    }

    const file = project.files.find(f => f.path === filePath);
    if (!file) {
      return reply.status(404).send({ error: 'File not found' });
    }

    return { path: file.path, content: file.content };
  });

  // ── Delete Project ────────────────────────────────────

  app.delete('/api/projects/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const deleted = await projectStore.delete(id);
    if (!deleted) {
      return reply.status(404).send({ error: 'Project not found' });
    }
    return { deleted: true };
  });

  // ── Session Progress ──────────────────────────────────

  app.get('/api/sessions/:id/progress', async (request, reply) => {
    const { id } = request.params as { id: string };
    const progress = sessionManager.getProgress(id);
    if (!progress) {
      return reply.status(404).send({ error: 'Session not found' });
    }
    return {
      sessionId: progress.sessionId,
      status: progress.status,
      progress: progress.progress,
      currentStep: progress.currentStep
        ? {
            stepId: progress.currentStep.stepId,
            name: progress.currentStep.name,
            agent: progress.currentStep.agent,
            description: progress.currentStep.description,
            attempt: progress.currentStep.attempt,
          }
        : null,
      steps: progress.steps.map(s => ({
        stepId: s.stepId,
        name: s.name,
        agent: s.agent,
        status: s.status,
        durationMs: s.durationMs,
        error: s.error,
      })),
      completedAgents: progress.completedAgents,
      failedAgents: progress.failedAgents,
      durationMs: progress.durationMs,
      eventCount: progress.events.length,
    };
  });

  // ── Active Sessions ───────────────────────────────────

  app.get('/api/sessions/active', async () => {
    return sessionManager.listActive();
  });

  // ── Memory Stats ──────────────────────────────────────

  app.get('/api/memory/stats', async () => {
    return memoryStore.getStats();
  });

  // ── Memory Decay (manual trigger) ─────────────────────

  app.post('/api/memory/decay', async () => {
    await memoryStore.runDecay();
    return { status: 'ok', stats: memoryStore.getStats() };
  });

  // ══════════════════════════════════════════════════════════
  // LLM Routing & Cost Endpoints
  // ══════════════════════════════════════════════════════════

  // ── Cost Summary ──────────────────────────────────────

  app.get('/api/llm/costs', async (request) => {
    const { since } = request.query as { since?: string };
    const sinceDate = since ? new Date(since) : undefined;
    return llm.getCostSummary(sinceDate);
  });

  // ── Cost Records (filterable) ─────────────────────────

  app.get('/api/llm/costs/records', async (request) => {
    const { provider, model, category, since, limit } = request.query as {
      provider?: LLMProvider;
      model?: string;
      category?: TaskCategory;
      since?: string;
      limit?: string;
    };
    const records = llm.getCostTracker().getRecords({
      provider,
      model,
      category,
      since: since ? new Date(since) : undefined,
    });
    const max = Math.min(parseInt(limit ?? '100', 10), 1000);
    return records.slice(-max);
  });

  // ── Circuit Breaker States ────────────────────────────

  app.get('/api/llm/circuit-breaker', async () => {
    return llm.getCircuitBreakerStates();
  });

  // ── Registered Providers ──────────────────────────────

  app.get('/api/llm/providers', async () => {
    const registry = llm.getProviderRegistry();
    return registry.listAll().map(p => ({
      id: p.providerId,
      name: p.displayName,
    }));
  });

  // ── Provider Health Check ─────────────────────────────

  app.get('/api/llm/providers/health', async () => {
    return llm.getProviderRegistry().healthCheckAll();
  });

  // ── Active Model Overrides ────────────────────────────

  app.get('/api/llm/overrides', async () => {
    return llm.getActiveOverrides();
  });

  // ── Add Model Override (dynamic switching) ────────────

  const OverrideSchema = z.object({
    target: z.string(),
    targetType: z.enum(['role', 'category']),
    model: z.object({
      provider: z.string(),
      model: z.string(),
      maxTokens: z.number().int().positive(),
      temperature: z.number().min(0).max(2),
    }),
    expiresInMs: z.number().int().positive().optional(),
  });

  app.post('/api/llm/overrides', async (request, reply) => {
    const parsed = OverrideSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid override', details: parsed.error.issues });
    }
    const { target, targetType, model, expiresInMs } = parsed.data;

    llm.addOverride({
      target: target as AgentRole | TaskCategory,
      targetType,
      model: model as { provider: LLMProvider; model: string; maxTokens: number; temperature: number },
      expiresAt: expiresInMs ? new Date(Date.now() + expiresInMs) : undefined,
    });

    return { status: 'ok', activeOverrides: llm.getActiveOverrides().length };
  });

  // ── Remove Model Override ─────────────────────────────

  app.delete('/api/llm/overrides/:target', async (request) => {
    const { target } = request.params as { target: string };
    const { targetType } = request.query as { targetType?: 'role' | 'category' };
    const removed = llm.removeOverride(
      target as AgentRole | TaskCategory,
      targetType ?? 'role',
    );
    return { removed };
  });

  // ── Clear All Overrides ───────────────────────────────

  app.delete('/api/llm/overrides', async () => {
    llm.clearOverrides();
    return { status: 'ok' };
  });
}
