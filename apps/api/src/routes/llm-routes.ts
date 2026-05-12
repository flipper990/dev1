import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { SmartLLMRouter } from '../llm/smart-router.js';
import type { AgentRole, LLMProvider } from '../../../../packages/agent-core/src/types.js';
import type { TaskCategory } from '../llm/types.js';
import type { createAuthGuards } from '../security/auth.js';

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

export function registerLLMRoutes(app: FastifyInstance, llm: SmartLLMRouter, auth: ReturnType<typeof createAuthGuards>): void {
  app.get('/api/llm/costs', { preHandler: [auth.requireRole('viewer')] }, async (request) => {
    const { since } = request.query as { since?: string };
    return llm.getCostSummary(since ? new Date(since) : undefined);
  });

  app.get('/api/llm/costs/records', { preHandler: [auth.requireRole('viewer')] }, async (request) => {
    const { provider, model, category, since, limit } = request.query as {
      provider?: LLMProvider; model?: string; category?: TaskCategory; since?: string; limit?: string;
    };
    const records = llm.getCostTracker().getRecords({
      provider, model, category, since: since ? new Date(since) : undefined,
    });
    return records.slice(-Math.min(parseInt(limit ?? '100', 10), 1000));
  });

  app.get('/api/llm/circuit-breaker', { preHandler: [auth.requireRole('viewer')] }, async () => llm.getCircuitBreakerStates());

  app.get('/api/llm/providers', { preHandler: [auth.requireRole('viewer')] }, async () => {
    return llm.getProviderRegistry().listAll().map(p => ({ id: p.providerId, name: p.displayName }));
  });

  app.get('/api/llm/providers/health', { preHandler: [auth.requireRole('viewer')] }, async () => llm.getProviderRegistry().healthCheckAll());

  app.get('/api/llm/overrides', { preHandler: [auth.requireRole('viewer')] }, async () => llm.getActiveOverrides());

  app.post('/api/llm/overrides', { preHandler: [auth.requireRole('admin')] }, async (request, reply) => {
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

  app.delete('/api/llm/overrides/:target', { preHandler: [auth.requireRole('admin')] }, async (request) => {
    const { target } = request.params as { target: string };
    const { targetType } = request.query as { targetType?: 'role' | 'category' };
    return { removed: llm.removeOverride(target as AgentRole | TaskCategory, targetType ?? 'role') };
  });

  app.delete('/api/llm/overrides', { preHandler: [auth.requireRole('admin')] }, async () => {
    llm.clearOverrides();
    return { status: 'ok' };
  });
}
