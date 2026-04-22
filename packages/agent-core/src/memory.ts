// ─────────────────────────────────────────────────────────────
// Memory Manager — Short-term (Redis) + Long-term (pgvector)
// ─────────────────────────────────────────────────────────────

import type { AgentRole, MemoryEntry, MemoryQuery, MemoryType } from './types';
import type { MemoryStore, MemoryEntryInput, Logger } from './base-agent';

// ── Interfaces for storage backends ─────────────────────────

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

// ── Memory Manager Implementation ───────────────────────────

export class MemoryManager implements MemoryStore {
  private redis: RedisMemoryBackend;
  private pg: PgVectorBackend;
  private embedder: EmbeddingClient;
  private logger: Logger;
  private embeddingModel: string;
  private shortTermTtl: number;      // seconds
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
    this.shortTermTtl = config.shortTermTtlSeconds ?? 3600; // 1 hour
    this.maxShortTermPerAgent = config.maxShortTermPerAgent ?? 50;
  }

  // ── Short-Term Memory (Redis) ───────────────────────────

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

  async setShortTerm(
    sessionId: string,
    entry: MemoryEntryInput,
  ): Promise<void> {
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
      // Trim to max entries
      await this.redis.ltrim(key, 0, this.maxShortTermPerAgent - 1);
    } catch (err) {
      this.logger.warn(`Failed to set short-term memory for ${entry.agentRole}`, { error: (err as Error).message });
    }
  }

  // ── Long-Term Memory (pgvector) ─────────────────────────

  async queryLongTerm(agentRole: AgentRole, embedding: number[], limit: number): Promise<MemoryEntry[]> {
    try {
      const results = await this.pg.query<MemoryEntry>(
        `SELECT id, agent_role as "agentRole", memory_type as "type", content,
                relevance_score as "relevanceScore", created_at as "createdAt",
                last_accessed as "lastAccessed", access_count as "accessCount", metadata
         FROM agent_memory
         WHERE agent_role = $1
           AND memory_type != 'context'
           AND relevance_score > 0.1
         ORDER BY embedding <=> $2::vector
         LIMIT $3`,
        [agentRole, JSON.stringify(embedding), limit],
      );

      // Update access timestamps for retrieved memories
      if (results.length > 0) {
        const ids = results.map(r => r.id);
        await this.pg.execute(
          `UPDATE agent_memory
           SET last_accessed = NOW(),
               access_count = access_count + 1,
               relevance_score = LEAST(relevance_score + 0.2, 2.0)
           WHERE id = ANY($1::uuid[])`,
          [ids],
        );
      }

      return results;
    } catch (err) {
      this.logger.warn(`Failed to query long-term memory for ${agentRole}`, { error: (err as Error).message });
      return [];
    }
  }

  async saveLongTerm(
    entry: MemoryEntryInput,
  ): Promise<void> {
    try {
      // Check for near-duplicates using cosine similarity
      if (entry.embedding) {
        const duplicates = await this.pg.query<{ id: string; similarity: number }>(
          `SELECT id, 1 - (embedding <=> $1::vector) as similarity
           FROM agent_memory
           WHERE agent_role = $2
             AND 1 - (embedding <=> $1::vector) > 0.92
           LIMIT 1`,
          [JSON.stringify(entry.embedding), entry.agentRole],
        );

        if (duplicates.length > 0) {
          // Update existing entry instead of creating duplicate
          await this.pg.execute(
            `UPDATE agent_memory
             SET content = $1,
                 relevance_score = LEAST(relevance_score + 0.3, 2.0),
                 last_accessed = NOW(),
                 access_count = access_count + 1,
                 metadata = $2
             WHERE id = $3`,
            [entry.content, JSON.stringify(entry.metadata), duplicates[0].id],
          );
          this.logger.debug(`Updated existing memory entry (similarity: ${duplicates[0].similarity.toFixed(3)})`);
          return;
        }
      }

      await this.pg.execute(
        `INSERT INTO agent_memory (agent_role, memory_type, content, embedding, relevance_score, metadata)
         VALUES ($1, $2, $3, $4::vector, $5, $6)`,
        [
          entry.agentRole,
          entry.type,
          entry.content,
          entry.embedding ? JSON.stringify(entry.embedding) : null,
          entry.relevanceScore,
          JSON.stringify(entry.metadata),
        ],
      );
    } catch (err) {
      this.logger.warn(`Failed to save long-term memory for ${entry.agentRole}`, { error: (err as Error).message });
    }
  }

  // ── Embedding ───────────────────────────────────────────

  async embed(text: string): Promise<number[]> {
    try {
      return await this.embedder.embed(text, this.embeddingModel);
    } catch (err) {
      this.logger.warn('Embedding failed, returning empty vector', { error: (err as Error).message });
      return [];
    }
  }

  // ── Advanced Query (pgvector-backed) ────────────────────

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    try {
      const conditions: string[] = ['1 = 1'];
      const params: unknown[] = [];
      let paramIdx = 1;

      if (query.roles && query.roles.length > 0) {
        conditions.push(`agent_role = ANY($${paramIdx}::text[])`);
        params.push(query.roles);
        paramIdx++;
      }

      if (query.types && query.types.length > 0) {
        conditions.push(`memory_type = ANY($${paramIdx}::text[])`);
        params.push(query.types);
        paramIdx++;
      }

      if (query.minRelevance !== undefined) {
        conditions.push(`relevance_score >= $${paramIdx}`);
        params.push(query.minRelevance);
        paramIdx++;
      }

      if (query.minEffectiveness !== undefined) {
        conditions.push(`effectiveness >= $${paramIdx}`);
        params.push(query.minEffectiveness);
        paramIdx++;
      }

      if (query.tags && query.tags.length > 0) {
        conditions.push(`tags @> $${paramIdx}::jsonb`);
        params.push(JSON.stringify(query.tags));
        paramIdx++;
      }

      const limit = query.limit ?? 10;
      conditions.push(`1 = 1`);

      let orderBy = 'relevance_score DESC';
      if (query.queryText) {
        const embedding = await this.embed(query.queryText);
        if (embedding.length > 0) {
          conditions.push(`embedding IS NOT NULL`);
          orderBy = `embedding <=> $${paramIdx}::vector`;
          params.push(JSON.stringify(embedding));
          paramIdx++;
        }
      }

      const sql = `SELECT id, agent_role as "agentRole", memory_type as "type", content,
                          relevance_score as "relevanceScore", tags, success_count as "successCount",
                          failure_count as "failureCount", effectiveness,
                          created_at as "createdAt", last_accessed as "lastAccessed",
                          access_count as "accessCount", metadata
                   FROM agent_memory
                   WHERE ${conditions.join(' AND ')}
                   ORDER BY ${orderBy}
                   LIMIT ${limit}`;

      return await this.pg.query<MemoryEntry>(sql, params);
    } catch (err) {
      this.logger.warn('Memory query failed', { error: (err as Error).message });
      return [];
    }
  }

  // ── Global Shared Memory ────────────────────────────────

  async getGlobal(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.query({ ...query, roles: ['global'] });
  }

  async saveGlobal(entry: MemoryEntryInput): Promise<void> {
    await this.saveLongTerm({ ...entry, agentRole: 'global' });
  }

  // ── Feedback Loop ───────────────────────────────────────

  async recordOutcome(entryId: string, success: boolean): Promise<void> {
    try {
      if (success) {
        await this.pg.execute(
          `UPDATE agent_memory
           SET success_count = success_count + 1,
               relevance_score = LEAST(relevance_score + 0.1, 2.0),
               effectiveness = success_count::float / GREATEST(success_count + failure_count, 1)
           WHERE id = $1`,
          [entryId],
        );
      } else {
        await this.pg.execute(
          `UPDATE agent_memory
           SET failure_count = failure_count + 1,
               relevance_score = GREATEST(relevance_score - 0.05, 0),
               effectiveness = success_count::float / GREATEST(success_count + failure_count, 1)
           WHERE id = $1`,
          [entryId],
        );
      }
    } catch (err) {
      this.logger.warn('Failed to record memory outcome', { error: (err as Error).message });
    }
  }

  // ── Maintenance ─────────────────────────────────────────

  /** Run daily: decay scores and archive old low-relevance memories */
  async runDecay(): Promise<{ decayed: number; archived: number }> {
    // Decay all scores by 5%
    const decayResult = await this.pg.query<{ count: number }>(
      `WITH updated AS (
         UPDATE agent_memory
         SET relevance_score = relevance_score * 0.95
         WHERE relevance_score > 0.1
         RETURNING 1
       )
       SELECT count(*)::int as count FROM updated`,
      [],
    );

    // Archive (soft delete) memories below threshold that haven't been accessed in 90 days
    const archiveResult = await this.pg.query<{ count: number }>(
      `WITH archived AS (
         DELETE FROM agent_memory
         WHERE relevance_score < 0.1
           AND last_accessed < NOW() - INTERVAL '90 days'
         RETURNING 1
       )
       SELECT count(*)::int as count FROM archived`,
      [],
    );

    const decayed = decayResult[0]?.count ?? 0;
    const archived = archiveResult[0]?.count ?? 0;

    this.logger.info(`Memory decay complete`, { decayed, archived });
    return { decayed, archived };
  }

  /** Get memory statistics for monitoring */
  async getStats(): Promise<{
    totalEntries: number;
    byAgent: Record<string, number>;
    byType: Record<string, number>;
    avgRelevance: number;
  }> {
    const total = await this.pg.query<{ count: number }>(
      'SELECT count(*)::int as count FROM agent_memory',
      [],
    );
    const byAgent = await this.pg.query<{ role: string; count: number }>(
      'SELECT agent_role as role, count(*)::int as count FROM agent_memory GROUP BY agent_role',
      [],
    );
    const byType = await this.pg.query<{ type: string; count: number }>(
      'SELECT memory_type as type, count(*)::int as count FROM agent_memory GROUP BY memory_type',
      [],
    );
    const avg = await this.pg.query<{ avg: number }>(
      'SELECT avg(relevance_score)::float as avg FROM agent_memory',
      [],
    );

    return {
      totalEntries: total[0]?.count ?? 0,
      byAgent: Object.fromEntries(byAgent.map(r => [r.role, r.count])),
      byType: Object.fromEntries(byType.map(r => [r.type, r.count])),
      avgRelevance: avg[0]?.avg ?? 0,
    };
  }

  // ── Helpers ─────────────────────────────────────────────

  private shortTermKey(sessionId: string, agentRole: AgentRole): string {
    return `stm:${sessionId}:${agentRole}`;
  }
}

// ── In-Memory Implementation (testing) ──────────────────────

export class InMemoryMemoryStore implements MemoryStore {
  private shortTerm: Map<string, MemoryEntry[]> = new Map();
  private longTerm: MemoryEntry[] = [];

  private hydrate(entry: MemoryEntryInput): MemoryEntry {
    return {
      ...entry,
      tags: entry.tags ?? [],
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      successCount: 0,
      failureCount: 0,
      effectiveness: NaN,
    };
  }

  async getShortTerm(sessionId: string, agentRole: AgentRole, limit: number): Promise<MemoryEntry[]> {
    const key = `${sessionId}:${agentRole}`;
    return (this.shortTerm.get(key) ?? []).slice(0, limit);
  }

  async setShortTerm(sessionId: string, entry: MemoryEntryInput): Promise<void> {
    const key = `${sessionId}:${entry.agentRole}`;
    const list = this.shortTerm.get(key) ?? [];
    list.unshift(this.hydrate(entry));
    this.shortTerm.set(key, list.slice(0, 50));
  }

  async queryLongTerm(agentRole: AgentRole, _embedding: number[], limit: number): Promise<MemoryEntry[]> {
    // Composite score: relevance × effectiveness × recency (halves every 30 days)
    const score = (e: MemoryEntry): number => {
      const eff = isNaN(e.effectiveness) ? 0.5 : Math.max(e.effectiveness, 0.1);
      const daysSince = (Date.now() - new Date(e.lastAccessed).getTime()) / 86_400_000;
      return e.relevanceScore * eff * (1 / (1 + daysSince / 30));
    };
    return this.longTerm
      .filter(e => e.agentRole === agentRole && e.type !== 'context')
      .sort((a, b) => score(b) - score(a))
      .slice(0, limit);
  }

  async saveLongTerm(entry: MemoryEntryInput): Promise<void> {
    this.longTerm.push(this.hydrate(entry));
  }

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    let results = [...this.longTerm];

    if (query.roles) results = results.filter(e => query.roles!.includes(e.agentRole as AgentRole));
    if (query.includeGlobal) results.push(...this.longTerm.filter(e => e.agentRole === 'global'));
    if (query.types) {
      const ts = new Set<MemoryType>(query.types);
      results = results.filter(e => ts.has(e.type));
    }
    if (query.tags) results = results.filter(e => query.tags!.every(t => e.tags.includes(t)));
    if (query.minRelevance !== undefined) results = results.filter(e => e.relevanceScore >= query.minRelevance!);
    if (query.minEffectiveness !== undefined) results = results.filter(e => !isNaN(e.effectiveness) && e.effectiveness >= query.minEffectiveness!);

    return results.sort((a, b) => b.relevanceScore - a.relevanceScore).slice(0, query.limit ?? 10);
  }

  async getGlobal(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.query({ ...query, roles: ['global'] });
  }

  async saveGlobal(entry: MemoryEntryInput): Promise<void> {
    await this.saveLongTerm({ ...entry, agentRole: 'global' });
  }

  async recordOutcome(entryId: string, success: boolean): Promise<void> {
    const entry = this.longTerm.find(e => e.id === entryId);
    if (!entry) return;
    if (success) { entry.successCount++; entry.relevanceScore = Math.min(entry.relevanceScore + 0.1, 2.0); }
    else { entry.failureCount++; entry.relevanceScore = Math.max(entry.relevanceScore - 0.05, 0); }
    const total = entry.successCount + entry.failureCount;
    entry.effectiveness = total > 0 ? entry.successCount / total : NaN;
  }

  async embed(_text: string): Promise<number[]> {
    return new Array(1536).fill(0).map(() => Math.random());
  }
}
