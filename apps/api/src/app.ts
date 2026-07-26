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
import { validateModelConfig, logActiveModels } from './config/models.js';
import { createAllAgents } from './agents/factory.js';
import { FileMemoryStore } from './storage/memory-store.js';
import { LearningEngine } from './storage/learning-engine.js';
import { ProjectStore } from './storage/project-store.js';
import { SessionManager } from './pipeline/session-manager.js';
import { ProjectGenerator } from './pipeline/project-generator.js';
import { registerRoutes } from './routes/api.js';
import { registerWebSocket } from './routes/websocket.js';
import { registerPreviewRoutes } from './routes/preview-routes.js';
import { registerAuthRoutes } from './routes/auth-routes.js';
import { createDockerRunner } from './preview/docker-runner.js';
import { PortAllocator } from './preview/port-allocator.js';
import { PreviewManager } from './preview/preview-manager.js';
import { LocalPreviewRunner } from './preview/local-runner.js';
import { appendBudgetDiagnostic } from './llm/generation-budget.js';
import { createAuthGuards } from './security/auth.js';
import { AuthStore } from './security/auth-store.js';
import { evaluateTerminalStateConsistency } from './pipeline/terminal-state-consistency.js';

export async function buildApp() {
  const logger = createLogger('server');

  // ── Initialize storage ──────────────────────────────

  const projectStore = new ProjectStore(config.storage.projectsDir, createLogger('project-store'));
  await projectStore.init();
  await projectStore.reapStaleGenerating();

  const memoryStore = new FileMemoryStore(config.storage.memoryDir, createLogger('memory-store'));
  await memoryStore.init();
  const authStore = new AuthStore(config.db.url, createLogger('auth-store'));
  await authStore.ensureSchema();

  // ── Initialize Learning Engine ──────────────────────

  const learningEngine = new LearningEngine(memoryStore, createLogger('learning'));

  // ── Initialize LLM + Agents ─────────────────────────

  // Validate the env-driven MODEL_CONFIG before wiring agents.
  const modelLogger = createLogger('models');
  const validation = validateModelConfig({
    hasOpenAIKey:    Boolean(config.llm.openaiApiKey),
    hasAnthropicKey: Boolean(config.llm.anthropicApiKey),
    hasGoogleKey:    Boolean(config.llm.googleApiKey),
    hasAzureOpenAI:  Boolean(config.llm.azure.apiKey && config.llm.azure.endpoint),
  });
  for (const w of validation.warnings) modelLogger.warn(w);
  for (const e of validation.errors)   modelLogger.error(e);
  if (!validation.ok) {
    throw new Error(
      `Model configuration invalid — fix the errors above. ` +
      `Set MODEL_<ROLE> + matching <PROVIDER>_API_KEY in .env. ` +
      `Errors: ${validation.errors.join('; ')}`,
    );
  }
  logActiveModels(modelLogger);

  const llm = createLLMRouter(createLogger('llm'));
  llm.onGenerationBudgetEvent((event) => {
    void projectStore.update(event.projectId, (project) => {
      project.diagnostics = project.diagnostics ?? {};
      project.diagnostics.generationBudget = appendBudgetDiagnostic(
        project.diagnostics.generationBudget,
        event,
      );
      const warning = {
        code: event.action === 'stop'
          ? 'generation.budget-hard-stop'
          : event.level === 'critical'
            ? 'generation.budget-critical'
            : 'generation.budget-warning',
        message: event.message,
        details: {
          spentUsd: Number(event.spentUsd.toFixed(6)),
          budgetUsd: Number(event.budgetUsd.toFixed(6)),
          percentUsed: Number((event.percentUsed * 100).toFixed(2)),
          level: event.level,
          action: event.action,
          agentRole: event.agentRole,
          model: event.model,
        },
      };
      const existingWarnings = project.warnings ?? [];
      if (!existingWarnings.some((w) => w.code === warning.code)) {
        project.warnings = [...existingWarnings, warning];
      }
    }, {
      phase: 'generation-budget',
      caller: 'app:llm-budget-event',
      reason: `${event.level}:${event.action}`,
      allowStatusDowngrade: true,
    }).catch((err) => {
      logger.warn('Failed to persist generation budget diagnostic', {
        projectId: event.projectId,
        level: event.level,
        action: event.action,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  });

  const agents = createAllAgents(
    llm,
    memoryStore,
    { publish: async () => {}, subscribe: () => {}, unsubscribe: () => {} }, // bus not used in direct mode
    createLogger('agents'),
  );

  // Wire learning engine into agent hooks (observe task start/end)
  for (const agent of Object.values(agents)) {
    agent.setHooks({
      beforeExecute: async (_ctx: unknown, task: unknown) => task as never,
      onMemoriesLoaded: async (ctx: import('@agent-core/types.js').ExecutionContext, task: import('@agent-core/types.js').Task, memories: import('@agent-core/types.js').MemoryEntry[]) => {
        learningEngine.observeTaskStart(task, memories);
        const projectId = typeof ctx.variables.projectId === 'string' ? ctx.variables.projectId : '';
        if (projectId) await memoryStore.recordInfluence({ projectId, runId: task.sessionId, taskId: task.id, agentRole: task.agentRole, memories });
      },
      afterExecute: async (_ctx: unknown, task: unknown) => {
        await learningEngine.observeTaskEnd(task as import('@agent-core/types.js').Task);
        return task as never;
      },
      onError: async (_ctx: unknown, task: unknown, _error: unknown) => {
        await learningEngine.observeTaskEnd(task as import('@agent-core/types.js').Task);
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
    loggerInstance: pinoLogger,
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
    allowedHeaders: ['Content-Type', 'Authorization', 'x-csrf-token', 'x-devteam-user-id', 'x-devteam-user-email', 'x-devteam-workspace-id', 'x-devteam-role'],
    credentials: true,
  });

  if (!config.isDev) {
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
  }

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

  app.setErrorHandler((error: import('fastify').FastifyError, request, reply) => {
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

  // ── Initialize preview runner ────────────────────────

  const dockerRunner = createDockerRunner(createLogger('docker'));
  const portAllocator = new PortAllocator();
  const localRunner = new LocalPreviewRunner({
    projectStore,
    ports: portAllocator,
    logger: createLogger('local-runner'),
  });
  const previewManager = new PreviewManager({
    projectStore,
    docker: dockerRunner,
    ports: portAllocator,
    localRunner,
    logger: createLogger('preview'),
  });
  await previewManager.init();

  // Wire the preview manager back into the generator so it can run
  // post-build runtime validation + auto-fix iterations.
  generator.setPreviewManager(previewManager, `http://127.0.0.1:${config.server.port}`);
  const auth = createAuthGuards(projectStore);
  app.addHook('onRequest', auth.authenticate);

  // ── Register routes ─────────────────────────────────

  registerRoutes(app as unknown as import('fastify').FastifyInstance, { generator, projectStore, sessionManager, memoryStore, llm, logger, preview: previewManager, auth });
  registerAuthRoutes(app as unknown as import('fastify').FastifyInstance, { authStore, auth });
  registerWebSocket(app as unknown as import('fastify').FastifyInstance, { sessionManager, projectStore, logger, auth });
  registerPreviewRoutes(app as unknown as import('fastify').FastifyInstance, {
    preview: previewManager,
    projectStore,
    updater: generator.getUpdater(),
    apiBaseUrl: `http://127.0.0.1:${config.server.port}`,
    logger: createLogger('preview-routes'),
    auth,
  });

  // ── Cleanup interval ────────────────────────────────

  const enforceTerminalStateConsistency = async (): Promise<void> => {
    const projects = await projectStore.list();
    const progressSnapshots = sessionManager.listProgressSnapshots();
    const terminal = progressSnapshots.filter((p) => p.status === 'completed' || p.status === 'failed');
    for (const session of terminal) {
      const project = projects.find((item) => item.sessionId === session.sessionId);
      if (!project) continue;
      const decision = evaluateTerminalStateConsistency({ project, session });
      if (!decision.shouldRepair || !decision.expectedStatus || !decision.event) continue;
      const event = decision.event;

      await projectStore.update(project.id, (current) => {
        current.diagnostics = current.diagnostics ?? {};
        const bag = current.diagnostics as Record<string, unknown>;
        const terminalState = (bag.terminalStateConsistency ?? { events: [] }) as { events?: unknown[] };
        const events = Array.isArray(terminalState.events) ? terminalState.events : [];
        events.push(event);
        bag.terminalStateConsistency = {
          events: events.slice(-50),
          lastRepairedAt: event.capturedAt,
        };

        if (decision.expectedStatus === 'generated') {
          current.status = 'generated';
          current.projectStatus = 'generated';
          current.error = undefined;
          current.completedAt = current.completedAt ?? event.capturedAt;
          return;
        }

        current.status = 'failed';
        current.projectStatus = 'failed';
        current.verificationStatus = 'failed';
        current.completedAt = current.completedAt ?? event.capturedAt;
        const explicitReason = decision.failureReason ?? `terminal session failed in phase=${session.executionPhase}`;
        current.error = explicitReason;
        current.failure = {
          ...(current.failure ?? {}),
          failedPhase: current.failure?.failedPhase ?? 'terminal-consistency',
          failedStep: current.failure?.failedStep ?? (session.currentStep?.stepId ?? 'terminal-consistency'),
          failedAt: current.failure?.failedAt ?? event.capturedAt,
          errorName: current.failure?.errorName ?? 'TerminalStateMismatch',
          errorMessage: current.failure?.errorMessage ?? explicitReason,
          failureCategory: current.failure?.failureCategory ?? 'orchestration_failure',
          failurePhase: current.failure?.failurePhase ?? 'terminal-consistency',
          failureReason: current.failure?.failureReason ?? explicitReason,
          failedAgent: current.failure?.failedAgent ?? 'pipeline',
          retryCount: current.failure?.retryCount ?? session.retryAttempt ?? 0,
          filesGeneratedBeforeFailure: current.failure?.filesGeneratedBeforeFailure ?? (current.files?.length ?? 0),
          recoveryAttempted: current.failure?.recoveryAttempted ?? false,
          recommendedNextAction: current.failure?.recommendedNextAction
            ?? 'Inspect terminal-state consistency diagnostics and pipeline failure trace.',
        };
      }, {
        phase: 'terminal-consistency',
        caller: 'app:terminal-consistency',
        reason: `${event.sessionStatus}/${event.sessionExecutionPhase}`,
        allowStatusDowngrade: true,
      });
    }
  };

  const cleanupInterval = setInterval(() => {
    const cleaned = sessionManager.cleanup();
    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} expired sessions`);
    }
    const watchdogFailures = sessionManager.sweepStalled({
      missionTimeoutMs: Number(process.env.MISSION_TIMEOUT_MS) || 2 * 60 * 60 * 1000,
      heartbeatTimeoutMs: Number(process.env.MISSION_HEARTBEAT_TIMEOUT_MS) || 15 * 60 * 1000,
      stalledStepTimeoutMs: Number(process.env.MISSION_STALLED_STEP_TIMEOUT_MS) || 25 * 60 * 1000,
    });
    if (watchdogFailures.length > 0) {
      logger.warn('Mission watchdog failed active sessions', { count: watchdogFailures.length, watchdogFailures });
      void (async () => {
        const projects = await projectStore.list();
        for (const failure of watchdogFailures) {
          const project = projects.find((item) => item.sessionId === failure.sessionId && item.status === 'generating');
          if (!project) continue;
          await projectStore.update(project.id, (current) => {
            current.status = 'failed';
            current.projectStatus = 'failed';
            current.verificationStatus = 'failed';
            current.error = `[watchdog:${failure.reason}] ${failure.diagnostics}`;
            current.completedAt = failure.timeoutAt;
            current.progress = {
              ...(current.progress ?? {
                phase: 'init',
                lastProgressAt: failure.timeoutAt,
                startedAt: current.createdAt,
                lastMeaningfulStep: 'watchdog',
                llmCallCount: 0,
                filesWrittenCount: 0,
                slicesPlannedCount: 0,
              }),
              phase: 'watchdog',
              executionPhase: failure.executionPhase,
              lastProgressAt: failure.timeoutAt,
              lastMeaningfulStep: `watchdog:${failure.reason}`,
            };
            current.failure = {
              failedPhase: 'watchdog',
              failedStep: failure.currentStep ?? 'watchdog',
              lastSuccessfulPhase: current.progress?.phase ?? 'unknown',
              lastSuccessfulStep: current.progress?.lastMeaningfulStep ?? 'unknown',
              failedAt: failure.timeoutAt,
              errorName: 'MissionWatchdogTimeout',
              errorMessage: failure.diagnostics,
              llmCallCount: current.progress?.llmCallCount ?? 0,
            };
          }, {
            phase: 'watchdog',
            caller: 'app:session-watchdog',
            reason: failure.reason,
            allowStatusDowngrade: true,
          });
        }
      })().catch((err) => {
        logger.error('Mission watchdog persistence failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    void enforceTerminalStateConsistency().catch((err) => {
      logger.error('Terminal-state consistency reconciliation failed', {
        error: err instanceof Error ? err.message : String(err),
      });
    });
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

  app.addHook('onClose', async () => {
    clearInterval(cleanupInterval);
    clearInterval(decayInterval);
    await authStore.close().catch((err) => {
      logger.error('Auth store shutdown failed', { error: (err as Error).message });
    });
    await previewManager.shutdown().catch((err) => {
      logger.error('Preview manager shutdown failed', { error: (err as Error).message });
    });
  });

  return app;
}
