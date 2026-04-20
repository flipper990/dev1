import type { FastifyInstance } from 'fastify';
import { ValidationError } from '@devteam/core';
import type { AgentRole } from '@devteam/core';
import { globalLLMRouter, MODEL_REGISTRY } from '@devteam/api-routing';

const VALID_ROLES: AgentRole[] = ['planner', 'architect', 'coder', 'reviewer', 'tester', 'debugger', 'devops', 'optimizer'];

export async function agentRoutes(app: FastifyInstance) {
  // GET /api/agents/models — list available models
  app.get('/models', async (_req, reply) => {
    return reply.send({ models: MODEL_REGISTRY });
  });

  // POST /api/agents/models/:role — override model for a role
  app.post<{ Params: { role: string }; Body: { modelId: string } }>(
    '/models/:role',
    async (req, reply) => {
      const { role } = req.params;
      const { modelId } = req.body ?? {};

      if (!VALID_ROLES.includes(role as AgentRole)) {
        throw new ValidationError(`Invalid role: ${role}. Valid roles: ${VALID_ROLES.join(', ')}`);
      }
      if (!modelId || !MODEL_REGISTRY[modelId]) {
        throw new ValidationError(`Unknown model: ${modelId}`);
      }

      globalLLMRouter.setModelOverride(role as AgentRole, modelId);
      return reply.send({ role, modelId, message: 'Model override applied' });
    },
  );

  // DELETE /api/agents/models/:role — remove override
  app.delete<{ Params: { role: string } }>('/models/:role', async (req, reply) => {
    const { role } = req.params;
    if (!VALID_ROLES.includes(role as AgentRole)) {
      throw new ValidationError(`Invalid role: ${role}`);
    }
    globalLLMRouter.clearModelOverride(role as AgentRole);
    return reply.status(204).send();
  });

  // GET /api/agents/cost — cost summary
  app.get('/cost', async (_req, reply) => {
    return reply.send(globalLLMRouter.getCostSummary());
  });

  // GET /api/agents/circuit — circuit breaker status
  app.get('/circuit', async (_req, reply) => {
    return reply.send(globalLLMRouter.getCircuitStatus());
  });
}
