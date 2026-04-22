// Maintenance operations for MemoryManager (pgvector backend).
// Extracted to keep MemoryManager under 300 lines.

import type { PgVectorBackend, Logger } from './memory';

/** Decay all memory relevance scores by 5% and archive stale low-relevance entries. */
export async function runDecay(
  pg: PgVectorBackend,
  logger: Logger,
): Promise<{ decayed: number; archived: number }> {
  const decayResult = await pg.query<{ count: number }>(
    `WITH updated AS (
       UPDATE agent_memory
       SET relevance_score = relevance_score * 0.95
       WHERE relevance_score > 0.1
       RETURNING 1
     )
     SELECT count(*)::int as count FROM updated`,
    [],
  );

  const archiveResult = await pg.query<{ count: number }>(
    `WITH archived AS (
       DELETE FROM agent_memory
       WHERE relevance_score < 0.1
         AND last_accessed < NOW() - INTERVAL '90 days'
       RETURNING 1
     )
     SELECT count(*)::int as count FROM archived`,
    [],
  );

  const decayed  = decayResult[0]?.count ?? 0;
  const archived = archiveResult[0]?.count ?? 0;
  logger.info('Memory decay complete', { decayed, archived });
  return { decayed, archived };
}

/** Return memory statistics for monitoring dashboards. */
export async function getMemoryStats(pg: PgVectorBackend): Promise<{
  totalEntries: number;
  byAgent: Record<string, number>;
  byType: Record<string, number>;
  avgRelevance: number;
}> {
  const [total, byAgent, byType, avg] = await Promise.all([
    pg.query<{ count: number }>('SELECT count(*)::int as count FROM agent_memory', []),
    pg.query<{ role: string; count: number }>('SELECT agent_role as role, count(*)::int as count FROM agent_memory GROUP BY agent_role', []),
    pg.query<{ type: string; count: number }>('SELECT memory_type as type, count(*)::int as count FROM agent_memory GROUP BY memory_type', []),
    pg.query<{ avg: number }>('SELECT avg(relevance_score)::float as avg FROM agent_memory', []),
  ]);

  return {
    totalEntries: total[0]?.count ?? 0,
    byAgent: Object.fromEntries(byAgent.map(r => [r.role, r.count])),
    byType:  Object.fromEntries(byType.map(r => [r.type, r.count])),
    avgRelevance: avg[0]?.avg ?? 0,
  };
}
