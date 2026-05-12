import type { AgentRole } from '../types';

export type SkillId =
  | 'stack-selection'
  | 'dependency-repair'
  | 'preview-health'
  | 'backend-contract'
  | 'budget-check'
  | 'test-gaps'
  | 'export-readiness';

export type SkillValidatorId =
  | 'tech-stack'
  | 'dependency-validator'
  | 'preview-validator'
  | 'implementation-completeness'
  | 'final-integrity-gate'
  | 'quality-assurance'
  | 'production-polish-audit'
  | 'generation-budget';

export interface DevteamSkill {
  id: SkillId;
  name: string;
  description: string;
  agentRoles: AgentRole[];
  whenToUse: string;
  promptInstructions: string;
  maxTokenBudget: number;
  relatedValidators: SkillValidatorId[];
  version: string;
}

export interface SkillSelectionContext {
  role: AgentRole;
  prompts?: string[];
  spec?: Record<string, unknown>;
  userPreferences?: Record<string, unknown>;
  files?: Array<{ path: string; content?: string; language?: string }>;
  filesManifest?: Array<{ path: string; kind?: string }>;
  qaFeedback?: Record<string, unknown>;
  runtimeFeedback?: Record<string, unknown>;
  phase?: string;
  currentSlice?: {
    id?: string;
    apiIds?: string[];
    dbTables?: string[];
    routes?: string[];
    components?: string[];
  };
  budget?: {
    enabled?: boolean;
    percentUsed?: number | null;
    hardStopEnabled?: boolean;
  };
}

export interface SkillRegistryEntry {
  skill: DevteamSkill;
  isRelevant: (ctx: SkillSelectionContext) => boolean;
}
