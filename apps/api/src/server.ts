// ─────────────────────────────────────────────────────────────
// Server entry point
// ─────────────────────────────────────────────────────────────

import { config, validateProductionConfig } from './config.js';
import { buildApp } from './app.js';
import { pinoLogger } from './logger.js';

// Catch programming errors that escape async boundaries
process.on('uncaughtException', (err) => {
  pinoLogger.error({ err }, 'Uncaught exception — shutting down');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  pinoLogger.error({ reason }, 'Unhandled promise rejection — shutting down');
  process.exit(1);
});

async function main() {
  // Fail fast if required prod config is absent
  validateProductionConfig();

  const app = await buildApp();

  try {
    await app.listen({ port: config.server.port, host: config.server.host });
    console.log(`
╔═══════════════════════════════════════════════════════╗
║                                                       ║
║   DEVteam API Server                                  ║
║                                                       ║
║   REST:  http://${config.server.host}:${config.server.port}/api         ║
║   WS:    ws://${config.server.host}:${config.server.port}/ws           ║
║   Health: http://${config.server.host}:${config.server.port}/health     ║
║                                                       ║
║   Environment: ${config.env.padEnd(38)}║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, shutting down...`);
      await app.close();
      process.exit(0);
    });
  }
}

main();
