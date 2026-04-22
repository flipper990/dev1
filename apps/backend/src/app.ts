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
    bodyLimit: 1_048_576, // 1 MB
    genReqId: () => crypto.randomUUID(),
  });

  // ── Security ───────────────────────────────────────────────────────────
  await app.register(helmet, {
    contentSecurityPolicy: config.env === 'production' ? {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    } : false,
    frameguard: config.env === 'production' ? { action: 'deny' } : false,
    crossOriginEmbedderPolicy: false,
  });

  await app.register(cors, {
    origin: config.env === 'production'
      ? (process.env['ALLOWED_ORIGINS'] ?? '').split(',').filter(Boolean)
      : true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    credentials: true,
  });

  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
    keyGenerator: (req) => req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.ip,
    errorResponseBuilder: () => ({
      error: 'Too many requests',
      code: 'RATE_LIMIT',
      statusCode: 429,
    }),
  });

  // ── WebSocket ──────────────────────────────────────────────────────────
  await app.register(websocket);
  registerWebSocket(app);

  // ── Request / response logging ─────────────────────────────────────────
  app.addHook('onRequest', (req, _reply, done) => {
    logger.info('incoming request', { method: req.method, url: req.url, reqId: req.id });
    done();
  });

  app.addHook('onResponse', (req, reply, done) => {
    logger.info('request completed', { method: req.method, url: req.url, statusCode: reply.statusCode, reqId: req.id });
    done();
  });

  // ── Routes ─────────────────────────────────────────────────────────────
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(projectRoutes, { prefix: '/api/projects' });
  await app.register(agentRoutes, { prefix: '/api/agents' });

  // ── Error handler ──────────────────────────────────────────────────────
  app.setErrorHandler((error, req, reply) => {
    const reqId = req.id;
    if (isAppError(error)) {
      if (error.statusCode >= 500) {
        logger.error('Application error', { reqId, code: error.code, message: error.message, stack: error.stack });
      } else {
        logger.warn('Client error', { reqId, code: error.code, message: error.message });
      }
      return reply.status(error.statusCode).send({
        error: error.message,
        code: error.code,
        statusCode: error.statusCode,
        reqId,
        details: error.details,
      });
    }

    logger.error('Unhandled error', { reqId, message: error.message, stack: error.stack });
    return reply.status(500).send({
      error: 'Internal server error',
      code: 'INTERNAL_ERROR',
      statusCode: 500,
      reqId,
    });
  });

  return app;
}
