// In-memory MemoryStore implementation for testing and lightweight environments.

import type { AgentRole, MemoryEntry, MemoryQuery, MemoryType } from './types';
import type { MemoryStore, MemoryEntryInput } from './base-agent';

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

    if (query.roles)  results = results.filter(e => query.roles!.includes(e.agentRole as AgentRole));
    if (query.includeGlobal) results.push(...this.longTerm.filter(e => e.agentRole === 'global'));
    if (query.types)  { const ts = new Set<MemoryType>(query.types); results = results.filter(e => ts.has(e.type)); }
    if (query.tags)   results = results.filter(e => query.tags!.every(t => e.tags.includes(t)));
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
    else         { entry.failureCount++; entry.relevanceScore = Math.max(entry.relevanceScore - 0.05, 0); }
    const total = entry.successCount + entry.failureCount;
    entry.effectiveness = total > 0 ? entry.successCount / total : NaN;
  }

  async embed(_text: string): Promise<number[]> {
    return new Array(1536).fill(0).map(() => Math.random());
  }
}
