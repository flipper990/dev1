// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// WebSocket route â€” Real-time step-by-step progress streaming
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import type { FastifyInstance } from 'fastify';
import type { SessionManager, SessionProgress } from '../pipeline/session-manager.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { createAuthGuards } from '../security/auth.js';

/** Serialise progress for the wire. */
function serializeProgress(p: SessionProgress) {
  return {
    sessionId: p.sessionId,
    status: p.status,
    progress: p.progress,
    executionPhase: p.executionPhase,
    providerStatus: p.providerStatus,
    retryAttempt: p.retryAttempt,
    activeWorker: p.activeWorker,
    lastHeartbeatAt: p.lastHeartbeatAt,
    timeoutAt: p.timeoutAt,
    timeoutRemainingMs: p.timeoutRemainingMs,
    failureReason: p.failureReason,
    currentStep: p.currentStep
      ? {
          stepId: p.currentStep.stepId,
          name: p.currentStep.name,
          agent: p.currentStep.agent,
          description: p.currentStep.description,
          attempt: p.currentStep.attempt,
        }
      : null,
    steps: p.steps.map(s => ({
      stepId: s.stepId,
      name: s.name,
      agent: s.agent,
      status: s.status,
      durationMs: s.durationMs,
      error: s.error,
    })),
    completedAgents: p.completedAgents,
    failedAgents: p.failedAgents,
    durationMs: p.durationMs,
  };
}

// Only allow alphanumeric chars, underscores, and hyphens
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function registerWebSocket(
  app: FastifyInstance,
  deps: { sessionManager: SessionManager; projectStore: ProjectStore; logger: Logger; auth: ReturnType<typeof createAuthGuards> },
): void {
  const { sessionManager, projectStore, logger, auth } = deps;

  app.get('/ws/sessions/:id/progress', { websocket: true }, async (socket, request) => {
    const { id } = request.params as { id: string };

    if (!SESSION_ID_RE.test(id)) {
      socket.send(JSON.stringify({ type: 'error', message: 'Invalid session ID' }));
      socket.close(1008, 'Invalid session ID');
      return;
    }

    const principal = request.auth;
    if (!principal) {
      socket.send(JSON.stringify({ type: 'error', message: 'Authentication required' }));
      socket.close(1008, 'Authentication required');
      return;
    }
    const projects = await projectStore.list();
    const allowedSessionIds = new Set(
      projects
        .filter((project) => auth.canAccessProject(principal, project))
        .map((project) => project.sessionId)
        .filter((sessionId): sessionId is string => typeof sessionId === 'string' && sessionId.length > 0),
    );
    if (!allowedSessionIds.has(id)) {
      socket.send(JSON.stringify({ type: 'error', message: 'Forbidden' }));
      socket.close(1008, 'Forbidden');
      return;
    }

    logger.info(`WebSocket connected for session ${id}`);

    // Send current progress immediately
    const current = sessionManager.getProgress(id);
    if (current) {
      socket.send(JSON.stringify({ type: 'progress', data: serializeProgress(current) }));
    } else {
      socket.send(JSON.stringify({ type: 'error', message: 'Session not found' }));
      socket.close(1008, 'Session not found');
      return;
    }

    // Subscribe to future updates
    const unsubscribe = sessionManager.onProgress(id, (progress) => {
      try {
        socket.send(JSON.stringify({ type: 'progress', data: serializeProgress(progress) }));

        // Auto-close when pipeline finishes
        if (progress.status === 'completed' || progress.status === 'failed') {
          socket.send(JSON.stringify({
            type: 'done',
            data: { status: progress.status, durationMs: progress.durationMs },
          }));
        }
      } catch {
        // Socket may have closed
      }
    });

    // Clients should not send messages â€” reject to prevent abuse
    socket.on('message', () => {
      socket.close(1003, 'Unsupported data');
    });

    socket.on('close', () => {
      unsubscribe();
      logger.info(`WebSocket disconnected for session ${id}`);
    });

    socket.on('error', () => {
      unsubscribe();
    });
  });
}
