import type { FastifyInstance } from 'fastify';
import { sessionManager } from '@devteam/orchestration';

export async function healthRoutes(app: FastifyInstance) {
  app.get('/', async (_req, reply) => {
    return reply.send({
      status: 'ok',
      uptime: process.uptime(),
      activeSessions: sessionManager.getActiveCount(),
      timestamp: new Date().toISOString(),
    });
  });

  app.get('/ready', async (_req, reply) => {
    // Could check DB/Redis connections here
    return reply.send({ ready: true });
  });
}
