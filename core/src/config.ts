import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AgentRole, LLMProvider } from './types.js';

// ─── Load .env manually (no dotenv dependency in core) ────────────────────────

function loadEnv(): void {
  const envCandidates = [
    resolve(process.cwd(), '.env'),
    resolve(process.cwd(), '..', '.env'),
    resolve(process.cwd(), '..', '..', '.env'),
  ];

  for (const envPath of envCandidates) {
    try {
      const contents = readFileSync(envPath, 'utf8');
      for (const line of contents.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const idx = trimmed.indexOf('=');
        if (idx === -1) continue;
        const key = trimmed.slice(0, idx).trim();
        const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
        if (key && !(key in process.env)) {
          process.env[key] = val;
        }
      }
      return;
    } catch {
      // Try next location
    }
  }

  // .env not present — rely on real environment variables
}

loadEnv();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

function optionalNumber(key: string, fallback: number): number {
  const val = process.env[key];
  if (!val) return fallback;
  const n = Number(val);
  if (Number.isNaN(n)) throw new Error(`Environment variable ${key} must be a number`);
  return n;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export const config = {
  env: optional('NODE_ENV', 'development') as 'development' | 'production' | 'test',
  port: optionalNumber('PORT', 3001),

  storage: {
    path: optional('STORAGE_PATH', './data'),
    redisUrl: optional('REDIS_URL', 'redis://localhost:6379'),
  },

  auth: {
    jwtSecret: optional('JWT_SECRET', 'dev_secret_change_in_prod'),
    apiKeySalt: optional('API_KEY_SALT', 'dev_salt_change_in_prod'),
  },

  limits: {
    maxConcurrentSessions: optionalNumber('MAX_CONCURRENT_SESSIONS', 5),
    maxTokensPerRequest: optionalNumber('MAX_TOKENS_PER_REQUEST', 128_000),
    monthlyBudgetUsd: optionalNumber('MONTHLY_BUDGET_USD', 100),
    /** Max completed generations (initial + updates) allowed per project. */
    maxGenerationsPerProject: optionalNumber('MAX_GENERATIONS_PER_PROJECT', 25),
    /** Max cumulative cost (USD) allowed per project before further runs are blocked. */
    maxCostPerProjectUsd: optionalNumber('MAX_COST_PER_PROJECT_USD', 5),
    /** Percentage (0..1) of a limit at which a warning is emitted. */
    warnThresholdPct: optionalNumber('LIMIT_WARN_THRESHOLD_PCT', 0.8),
  },

  llm: {
    openaiApiKey: optional('OPENAI_API_KEY', ''),
    anthropicApiKey: optional('ANTHROPIC_API_KEY', ''),
    googleApiKey: optional('GOOGLE_API_KEY', ''),
    togetherApiKey: optional('TOGETHER_API_KEY', ''),

    modelsByRole: {
      intent_analyzer: optional('MODEL_INTENT_ANALYZER', 'gpt-4o-mini'),
      planner: optional('MODEL_PLANNER', 'gpt-4o'),
      architect: optional('MODEL_ARCHITECT', 'gpt-4o'),
      ui_ux: optional('MODEL_UI_UX', 'gpt-4o'),
      coder: optional('MODEL_CODER', 'gpt-4o'),
      integration: optional('MODEL_INTEGRATION', 'gpt-4o-mini'),
      reviewer: optional('MODEL_REVIEWER', 'claude-3-5-sonnet-20241022'),
      tester: optional('MODEL_TESTER', 'gpt-4o-mini'),
      debugger: optional('MODEL_DEBUGGER', 'gpt-4o-mini'),
      devops: optional('MODEL_DEVOPS', 'gpt-4o-mini'),
      optimizer: optional('MODEL_OPTIMIZER', 'gpt-4o-mini'),
    } satisfies Record<AgentRole, string>,
  },
} as const;

export type Config = typeof config;

// Warn loudly if insecure defaults are used in production
if (config.env === 'production') {
  if (config.auth.jwtSecret === 'dev_secret_change_in_prod') {
    process.stderr.write('[SECURITY] JWT_SECRET is using the insecure default value. Set a strong secret in production.\n');
  }
  if (config.auth.apiKeySalt === 'dev_salt_change_in_prod') {
    process.stderr.write('[SECURITY] API_KEY_SALT is using the insecure default value. Set a strong salt in production.\n');
  }
  if (!config.llm.openaiApiKey && !config.llm.anthropicApiKey) {
    process.stderr.write('[WARN] No LLM API key is configured (OPENAI_API_KEY / ANTHROPIC_API_KEY).\n');
  }
}
