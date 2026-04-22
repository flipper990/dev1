import type { FastifyInstance } from 'fastify';
import { sessionManager } from '@devteam/orchestration';
import { Logger } from '@devteam/core';

const logger = new Logger('websocket');

// Only allow alphanumeric chars, underscores, and hyphens — prevents path traversal
const SESSION_ID_RE = /^[a-zA-Z0-9_-]{1,128}$/;

export function registerWebSocket(app: FastifyInstance): void {
  app.get<{ Params: { sessionId: string } }>(
    '/ws/session/:sessionId',
    { websocket: true },
    (socket, req) => {
      const { sessionId } = req.params;

      if (!SESSION_ID_RE.test(sessionId)) {
        socket.send(JSON.stringify({ type: 'error', data: { message: 'Invalid session ID' } }));
        socket.close(1008, 'Invalid session ID');
        return;
      }

      const session = sessionManager.get(sessionId);
      if (!session) {
        socket.send(JSON.stringify({ type: 'error', data: { message: `Session not found: ${sessionId}` } }));
        socket.close(1008, 'Session not found');
        return;
      }

      logger.info('WebSocket connected', { sessionId });

      // Send current pipeline state immediately
      if (session.pipeline) {
        socket.send(JSON.stringify({
          type: 'session.snapshot',
          data: session.pipeline,
          timestamp: new Date().toISOString(),
        }));
      }

      // Subscribe to future events
      const unsubscribe = sessionManager.subscribe(sessionId, (event) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({
            ...event,
            timestamp: new Date().toISOString(),
          }));
        }
      });

      // Clients should not send messages — close if they do (prevents abuse)
      socket.on('message', () => {
        socket.close(1003, 'Unsupported data');
      });

      socket.on('close', () => {
        unsubscribe();
        logger.info('WebSocket disconnected', { sessionId });
      });

      socket.on('error', (err) => {
        unsubscribe();
        logger.error('WebSocket error', { sessionId, error: err.message });
      });
    },
  );
}
