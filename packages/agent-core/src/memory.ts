// Memory Manager — Short-term (Redis) + Long-term (pgvector).
// In-memory store (testing) -> ./in-memory-store.ts
// Maintenance functions     -> ./memory-maintenance.ts

import type { AgentRole, MemoryEntry, MemoryQuery } from './types';
import type { MemoryStore, MemoryEntryInput } from './base-agent';
import { runDecay, getMemoryStats } from './memory-maintenance';

// Re-export for backward compatibility
export { InMemoryMemoryStore } from './in-memory-store';

// ── Storage Backend Interfaces ──────────────────────────────────

export interface RedisMemoryBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds?: number): Promise<void>;
  lpush(key: string, value: string): Promise<void>;
  lrange(key: string, start: number, stop: number): Promise<string[]>;
  ltrim(key: string, start: number, stop: number): Promise<void>;
  del(key: string): Promise<void>;
}

export interface PgVectorBackend {
  query<T>(sql: string, params: unknown[]): Promise<T[]>;
  execute(sql: string, params: unknown[]): Promise<void>;
}

export interface EmbeddingClient {
  embed(text: string, model: string): Promise<number[]>;
}

export interface Logger {
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  debug(msg: string, meta?: Record<string, unknown>): void;
}

// ── Memory Manager ──────────────────────────────────────────────

export class MemoryManager implements MemoryStore {
  private redis: RedisMemoryBackend;
  private pg: PgVectorBackend;
  private embedder: EmbeddingClient;
  private logger: Logger;
  private embeddingModel: string;
  private shortTermTtl: number;
  private maxShortTermPerAgent: number;

  constructor(config: {
    redis: RedisMemoryBackend;
    pg: PgVectorBackend;
    embedder: EmbeddingClient;
    logger: Logger;
    embeddingModel?: string;
    shortTermTtlSeconds?: number;
    maxShortTermPerAgent?: number;
  }) {
    this.redis = config.redis;
    this.pg = config.pg;
    this.embedder = config.embedder;
    this.logger = config.logger;
    this.embeddingModel = config.embeddingModel ?? 'text-embedding-3-small';
    this.shortTermTtl = config.shortTermTtlSeconds ?? 3600;
    this.maxShortTermPerAgent = config.maxShortTermPerAgent ?? 50;
  }

  // ── Short-Term (Redis) ──────────────────────────────────────

  async getShortTerm(sessionId: string, agentRole: AgentRole, limit: number): Promise<MemoryEntry[]> {
    const key = this.shortTermKey(sessionId, agentRole);
    try {
      const raw = await this.redis.lrange(key, 0, limit - 1);
      return raw.map(r => JSON.parse(r) as MemoryEntry);
    } catch (err) {
      this.logger.warn(`Failed to get short-term memory for ${agentRole}`, { error: (err as Error).message });
      return [];
    }
  }

  async setShortTerm(sessionId: string, entry: MemoryEntryInput): Promise<void> {
    const key = this.shortTermKey(sessionId, entry.agentRole);
    const full: MemoryEntry = {
      ...entry,
      tags: entry.tags ?? [],
      id: `stm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      successCount: 0,
      failureCount: 0,
      effectiveness: NaN,
    };
    try {
      await this.redis.lpush(key, JSON.stringify(full));
      await this.redis.ltrim(key, 0, this.maxShortTermPerAgent - 1);
    } catch (err) {
      this.logger.warn(`Failed to set short-term memory for ${entry.agentRole}`, { error: (err as Error).message });
    }
  }

  // ── Long-Term (pgvector) ────────────────────────────────────

  async queryLongTerm(agentRole: AgentRole, embedding: number[], limit: number): Promise<MemoryEntry[]> {
    try {
      const results = await this.pg.query<MemoryEntry>(
        `SELECT id, agent_role as "agentRole", memory_type as "type", content,
                relevance_score as "relevanceScore", created_at as "createdAt",
                last_accessed as "lastAccessed", access_count as "accessCount", metadata
         FROM agent_memory
         WHERE agent_role = $1 AND memory_type != 'context' AND relevance_score > 0.1
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [agentRole, JSON.stringify(embedding), limit],
      );
      if (results.length > 0) {
        await this.pg.execute(
          `UPDATE agent_memory
           SET last_accessed = NOW(), access_count = access_count + 1,
               relevance_score = LEAST(relevance_score + 0.2, 2.0)
           WHERE id = ANY($1::uuid[])`,
          [results.map(r => r.id)],
        );
      }
      return results;
    } catch (err) {
      this.logger.warn(`Failed to query long-term memory for ${agentRole}`, { error: (err as Error).message });
      return [];
    }
  }

  async saveLongTerm(entry: MemoryEntryInput): Promise<void> {
    try {
      if (entry.embedding) {
        const dups = await this.pg.query<{ id: string; similarity: number }>(
          `SELECT id, 1 - (embedding <=> $1::vector) as similarity
           FROM agent_memory
           WHERE agent_role = $2 AND 1 - (embedding <=> $1::vector) > 0.92
           LIMIT 1`,
          [JSON.stringify(entry.embedding), entry.agentRole],
        );
        if (dups.length > 0) {
          await this.pg.execute(
            `UPDATE agent_memory
             SET content = $1, relevance_score = LEAST(relevance_score + 0.3, 2.0),
                 last_accessed = NOW(), access_count = access_count + 1, metadata = $2
             WHERE id = $3`,
            [entry.content, JSON.stringify(entry.metadata), dups[0].id],
          );
          return;
        }
      }
      await this.pg.execute(
        `INSERT INTO agent_memory (agent_role, memory_type, content, embedding, relevance_score, metadata)
         VALUES ($1, $2, $3, $4::vector, $5, $6)`,
        [entry.agentRole, entry.type, entry.content, entry.embedding ? JSON.stringify(entry.embedding) : null, entry.relevanceScore, JSON.stringify(entry.metadata)],
      );
    } catch (err) {
      this.logger.warn(`Failed to save long-term memory for ${entry.agentRole}`, { error: (err as Error).message });
    }
  }

  // ── Embedding ───────────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    try {
      return await this.embedder.embed(text, this.embeddingModel);
    } catch (err) {
      this.logger.warn('Embedding failed, returning empty vector', { error: (err as Error).message });
      return [];
    }
  }

  // ── Advanced Query ──────────────────────────────────────────

  async query(q: MemoryQuery): Promise<MemoryEntry[]> {
    try {
      const conditions: string[] = ['1 = 1'];
      const params: unknown[] = [];
      let p = 1;

      if (q.roles?.length)  { conditions.push(`agent_role = ANY($${p++}::text[])`); params.push(q.roles); }
      if (q.types?.length)  { conditions.push(`memory_type = ANY($${p++}::text[])`); params.push(q.types); }
      if (q.minRelevance !== undefined) { conditions.push(`relevance_score >= $${p++}`); params.push(q.minRelevance); }
      if (q.minEffectiveness !== undefined) { conditions.push(`effectiveness >= $${p++}`); params.push(q.minEffectiveness); }
      if (q.tags?.length)   { conditions.push(`tags @> $${p++}::jsonb`); params.push(JSON.stringify(q.tags)); }

      let orderBy = 'relevance_score DESC';
      if (q.queryText) {
        const emb = await this.embed(q.queryText);
        if (emb.length > 0) {
          conditions.push(`embedding IS NOT NULL`);
          orderBy = `embedding <=> $${p++}::vector`;
          params.push(JSON.stringify(emb));
        }
      }

      const sql = `SELECT id, agent_role as "agentRole", memory_type as "type", content,
                          relevance_score as "relevanceScore", tags, success_count as "successCount",
                          failure_count as "failureCount", effectiveness,
                          created_at as "createdAt", last_accessed as "lastAccessed",
                          access_count as "accessCount", metadata
                   FROM agent_memory WHERE ${conditions.join(' AND ')}
                   ORDER BY ${orderBy} LIMIT ${q.limit ?? 10}`;

      return await this.pg.query<MemoryEntry>(sql, params);
    } catch (err) {
      this.logger.warn('Memory query failed', { error: (err as Error).message });
      return [];
    }
  }

  async getGlobal(query: MemoryQuery): Promise<MemoryEntry[]> { return this.query({ ...query, roles: ['global'] }); }
  async saveGlobal(entry: MemoryEntryInput): Promise<void> { await this.saveLongTerm({ ...entry, agentRole: 'global' }); }

  // ── Feedback Loop ───────────────────────────────────────────

  async recordOutcome(entryId: string, success: boolean): Promise<void> {
    try {
      const col = success ? 'success_count' : 'failure_count';
      const delta = success ? '+0.1' : '-0.05';
      await this.pg.execute(
        `UPDATE agent_memory
         SET ${col} = ${col} + 1,
             relevance_score = ${success ? 'LEAST' : 'GREATEST'}(relevance_score ${delta}, ${success ? '2.0' : '0'}),
             effectiveness = success_count::float / GREATEST(success_count + failure_count, 1)
         WHERE id = $1`,
        [entryId],
      );
    } catch (err) {
      this.logger.warn('Failed to record memory outcome', { error: (err as Error).message });
    }
  }

  // ── Maintenance (delegates to standalone functions) ─────────

  async runDecay(): Promise<{ decayed: number; archived: number }> {
    return runDecay(this.pg, this.logger);
  }

  async getStats() {
    return getMemoryStats(this.pg);
  }

  // ── Private ─────────────────────────────────────────────────

  private shortTermKey(sessionId: string, agentRole: AgentRole): string {
    return `stm:${sessionId}:${agentRole}`;
  }
}
