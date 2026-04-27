import type { AgentRole } from '../../../../packages/agent-core/src/types.js';

// â”€â”€ Public API Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface GenerateRequest {
  prompts: string[];
  userId?: string;
  preferences?: Record<string, unknown>;
}

export interface UpdateRequest {
  /** Existing project to update. */
  projectId: string;
  /** New prompts describing the desired changes. */
  prompts: string[];
  userId?: string;
  preferences?: Record<string, unknown>;
  /**
   * Scope hint for how much of the pipeline to re-run.
   * - 'code'   — Reuse spec; re-run builder + qa + polish.
   * - 'design' — Reuse spec; re-run builder + qa + polish (treated like 'code' in 4-agent pipeline).
   * - 'full'   — Re-run the complete pipeline (spec → builder → qa → polish).
   */
  scope?: 'code' | 'design' | 'full';
  /**
   * Structured runtime-validator feedback. When set, the QA agent receives
   * this as input.runtimeFeedback so it can treat live-preview failures as
   * CRITICAL issues and patch them. Bypasses the need for the LLM to parse
   * a prose prompt describing the runtime issues.
   */
  runtimeFeedback?: {
    issues: { category: string; message: string; hint?: string; rootCause?: string }[];
    log?: string;
    bodySample?: string;
    systemChecks?: {
      frontend?: { ok: boolean; status?: number; note?: string };
      backendHealth?: { ok: boolean; status?: number; note?: string };
      database?: { ok: boolean; note?: string };
      apiEndpoints?: Array<{ id: string; method: string; path: string; status?: number; ok: boolean; note?: string }>;
      scenarios?: Array<{ name: string; ok: boolean; steps: Array<{ step: string; ok: boolean; note?: string }> }>;
    };
  };
}

export interface GenerateResult {
  projectId: string;
  sessionId: string;
  success: boolean;
  cached?: boolean;
  project?: import('../storage/project-store.js').ProjectRecord;
  steps?: StepSummary[];
  optimization?: {
    requestCacheHit: boolean;
    pipelineCacheHits: number;
    pipelineCacheMisses: number;
    skippedSteps: number;
    estimatedApiCallsSaved: number;
  };
  error?: string;
}

export interface UpdateResult {
  projectId: string;
  sessionId: string;
  success: boolean;
  project?: import('../storage/project-store.js').ProjectRecord;
  version?: number;
  diffs?: import('../storage/project-store.js').FileDiff[];
  steps?: StepSummary[];
  error?: string;
}

export interface StepSummary {
  stepId: string;
  name: string;
  agent: AgentRole;
  status: string;
  durationMs: number;
  error?: string;
}

// â”€â”€ Internal File Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export interface ProjectFile {
  path: string;
  content: string;
  language?: string;
}

export interface Patch {
  file: string;
  oldContent: string;
  newContent: string;
}

export interface EnvVarSpec {
  name: string;
  description?: string;
  required?: boolean;
  example?: string;
}
