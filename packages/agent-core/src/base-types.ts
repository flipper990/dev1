// Primitive agent enum types — no dependencies.
// Imported by memory-types.ts and types.ts to avoid circular imports.

export type AgentRole =
  | 'intent_expander'
  | 'planner'
  | 'architect'
  | 'developer'
  | 'reviewer'
  | 'tester'
  | 'debugger'
  | 'devops'
  | 'optimizer'
  | 'quality_enforcer';

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
