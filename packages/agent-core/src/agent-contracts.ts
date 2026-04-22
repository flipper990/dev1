// Agent service interfaces and configuration type.
// Imported by base-agent.ts, agent-memory-ops.ts, and orchestrator.ts.

import type {
  AgentHooks,
  AgentMessage,
  AgentMiddleware,
  AgentRole,
  MemoryEntry,
  MemoryQuery,
  ModelConfig,
  PromptConfig,
} from './types';

export interface LLMClient {
  chat(params: {
    model: ModelConfig;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
    stream?: boolean;
  }): AsyncGenerator<string, void, unknown>;

  chatSync(params: {
    model: ModelConfig;
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): Promise<{ content: string; tokensIn: number; tokensOut: number }>;
}

export type MemoryEntryInput = Omit<
  MemoryEntry,
  'id' | 'createdAt' | 'lastAccessed' | 'accessCount' | 'successCount' | 'failureCount' | 'effectiveness'
>;

export interface MemoryStore {
  // Short-term (session-scoped)
  getShortTerm(sessionId: string, agentRole: AgentRole, limit: number): Promise<MemoryEntry[]>;
  setShortTerm(sessionId: string, entry: MemoryEntryInput): Promise<void>;

  // Long-term (persistent)
  queryLongTerm(agentRole: AgentRole, embedding: number[], limit: number): Promise<MemoryEntry[]>;
  saveLongTerm(entry: MemoryEntryInput): Promise<void>;

  // Advanced filtered query
  query(query: MemoryQuery): Promise<MemoryEntry[]>;

  // Global shared memory
  getGlobal(query: MemoryQuery): Promise<MemoryEntry[]>;
  saveGlobal(entry: MemoryEntryInput): Promise<void>;

  // Feedback loop
  recordOutcome(entryId: string, success: boolean): Promise<void>;

  // Embedding
  embed(text: string): Promise<number[]>;
}

export interface MessageBus {
  publish(message: AgentMessage): Promise<void>;
  subscribe(agentRole: AgentRole, handler: (msg: AgentMessage) => Promise<void>): void;
  unsubscribe(agentRole: AgentRole): void;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

export interface AgentConfig {
  hooks?: AgentHooks;
  middleware?: AgentMiddleware[];
  promptOverrides?: Partial<PromptConfig>;
  logIO?: boolean;
  logIOMaxLength?: number;
}
