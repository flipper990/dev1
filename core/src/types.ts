// ─── Agent Roles ─────────────────────────────────────────────────────────────

export type AgentRole =
  | 'planner'
  | 'architect'
  | 'coder'
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

export interface Project {
  id: string;
  name: string;
  prompt: string;
  preferences?: ProjectPreferences;
  artifacts: ProjectArtifacts;
  status: PipelineStatus;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  costUsd?: number;
  tokensUsed?: number;
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
