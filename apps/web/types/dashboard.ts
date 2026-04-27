export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface DashboardLog {
  id: string;
  ts: string;
  level: 'info' | 'warn' | 'error';
  source: string;
  message: string;
}

export interface PipelineStep {
  stepId: string;
  name: string;
  agent: string;
  status: StepStatus;
  durationMs: number;
  error?: string;
}

export interface SessionProgress {
  sessionId: string;
  status: 'active' | 'completed' | 'failed' | 'cancelled';
  progress: number;
  currentStep: {
    stepId: string;
    name: string;
    agent: string;
    description: string;
    attempt: number;
  } | null;
  steps: PipelineStep[];
  completedAgents: string[];
  failedAgents: string[];
  durationMs: number;
}

export interface PromptHistoryEntry {
  text: string;
  createdAt: string;
  sessionId?: string;
  /** Union of added + modified + removed (compat). */
  changedFiles?: string[];
  added?: string[];
  modified?: string[];
  removed?: string[];
  snapshotVersionId?: string;
}

export interface ProjectVersion {
  id: string;
  createdAt: string;
  promptText: string;
  summary?: string;
  fileCount?: number;
}

export interface GeneratedProject {
  id: string;
  sessionId: string;
  name: string;
  status: 'generating' | 'completed' | 'failed';
  /** Legacy single prompt (kept for compat) */
  prompts: string[];
  /** Full prompt history */
  promptHistory?: PromptHistoryEntry[];
  /** Saved versions for rollback */
  versions?: ProjectVersion[];
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: string;
  completedAt?: string;
  /** Post-build runtime validation result. Populated asynchronously after
   *  generation finishes; absent until the validator runs. */
  runtimeValidation?: {
    finalVerdict: 'pass' | 'fail';
    iterations: number;
    issues: { category: string; message: string; hint?: string }[];
    totalDurationMs: number;
    completedAt: string;
  };
}

export interface ProjectFileEntry {
  path: string;
  size: number;
}

export interface ProjectFileContent {
  path: string;
  content: string;
}

export interface GenerateResponse {
  projectId: string;
  sessionId: string;
  project: {
    id: string;
    name: string;
    status: string;
    fileCount: number;
    totalTokens: number;
    totalCostUsd: number;
    durationMs: number;
  };
}
