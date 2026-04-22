// Primitive agent enum types — no dependencies.
// Imported by memory-types.ts and types.ts to avoid circular imports.

export type AgentRole =
  | 'planner'
  | 'architect'
  | 'developer'
  | 'reviewer'
  | 'tester'
  | 'debugger'
  | 'devops'
  | 'optimizer';

export type AgentStatus = 'idle' | 'busy' | 'error' | 'terminated';

export type TaskStatus =
  | 'pending'
  | 'queued'
  | 'in-progress'
  | 'completed'
  | 'failed'
  | 'retrying'
  | 'cancelled';

export type LLMProvider = 'anthropic' | 'openai' | 'google' | 'local';
