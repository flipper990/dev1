import 'dotenv/config';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import { config, Logger, isAppError } from '@devteam/core';
import { projectRoutes } from './routes/projects.js';
import { agentRoutes } from './routes/agents.js';
import { healthRoutes } from './routes/health.js';
import { registerWebSocket } from './websocket.js';

// ─── App ──────────────────────────────────────────────────────────────────────

const logger = new Logger('app');

export async function buildApp() {
  const app = Fastify({
    logger: config.env !== 'test',
    trustProxy: true,
  });

  // ── Security ───────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: false, // Handled by the frontend
  });

  await app.register(cors, {
    origin: config.env === 'production'
      ? (process.env['ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean)
      : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({
      error: 'Too many requests',
      code: 'RATE_LIMIT',
      statusCode: 429,
    }),
  });

  // ── WebSocket ──────────────────────────────────────────────────────────
  await app.register(websocket);
  registerWebSocket(app);

  // ── Routes ─────────────────────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(agentRoutes, { prefix: '/api/agents' });

  // ── Error handler ──────────────────────────────────────────────────────
  app.setErrorHandler((error, _req, reply) => {
    if (isAppError(error)) {
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        statusCode: error.statusCode,
        details: error.details,
      });
    }

    logger.error('Unhandled error', { message: error.message, stack: error.stack });
    return reply.status(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
    });
  });

  return app;
}
