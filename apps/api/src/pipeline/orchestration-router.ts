import type { PromptTierClassification } from './prompt-tier-classifier.js';

export type GenerationPath = 'tier1-fast' | 'tier2-structured' | 'tier3-contract-first' | 'legacy';
export type ValidationDepth = 'light' | 'medium' | 'deep';

export interface TierRuntimeBudgets {
  timeoutMs: number;
  retryBudget: number;
}

export interface OrchestrationRouteDecision {
  tier: PromptTierClassification;
  generationPath: GenerationPath;
  allowedFilesPolicy: 'tier1-frontend-only' | 'tier2-structured-frontend' | 'tier3-fullstack-contract';
  requiredWorkers: string[];
  validationDepth: ValidationDepth;
  previewStrategy: 'quick' | 'standard' | 'integration';
  exportStrategy: 'standard';
  qaPolicy: 'lightweight' | 'standard' | 'contract-first';
  budgets: TierRuntimeBudgets;
}

export interface OrchestrationRouterConfig {
  tier1FastEnabled: boolean;
  tier2StructuredEnabled: boolean;
  tier3ContractFirstEnabled: boolean;
  tier1: TierRuntimeBudgets;
  tier2: TierRuntimeBudgets;
  tier3: TierRuntimeBudgets;
}

export function routeOrchestrationTier(
  tier: PromptTierClassification,
  cfg: OrchestrationRouterConfig,
): OrchestrationRouteDecision {
  if (tier === 'TIER_1_FRONTEND_ONLY' && cfg.tier1FastEnabled) {
    return {
      tier,
      generationPath: 'tier1-fast',
      allowedFilesPolicy: 'tier1-frontend-only',
      requiredWorkers: ['page-structure', 'components', 'styles', 'mock-data', 'validation'],
      validationDepth: 'light',
      previewStrategy: 'quick',
      exportStrategy: 'standard',
      qaPolicy: 'lightweight',
      budgets: cfg.tier1,
    };
  }

  if (tier === 'TIER_2_STRUCTURED_APP' && cfg.tier2StructuredEnabled) {
    return {
      tier,
      generationPath: 'tier2-structured',
      allowedFilesPolicy: 'tier2-structured-frontend',
      requiredWorkers: [
        'app-planner',
        'route-page',
        'components',
        'state-form',
        'mock-data',
        'validation',
        'assembly',
      ],
      validationDepth: 'medium',
      previewStrategy: 'standard',
      exportStrategy: 'standard',
      qaPolicy: 'standard',
      budgets: cfg.tier2,
    };
  }

  if (tier === 'TIER_3_FULLSTACK' && cfg.tier3ContractFirstEnabled) {
    return {
      tier,
      generationPath: 'tier3-contract-first',
      allowedFilesPolicy: 'tier3-fullstack-contract',
      requiredWorkers: [
        'product-spec',
        'architecture',
        'contract',
        'frontend',
        'backend',
        'database-schema',
        'integration',
        'validator',
      ],
      validationDepth: 'deep',
      previewStrategy: 'integration',
      exportStrategy: 'standard',
      qaPolicy: 'contract-first',
      budgets: cfg.tier3,
    };
  }

  return {
    tier,
    generationPath: 'legacy',
    allowedFilesPolicy: tier === 'TIER_1_FRONTEND_ONLY' ? 'tier1-frontend-only' : 'tier3-fullstack-contract',
    requiredWorkers: ['legacy-spec', 'legacy-builder', 'legacy-qa', 'legacy-polish'],
    validationDepth: 'deep',
    previewStrategy: 'integration',
    exportStrategy: 'standard',
    qaPolicy: 'standard',
    budgets: tier === 'TIER_1_FRONTEND_ONLY' ? cfg.tier1 : (tier === 'TIER_2_STRUCTURED_APP' ? cfg.tier2 : cfg.tier3),
  };
}
