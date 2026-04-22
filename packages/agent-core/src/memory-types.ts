// Memory-related type definitions.
// Kept separate to avoid circular imports with types.ts.

import type { AgentRole } from './base-types';

/** Broad category of what a memory entry represents. */
export type MemoryType =
  | 'context'        // raw task input/output snapshot (short-term)
  | 'pattern'        // successful technique / approach
  | 'failure'        // what went wrong and why
  | 'error_fix'      // problem → solution pair
  | 'decision'       // architectural / design decision
  | 'preference'     // user or system preference
  | 'prompt'         // effective prompt template / strategy
  | 'global';        // cross-agent shared knowledge

/** Tags for fine-grained retrieval filtering. */
export type MemoryTag =
  | 'tech-stack'
  | 'architecture'
  | 'code-style'
  | 'performance'
  | 'security'
  | 'testing'
  | 'deployment'
  | 'api-design'
  | 'database'
  | 'ui-ux'
  | 'error-handling'
  | 'best-practice'
  | 'anti-pattern'
  | 'prompt-engineering'
  | string;  // extensible

export interface MemoryEntry {
  id: string;
  agentRole: AgentRole | 'global';
  type: MemoryType;
  content: string;
  embedding?: number[];
  relevanceScore: number;
  sessionId?: string;
  tags: MemoryTag[];
  createdAt: Date;
  lastAccessed: Date;
  accessCount: number;
  /** How many times this knowledge led to a successful outcome. */
  successCount: number;
  /** How many times this knowledge was present but outcome failed. */
  failureCount: number;
  /** Derived effectiveness = successCount / (successCount + failureCount). NaN if never evaluated. */
  effectiveness: number;
  metadata: Record<string, unknown>;
}

/** Filter criteria for memory retrieval. */
export interface MemoryQuery {
  /** Restrict to specific agent role(s). Omit for all. */
  roles?: (AgentRole | 'global')[];
  /** Restrict to specific memory types. */
  types?: MemoryType[];
  /** Require all of these tags. */
  tags?: MemoryTag[];
  /** Minimum relevance score. */
  minRelevance?: number;
  /** Minimum effectiveness (0–1). */
  minEffectiveness?: number;
  /** Maximum number of results. */
  limit?: number;
  /** Text to embed for semantic search (when vector DB available). */
  queryText?: string;
  /** Include global memories alongside agent-specific ones. */
  includeGlobal?: boolean;
}
