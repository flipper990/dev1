// ─────────────────────────────────────────────────────────────
// Application config — loads from env with defaults
// ─────────────────────────────────────────────────────────────

import { config as _dotenv } from 'dotenv';
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dotenvCandidates = [
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../../.env'),
  resolve(dirname(fileURLToPath(import.meta.url)), '../../../.env'),
];

for (const dotenvPath of dotenvCandidates) {
  if (existsSync(dotenvPath)) {
    _dotenv({ path: dotenvPath });
  }
}

function optionalPositiveFloat(value: string | undefined): number | null {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function boundedRatio(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 1 ? parsed : fallback;
}

function envBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

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
    url: process.env.DATABASE_URL ?? 'postgresql://devteam:devteam@localhost:55432/devteam',
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
    multiTierRouter: envBool(process.env.MULTI_TIER_ROUTER, true),
    fastTier1Path: envBool(process.env.FAST_TIER1_PATH, false),
    fastTier1FallbackToLegacy: envBool(process.env.FAST_TIER1_FALLBACK_TO_LEGACY, false),
    fastTier2Path: envBool(process.env.FAST_TIER2_PATH, true),
    tier3ContractFirstPath: envBool(process.env.TIER3_CONTRACT_FIRST_PATH, true),
    multiTierFallbackToLegacy: envBool(process.env.MULTI_TIER_FALLBACK_TO_LEGACY, true),
    tier1TimeoutMs: parseInt(process.env.TIER1_TIMEOUT_MS ?? '600000', 10),
    tier2TimeoutMs: parseInt(process.env.TIER2_TIMEOUT_MS ?? '1200000', 10),
    tier3TimeoutMs: parseInt(process.env.TIER3_TIMEOUT_MS ?? '1800000', 10),
    tier1RetryBudget: parseInt(process.env.TIER1_RETRY_BUDGET ?? '1', 10),
    tier2RetryBudget: parseInt(process.env.TIER2_RETRY_BUDGET ?? '2', 10),
    tier3RetryBudget: parseInt(process.env.TIER3_RETRY_BUDGET ?? '3', 10),
  },

  generationBudget: {
    softLimitUsd: optionalPositiveFloat(
      process.env.GENERATION_BUDGET_SOFT_USD ??
      process.env.GENERATION_BUDGET_USD ??
      process.env.PROJECT_GENERATION_BUDGET_USD,
    ),
    warningThreshold: boundedRatio(process.env.GENERATION_BUDGET_WARNING_THRESHOLD, 0.75),
    criticalThreshold: boundedRatio(process.env.GENERATION_BUDGET_CRITICAL_THRESHOLD, 0.90),
    hardStopEnabled: envBool(process.env.GENERATION_BUDGET_HARD_STOP, false),
  },

  cors: {
    allowedOrigins: (process.env.ALLOWED_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map(o => o.trim())
      .filter(Boolean),
  },

  auth: {
    devBypassRequested: envBool(process.env.DEV_AUTH_BYPASS, false),
    devBypass: ((process.env.NODE_ENV ?? 'development') === 'development') && envBool(process.env.DEV_AUTH_BYPASS, false),
    tokenSecret: process.env.AUTH_TOKEN_SECRET ?? '',
    accessTokenTtlSec: parseInt(process.env.AUTH_ACCESS_TOKEN_TTL_SEC ?? '900', 10),
    refreshTokenTtlSec: parseInt(process.env.AUTH_REFRESH_TOKEN_TTL_SEC ?? '2592000', 10),
    passwordResetTokenTtlSec: parseInt(process.env.AUTH_PASSWORD_RESET_TOKEN_TTL_SEC ?? '3600', 10),
    verifyEmailTokenTtlSec: parseInt(process.env.AUTH_VERIFY_EMAIL_TOKEN_TTL_SEC ?? '86400', 10),
    devUserId: process.env.DEV_USER_ID ?? process.env.DEV_AUTH_BYPASS_USER_ID ?? 'dev-user',
    devWorkspaceId: process.env.DEV_WORKSPACE_ID ?? process.env.DEV_AUTH_BYPASS_WORKSPACE_ID ?? 'dev-workspace',
    devUserEmail: process.env.DEV_USER_EMAIL ?? process.env.DEV_AUTH_BYPASS_USER_EMAIL ?? 'dev@local.test',
    devRole: (process.env.DEV_USER_ROLE ?? process.env.DEV_AUTH_BYPASS_ROLE ?? 'owner') as 'owner' | 'admin' | 'member' | 'viewer',
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
  if (!process.env.AUTH_TOKEN_SECRET) {
    missing.push('AUTH_TOKEN_SECRET');
  }
  if (missing.length > 0) {
    throw new Error(`Missing required production environment variables: ${missing.join(', ')}`);
  }
}
