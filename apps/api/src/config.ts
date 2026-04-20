// ─────────────────────────────────────────────────────────────
// Application config — loads from env with defaults
// ─────────────────────────────────────────────────────────────

import 'dotenv/config';

export const config = {
  env: process.env.NODE_ENV ?? 'development',
  isDev: (process.env.NODE_ENV ?? 'development') === 'development',

  server: {
    port: parseInt(process.env.PORT ?? '3001', 10),
    host: process.env.HOST ?? '0.0.0.0',
  },

  llm: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? '',
    openaiApiKey: process.env.OPENAI_API_KEY ?? '',
    googleApiKey: process.env.GOOGLE_API_KEY ?? '',
  },

  db: {
    url: process.env.DATABASE_URL ?? 'postgresql://devteam:devteam@localhost:5432/devteam',
  },

  redis: {
    url: process.env.REDIS_URL ?? 'redis://localhost:6379',
  },

  storage: {
    projectsDir: process.env.PROJECTS_DIR ?? './data/projects',
    memoryDir: process.env.MEMORY_DIR ?? './data/memory',
  },

  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_MAX ?? '100', 10),
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS ?? '60000', 10),
  },

  pipeline: {
    maxConcurrentSessions: parseInt(process.env.MAX_CONCURRENT_SESSIONS ?? '10', 10),
    sessionTimeoutMs: parseInt(process.env.SESSION_TIMEOUT_MS ?? '300000', 10),
  },
} as const;
