import { config, Logger } from '@devteam/core';
import { buildApp } from './app.js';

const logger = new Logger('server');

// Catch programming errors that escape async boundaries
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception — shutting down', { message: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection — shutting down', { reason: String(reason) });
  process.exit(1);
});

const app = await buildApp();

try {
  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.info(`Server running on port ${config.port}`, { env: config.env });
} catch (err) {
  logger.error('Failed to start server', { error: err });
  process.exit(1);
}

// ── Graceful shutdown ──────────────────────────────────────────────────────────

const shutdown = async (signal: string) => {
  logger.info(`Received ${signal}, shutting down`);
  await app.close();
  process.exit(0);
};

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));
