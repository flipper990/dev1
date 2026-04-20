// ─── Shared dashboard types ───────────────────────────────────────────────────

export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
export type AgentRole = 'planner' | 'architect' | 'coder' | 'reviewer' | 'tester' | 'debugger' | 'devops' | 'optimizer';

export interface PipelineStep {
  role: AgentRole;
  status: StepStatus;
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  tokensUsed?: number;
  costUsd?: number;
  error?: string;
  skippedReason?: string;
}

export interface PipelineState {
  sessionId: string;
  projectId: string;
  status: PipelineStatus;
  steps: PipelineStep[];
  startedAt: string;
  completedAt?: string;
  totalDurationMs?: number;
  totalCostUsd?: number;
  totalTokens?: number;
  optimization: {
    cacheHits: number;
    cacheMisses: number;
    skippedSteps: number;
    executedSteps: number;
    estimatedApiCallsSaved: number;
  };
}

export interface ProjectFile {
  path: string;
  content: string;
  language?: string;
}

export interface Project {
  id: string;
  name: string;
  prompt: string;
  artifacts: {
    files: ProjectFile[];
    plan?: string;
    reviewNotes?: string;
    testSuite?: string;
    deploymentConfig?: string;
  };
  status: PipelineStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  costUsd?: number;
  tokensUsed?: number;
}

export interface WebSocketEvent {
  type: string;
  data: unknown;
  timestamp: string;
}
