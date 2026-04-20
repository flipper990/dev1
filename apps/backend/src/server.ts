import { config, Logger } from '@devteam/core';
import { buildApp } from './app.js';

const logger = new Logger('server');

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
