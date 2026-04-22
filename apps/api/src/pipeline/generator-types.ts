import type { AgentRole } from '../../../packages/agent-core/src/types.js';

// ── Public API Types ────────────────────────────────────────

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
   * - 'code'   — Only code/test/review/debug/optimize steps (reuse planner + architect).
   * - 'design' — Re-run from architect onward (reuse planner only).
   * - 'full'   — Re-run the complete pipeline (same as a fresh generate).
   */
  scope?: 'code' | 'design' | 'full';
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

// ── Internal File Types ─────────────────────────────────────

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
