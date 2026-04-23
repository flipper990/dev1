// ─── Agent Roles ─────────────────────────────────────────────────────────────

export type AgentRole =
  | 'intent_analyzer'
  | 'planner'
  | 'architect'
  | 'ui_ux'
  | 'coder'
  | 'integration'
  | 'reviewer'
  | 'tester'
  | 'debugger'
  | 'devops'
  | 'optimizer';

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export type PipelineStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

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
  optimization: OptimizationMetrics;
}

export interface OptimizationMetrics {
  cacheHits: number;
  cacheMisses: number;
  skippedSteps: number;
  executedSteps: number;
  estimatedApiCallsSaved: number;
}

// ─── Project ──────────────────────────────────────────────────────────────────

export interface ProjectFile {
  path: string;
  content: string;
  language?: string;
}

export interface ProjectArtifacts {
  files: ProjectFile[];
  plan?: string;
  architecture?: string;
  testSuite?: string;
  reviewNotes?: string;
  deploymentConfig?: string;
}

export interface PromptHistoryEntry {
  text: string;
  createdAt: string;
  sessionId?: string;
  /** Union of added + modified + removed. Kept for backward compat. */
  changedFiles?: string[];
  /** Paths newly created by this iteration. */
  added?: string[];
  /** Paths whose content was rewritten by this iteration. */
  modified?: string[];
  /** Paths explicitly removed by this iteration. */
  removed?: string[];
  /** Which version snapshot was taken before this iteration ran. */
  snapshotVersionId?: string;
}

export interface ProjectVersion {
  id: string;
  createdAt: string;
  promptText: string;
  files: ProjectFile[];
  summary?: string;
}

export interface Project {
  id: string;
  name: string;
  /** The most recent prompt (kept for backward compat) */
  prompt: string;
  /** Full history of all prompts submitted against this project */
  prompts?: PromptHistoryEntry[];
  /** Saved versions for rollback */
  versions?: ProjectVersion[];
  preferences?: ProjectPreferences;
  artifacts: ProjectArtifacts;
  status: PipelineStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  costUsd?: number;
  tokensUsed?: number;
  /** Total number of completed generations + updates run against this project. */
  generationCount?: number;
  /** Optional per-project overrides for cost limits (fall back to config defaults). */
  limits?: ProjectLimits;
  error?: string;
}

export interface ProjectLimits {
  maxGenerations?: number;
  maxCostUsd?: number;
}

export interface ProjectPreferences {
  language?: string;
  framework?: string;
  testFramework?: string;
  includeDocker?: boolean;
  includeCI?: boolean;
  targetCloud?: 'vercel' | 'aws' | 'gcp' | 'azure' | 'none';
}

// ─── Memory ───────────────────────────────────────────────────────────────────

export interface MemoryEntry {
  id: string;
  agentRole: AgentRole | 'global';
  sessionId: string;
  projectId: string;
  content: string;
  embedding?: number[];
  relevanceScore?: number;
  tags: string[];
  createdAt: string;
  expiresAt?: string;
}

export interface MemoryQuery {
  agentRole?: AgentRole | 'global';
  sessionId?: string;
  tags?: string[];
  limit?: number;
  textQuery?: string;
}

// ─── LLM Routing ─────────────────────────────────────────────────────────────

export type LLMProvider = 'openai' | 'anthropic' | 'google' | 'together';

export interface LLMModel {
  id: string;
  provider: LLMProvider;
  contextWindow: number;
  maxOutputTokens: number;
  inputCostPer1kTokens: number;
  outputCostPer1kTokens: number;
  supportsStreaming: boolean;
  supportsVision: boolean;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
  stream?: boolean;
  agentRole?: AgentRole;
}

export interface LLMResponse {
  content: string;
  model: string;
  provider: LLMProvider;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  durationMs: number;
  cached?: boolean;
}

// ─── Events ───────────────────────────────────────────────────────────────────

export type SessionEventType =
  | 'session.started'
  | 'session.completed'
  | 'session.failed'
  | 'step.started'
  | 'step.completed'
  | 'step.failed'
  | 'step.skipped'
  | 'step.token'
  | 'log';

export interface SessionEvent {
  type: SessionEventType;
  sessionId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export interface CreateProjectRequest {
  prompt: string;
  preferences?: ProjectPreferences;
}

export interface CreateProjectResponse {
  projectId: string;
  sessionId: string;
  status: PipelineStatus;
}

export interface GetProjectResponse {
  project: Project;
  pipeline?: PipelineState;
}

export interface ApiError {
  error: string;
  code: string;
  statusCode: number;
  details?: unknown;
}
