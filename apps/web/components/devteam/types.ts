/**
 * Type system for the DEVteam multi-agent dashboard.
 *
 * Single source of truth for every UI component in `components/devteam/`.
 * No runtime values here — only types, interfaces, and the const-assertion
 * tuples that back the union types.
 */

export const AGENT_ROLES = ['spec', 'build', 'qa', 'polish'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

export const AGENT_STATUSES = ['waiting', 'working', 'done', 'blocked', 'looping'] as const;
export type AgentStatus = (typeof AGENT_STATUSES)[number];

export const PIPELINE_STEPS = ['spec', 'build', 'qa', 'polish', 'deploy'] as const;
export type PipelineStep = (typeof PIPELINE_STEPS)[number];

export const PIPELINE_STEP_STATES = ['pending', 'active', 'completed', 'failed'] as const;
export type PipelineStepState = (typeof PIPELINE_STEP_STATES)[number];

export const PROJECT_STATUSES = ['ready', 'failed', 'building', 'queued'] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

export const PREVIEW_TABS = ['preview', 'code', 'api', 'database', 'logs'] as const;
export type PreviewTab = (typeof PREVIEW_TABS)[number];

export const DEVICE_TYPES = ['desktop', 'tablet', 'mobile'] as const;
export type DeviceType = (typeof DEVICE_TYPES)[number];

export interface Agent {
  id: string;
  role: AgentRole;
  name: string;
  avatar: string;
  status: AgentStatus;
  statusText: string;
  progress: number;
  loopCount?: number;
  logs: string[];
}

export interface PipelineState {
  steps: { id: PipelineStep; label: string; state: PipelineStepState }[];
  isLooping: boolean;
  loopCount: number;
}

export interface Project {
  id: string;
  name: string;
  status: ProjectStatus;
  updatedLabel: string;
  tokens: number;
  colorDot: string;
}

export interface TechStackItem {
  id: string;
  name: string;
  version: string;
  ready: boolean;
}

export interface CodeBlock {
  language: string;
  content: string;
}

export interface ChatMessage {
  id: string;
  author: 'user' | AgentRole;
  authorName: string;
  avatar?: string;
  text: string;
  code?: CodeBlock;
  timestamp: string;
}

export interface SkillBar {
  id: AgentRole;
  label: string;
  value: number;
  waiting?: boolean;
}
