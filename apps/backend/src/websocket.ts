import type { FastifyInstance } from 'fastify';
import { sessionManager } from '@devteam/orchestration';
import { Logger } from '@devteam/core';

const logger = new Logger('websocket');

export function registerWebSocket(app: FastifyInstance): void {
  app.get<{ Params: { sessionId: string } }>(
    '/ws/session/:sessionId',
    { websocket: true },
    (socket, req) => {
      const { sessionId } = req.params;

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
