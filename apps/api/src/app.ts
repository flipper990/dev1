// ─────────────────────────────────────────────────────────────
// Application bootstrap — wires all components together
// ─────────────────────────────────────────────────────────────

import Fastify from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import { ZodError } from 'zod';

import { config } from './config.js';
import { createLogger, pinoLogger } from './logger.js';
import { createLLMRouter } from './llm/router.js';
import { createAllAgents } from './agents/factory.js';
import { FileMemoryStore } from './storage/memory-store.js';
import { LearningEngine } from './storage/learning-engine.js';
import { ProjectStore } from './storage/project-store.js';
import { SessionManager } from './pipeline/session-manager.js';
import { ProjectGenerator } from './pipeline/project-generator.js';
import { registerRoutes } from './routes/api.js';
import { registerWebSocket } from './routes/websocket.js';

export async function buildApp() {
  const logger = createLogger('server');

  // ── Initialize storage ──────────────────────────────

  const projectStore = new ProjectStore(config.storage.projectsDir, createLogger('project-store'));
  await projectStore.init();

  const memoryStore = new FileMemoryStore(config.storage.memoryDir, createLogger('memory-store'));
  await memoryStore.init();

  // ── Initialize Learning Engine ──────────────────────

  const learningEngine = new LearningEngine(memoryStore, createLogger('learning'));

  // ── Initialize LLM + Agents ─────────────────────────

  const llm = createLLMRouter(createLogger('llm'));

  const agents = createAllAgents(
    llm,
    memoryStore,
    { publish: async () => {}, subscribe: () => {}, unsubscribe: () => {} }, // bus not used in direct mode
    createLogger('agents'),
  );

  // Wire learning engine into agent hooks (observe task start/end)
  for (const agent of Object.values(agents)) {
    agent.setHooks({
      beforeExecute: async (_ctx, task) => {
        learningEngine.observeTaskStart(task, agent._lastLoadedMemories);
        return task;
      },
      afterExecute: async (_ctx, task) => {
        await learningEngine.observeTaskEnd(task);
        return task;
      },
      onError: async (_ctx, task, _error) => {
        await learningEngine.observeTaskEnd(task);
      },
    });
  }

  // ── Initialize pipeline ─────────────────────────────

  const sessionManager = new SessionManager(createLogger('sessions'));

  const generator = new ProjectGenerator(
    agents,
    projectStore,
    memoryStore,
    sessionManager,
    createLogger('generator'),
    config.pipeline.maxConcurrentSessions,
  );

  // ── Build Fastify app ───────────────────────────────

  const app = Fastify({
    logger: pinoLogger,
    bodyLimit: 1_048_576, // 1 MB
    trustProxy: true,
    genReqId: () => crypto.randomUUID(),
  });

  // ── Security headers ───────────────────────────────────
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: config.isDev ? false : {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    crossOriginEmbedderPolicy: false,
  });

  // Plugins
  const allowedOrigins = config.cors.allowedOrigins;
  await app.register(fastifyCors, {
    origin: config.isDev ? true : allowedOrigins,
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: false,
  });

  await app.register(fastifyRateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
    keyGenerator: (req) => req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() ?? req.ip,
    errorResponseBuilder: (_req, context) => ({
      error: 'Too Many Requests',
      code: 'RATE_LIMIT',
      statusCode: 429,
      retryAfter: context.after,
    }),
  });

  await app.register(fastifyWebSocket);

  // ── Request / response logging ──────────────────────────
  app.addHook('onRequest', (request, _reply, done) => {
    request.log.info({ method: request.method, url: request.url, reqId: request.id }, 'incoming request');
    done();
  });

  app.addHook('onResponse', (request, reply, done) => {
    request.log.info(
      { method: request.method, url: request.url, statusCode: reply.statusCode, responseTime: reply.elapsedTime, reqId: request.id },
      'request completed',
    );
    done();
  });

  // ── Global error handler ────────────────────────────

  app.setErrorHandler((error, request, reply) => {
    const reqId = request.id;

    // Zod validation errors
    if (error instanceof ZodError) {
      return reply.status(400).send({
        error: 'Validation Error',
        code: 'VALIDATION_ERROR',
        statusCode: 400,
        reqId,
        details: error.issues.map(i => ({ path: i.path.join('.'), message: i.message })),
      });
    }

    const statusCode = error.statusCode ?? 500;

    // Client errors (4xx) — log at warn level, no stack
    if (statusCode >= 400 && statusCode < 500) {
      logger.warn('Client error', { reqId, statusCode, message: error.message, url: request.url, method: request.method });
      return reply.status(statusCode).send({
        error: error.message,
        code: (error as { code?: string }).code ?? 'CLIENT_ERROR',
        statusCode,
        reqId,
      });
    }

    // Server errors (5xx) — log full context
    logger.error('Unhandled server error', { reqId, statusCode, message: error.message, stack: error.stack, url: request.url, method: request.method });
    return reply.status(statusCode).send({
      error: 'Internal Server Error',
      code: 'INTERNAL_ERROR',
      statusCode,
      reqId,
      ...(config.isDev && { detail: error.message }),
    });
  });

  // ── Register routes ─────────────────────────────────

  registerRoutes(app, { generator, projectStore, sessionManager, memoryStore, llm, logger });
  registerWebSocket(app, { sessionManager, logger });

  // ── Cleanup interval ────────────────────────────────

  const cleanupInterval = setInterval(() => {
    const cleaned = sessionManager.cleanup();
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired sessions`);
    }
  }, 60_000);

  // ── Memory decay interval (every 6 hours) ───────────

  const decayInterval = setInterval(async () => {
    try {
      const result = await memoryStore.runDecay();
      if (result.decayed > 0 || result.archived > 0) {
        logger.info(`Memory decay: decayed=${result.decayed} archived=${result.archived}`);
      }
    } catch (err) {
      logger.error('Scheduled memory decay failed', { error: (err as Error).message });
    }
  }, 6 * 60 * 60 * 1000);

  app.addHook('onClose', () => {
    clearInterval(cleanupInterval);
    clearInterval(decayInterval);
  });

  return app;
}
