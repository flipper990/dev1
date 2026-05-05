// ─────────────────────────────────────────────────────────────
// Server entry point
// ─────────────────────────────────────────────────────────────

import { config, validateProductionConfig } from './config.js';
import { buildApp } from './app.js';
import { pinoLogger } from './logger.js';
import { installCrashHandlers, LAST_CRASH_PATH } from './crash-logger.js';

// Install centralised crash handlers BEFORE any other code can throw.
// These cover uncaughtException, unhandledRejection, SIGINT/SIGTERM/
// SIGHUP/SIGBREAK and beforeExit, persisting a JSON dump to
// apps/api/src/testing/last-api-crash.json with the active generation
// context at the time of the crash.
installCrashHandlers(pinoLogger);

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
║   Crash dump: ${LAST_CRASH_PATH.padEnd(39)}║
║                                                       ║
╚═══════════════════════════════════════════════════════╝
    `);
  } catch (err) {
    console.error('Failed to start server:', err);
    process.exit(1);
  }

  // Graceful shutdown — runs AFTER the crash-logger's signal recorder
  // (which only writes the dump and does not exit). Multiple handlers
  // for the same signal fire in registration order.
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  for (const signal of signals) {
    process.on(signal, async () => {
      console.log(`\nReceived ${signal}, shutting down...`);
      try {
        await app.close();
      } catch (err) {
        console.error('Error during graceful shutdown:', err);
      }
      process.exit(0);
    });
  }
}

main().catch((err) => {
  // main() should never reject (errors inside are caught above), but
  // belt-and-braces: run the same persistence path as uncaughtException.
  console.error('Fatal error in main():', err);
  process.exit(1);
});

