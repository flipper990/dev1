// Primitive agent enum types — no dependencies.
// Imported by memory-types.ts and types.ts to avoid circular imports.
//
// April 2026 — simplified 4-agent architecture:
//   spec    → intent + planning + architecture (single source of truth)
//   builder → fullstack code generation (frontend + backend)
//   qa      → review + bug fixing + missing-logic patches (loops back to builder)
//   polish  → UI/UX, perf, production-readiness pass

export type AgentRole =
  | 'spec'
  | 'builder'
  | 'qa'
  | 'polish';

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
