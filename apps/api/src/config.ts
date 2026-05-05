// ─────────────────────────────────────────────────────────────
// Application config — loads from env with defaults
// ─────────────────────────────────────────────────────────────

import { config as _dotenv } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
_dotenv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env') });

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',

  server: {
    port: parseInt(process.env.API_PORT ?? process.env.PORT ?? '3003', 10),
    host: process.env.HOST ?? '0.0.0.0',
  },

  llm: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    googleApiKey: process.env.GOOGLE_API_KEY ?? '',
    azure: {
      apiKey: process.env.AZURE_OPENAI_API_KEY ?? '',
      endpoint: process.env.AZURE_OPENAI_ENDPOINT ?? '',
      apiVersion: process.env.AZURE_OPENAI_API_VERSION ?? '2024-10-21',
      healthCheckDeployment: process.env.AZURE_OPENAI_HEALTHCHECK_DEPLOYMENT ?? '',
    },
  },

  db: {
    url: process.env.DATABASE_URL ?? 'postgresql://devteam:devteam@localhost:5432/devteam',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  storage: {
    // Resolve to repo-root /data/* using absolute paths so storage is stable
    // regardless of cwd (turbo / direct npm run dev / VS Code task), and so
    // it sits OUTSIDE apps/api/ — avoiding tsx-watch reloads triggered by
    // pipeline writes during a long generation.
    projectsDir: process.env.PROJECTS_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/projects'),
    memoryDir: process.env.MEMORY_DIR ?? resolve(dirname(fileURLToPath(import.meta.url)), '../../../data/memory'),
  },

  rateLimit: {
    // Dev defaults are generous: a single user with the dashboard open hits
    // /api/projects (8 s poll) + /api/preview/health (boot) +
    // /api/projects/:id/preview/status (5 s poll while a project is open).
    // With React StrictMode double-mounts and HMR remounts that easily
    // exceeds 100/min from a single localhost client. 600/min keeps the
    // limit useful against runaway loops without false-positive throttling.
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '600', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  },

  pipeline: {
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS ?? '10', 10),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS ?? '300000', 10),
  },

  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean),
  },
} as const;

/** Fail fast on startup when required production secrets are missing or left at insecure defaults. */
export function validateProductionConfig(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const missing: string[] = [];
  if (
    !process.env.ANTHROPIC_API_KEY &&
    !process.env.OPENAI_API_KEY &&
    !(process.env.AZURE_OPENAI_API_KEY && process.env.AZURE_OPENAI_ENDPOINT)
  ) {
    missing.push('ANTHROPIC_API_KEY or OPENAI_API_KEY or (AZURE_OPENAI_API_KEY + AZURE_OPENAI_ENDPOINT)');
  }
  if (!process.env.ALLOWED_ORIGINS) {
    missing.push('ALLOWED_ORIGINS');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
}
