// ─────────────────────────────────────────────────────────────
// Application bootstrap — wires all components together
// ─────────────────────────────────────────────────────────────

import Fastify from 'fastify';
import fastifyWebSocket from '@fastify/websocket';
import fastifyCors from '@fastify/cors';
import fastifyRateLimit from '@fastify/rate-limit';

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
  );

  // ── Build Fastify app ───────────────────────────────

  const app = Fastify({
    logger: pinoLogger,
    bodyLimit: 1_048_576, // 1MB
  });

  // Plugins
  await app.register(fastifyCors, {
    origin: config.isDev ? true : ['http://localhost:3000'],
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
  });

  await app.register(fastifyRateLimit, {
    max: config.rateLimit.max,
    timeWindow: config.rateLimit.windowMs,
  });

  await app.register(fastifyWebSocket);

  // ── Global error handler ────────────────────────────

  app.setErrorHandler((error, _request, reply) => {
    logger.error('Unhandled error', { error: error.message, stack: error.stack });
    reply.status(error.statusCode ?? 500).send({
      error: 'Internal Server Error',
      message: config.isDev ? error.message : 'Something went wrong',
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

  app.addHook('onClose', () => {
    clearInterval(cleanupInterval);
  });

  return app;
}
