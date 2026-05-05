// ─────────────────────────────────────────────────────────────
// Model configuration — fully env-driven.
//
// Every agent's model selection is controlled exclusively via
// .env variables. There are NO hardcoded model fallbacks.
//
//   MODEL_<ROLE>                  e.g. "gpt-4o"            (required)
//   MODEL_<ROLE>_PROVIDER         e.g. "openai"            (default: openai)
//   MODEL_<ROLE>_TEMPERATURE      e.g. "0.3"               (default: 0.3)
//   MODEL_<ROLE>_MAX_TOKENS       e.g. "16384"             (default: 16384)
//   MODEL_<ROLE>_FALLBACK         e.g. "gpt-4o-mini"       (optional — explicit fallback only)
//   MODEL_<ROLE>_FALLBACK_PROVIDER e.g. "openai"           (default: same provider)
//
// Roles: SPEC, BUILDER, QA, POLISH
// ─────────────────────────────────────────────────────────────

import type { LLMProvider, ModelConfig, AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';

// ── Types ──────────────────────────────────────────────────

export interface RoleModelConfig {
  /** Primary model — what the agent will use. */
  primary: ModelConfig;
  /** Explicit fallback. Only used when configured via .env. No implicit fallback. */
  fallback?: ModelConfig;
  /** True iff MODEL_<ROLE> was explicitly set in env. */
  fromEnv: boolean;
}

export type ModelConfigMap = Record<AgentRole, RoleModelConfig>;

// ── Defaults (only used when env var is missing) ───────────

const ROLE_DEFAULTS: Record<AgentRole, { model: string; provider: LLMProvider; temperature: number; maxTokens: number }> = {
  spec:    { model: 'gpt-4o',      provider: 'openai', temperature: 0.3, maxTokens: 16384 },
  builder: { model: 'gpt-4o',      provider: 'openai', temperature: 0.2, maxTokens: 16384 },
  qa:      { model: 'gpt-4o',      provider: 'openai', temperature: 0.3, maxTokens: 16384 },
  polish:  { model: 'gpt-4o-mini', provider: 'openai', temperature: 0.2, maxTokens: 16384 },
};

const VALID_PROVIDERS: readonly LLMProvider[] = ['openai', 'anthropic', 'azure', 'google', 'local'];

// ── Loader ─────────────────────────────────────────────────

function envKey(role: AgentRole): string {
  return role.toUpperCase();
}

function parseProvider(raw: string | undefined, fallback: LLMProvider): LLMProvider {
  if (!raw) return fallback;
  const v = raw.toLowerCase().trim() as LLMProvider;
  if (!VALID_PROVIDERS.includes(v)) {
    throw new Error(`Invalid provider "${raw}" — must be one of: ${VALID_PROVIDERS.join(', ')}`);
  }
  return v;
}

function parseNumber(raw: string | undefined, fallback: number, label: string): number {
  if (!raw) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for ${label}: "${raw}"`);
  return n;
}

function loadRoleConfig(role: AgentRole): RoleModelConfig {
  const KEY = envKey(role);
  const def = ROLE_DEFAULTS[role];

  const modelRaw = process.env[`MODEL_${KEY}`];
  const fromEnv  = Boolean(modelRaw && modelRaw.trim());
  const model    = fromEnv ? modelRaw!.trim() : def.model;

  const provider     = parseProvider(process.env[`MODEL_${KEY}_PROVIDER`], def.provider);
  const temperature  = parseNumber(process.env[`MODEL_${KEY}_TEMPERATURE`], def.temperature, `MODEL_${KEY}_TEMPERATURE`);
  const maxTokens    = parseNumber(process.env[`MODEL_${KEY}_MAX_TOKENS`],  def.maxTokens,   `MODEL_${KEY}_MAX_TOKENS`);

  const primary: ModelConfig = { provider, model, temperature, maxTokens };

  // Explicit fallback only — never inferred.
  let fallback: ModelConfig | undefined;
  const fbModel = process.env[`MODEL_${KEY}_FALLBACK`]?.trim();
  if (fbModel) {
    const fbProvider = parseProvider(process.env[`MODEL_${KEY}_FALLBACK_PROVIDER`], provider);
    fallback = { provider: fbProvider, model: fbModel, temperature, maxTokens };
  }

  return { primary, fallback, fromEnv };
}

function build(): ModelConfigMap {
  return {
    spec:    loadRoleConfig('spec'),
    builder: loadRoleConfig('builder'),
    qa:      loadRoleConfig('qa'),
    polish:  loadRoleConfig('polish'),
  };
}

/** Singleton — built once on first import. */
export const MODEL_CONFIG: ModelConfigMap = build();

// ── Provider Display Names ─────────────────────────────────

const PROVIDER_LABEL: Record<LLMProvider, string> = {
  openai:    'OpenAI',
  anthropic: 'Anthropic',
  azure:     'Azure OpenAI',
  google:    'Google',
  local:     'Local',
};

export function describeModel(m: ModelConfig): string {
  return `${m.model} (${PROVIDER_LABEL[m.provider] ?? m.provider})`;
}

// ── Startup Validation ─────────────────────────────────────

export interface ModelValidationResult {
  ok: boolean;
  warnings: string[];
  errors: string[];
}

/**
 * Validate the loaded MODEL_CONFIG against available API keys.
 *
 * - error  : provider needs a key but none is configured (cannot start)
 * - warning: env var was missing and a default was used
 */
export function validateModelConfig(opts: {
  hasOpenAIKey: boolean;
  hasAnthropicKey: boolean;
  hasGoogleKey: boolean;
  hasAzureOpenAI?: boolean;
}): ModelValidationResult {
  const warnings: string[] = [];
  const errors: string[]   = [];

  const providerKey: Record<LLMProvider, boolean> = {
    openai:    opts.hasOpenAIKey,
    anthropic: opts.hasAnthropicKey,
    azure:     Boolean(opts.hasAzureOpenAI),
    google:    opts.hasGoogleKey,
    local:     true,
  };

  for (const role of Object.keys(MODEL_CONFIG) as AgentRole[]) {
    const cfg = MODEL_CONFIG[role];
    const KEY = envKey(role);

    if (!cfg.fromEnv) {
      warnings.push(`MODEL_${KEY} not set — using default: ${describeModel(cfg.primary)}`);
    }

    if (!providerKey[cfg.primary.provider]) {
      errors.push(`MODEL_${KEY}=${cfg.primary.model} requires ${cfg.primary.provider.toUpperCase()}_API_KEY`);
    }

    if (cfg.fallback && !providerKey[cfg.fallback.provider]) {
      errors.push(`MODEL_${KEY}_FALLBACK=${cfg.fallback.model} requires ${cfg.fallback.provider.toUpperCase()}_API_KEY`);
    }
  }

  return { ok: errors.length === 0, warnings, errors };
}

/** Log a one-line summary per agent at startup. */
export function logActiveModels(logger: Logger): void {
  for (const role of Object.keys(MODEL_CONFIG) as AgentRole[]) {
    const cfg = MODEL_CONFIG[role];
    const label = role.toUpperCase();
    const primary = describeModel(cfg.primary);
    const fb = cfg.fallback ? `, fallback ${describeModel(cfg.fallback)}` : ', no fallback';
    logger.info(`${label} agent using: ${primary}${fb}`);
  }
}
