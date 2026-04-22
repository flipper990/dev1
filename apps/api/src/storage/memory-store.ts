// File-based MemoryStore — dev/staging backend, mirrors MemoryManager interface 1:1.
// To upgrade to vector DB: swap for MemoryManager from agent-core/memory.ts.

import type {
  AgentRole,
  MemoryEntry,
  MemoryQuery,
  MemoryType,
} from '../../../packages/agent-core/src/types.js';
import type {
  MemoryStore,
  MemoryEntryInput,
  Logger,
} from '../../../packages/agent-core/src/base-agent.js';
import { jaccardSimilarity, tokenize, textMatchScore } from './memory-text-utils.js';
import { hydrateEntry, touchEntry, rankEntry } from './memory-entry-helpers.js';
import {
  type StoreKey,
  ALL_ROLES,
  loadMemoriesFromDisk,
  persistRoleToDisk,
} from './memory-store-io.js';
import {
  computeMemoryStats,
  getTopPatterns,
  getTopFailures,
  runStoreDecay,
} from './memory-store-ops.js';

// Re-export for backward compatibility
export type { MemoryStats } from './memory-store-ops.js';
export type { StoreKey } from './memory-store-io.js';
export { ALL_ROLES } from './memory-store-io.js';

export class FileMemoryStore implements MemoryStore {
  private baseDir: string;
  private logger: Logger;

  private shortTermStore = new Map<string, MemoryEntry[]>();
  private shortTermExpiry = new Map<string, number>();
  private readonly SHORT_TERM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  private longTermCache = new Map<StoreKey, MemoryEntry[]>();
  private idIndex = new Map<string, StoreKey>();

  private loaded = false;
  private persistDebounce = new Map<StoreKey, ReturnType<typeof setTimeout>>();

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  async init(): Promise<void> {
    if (this.loaded) return;
    const { cache, idIndex } = await loadMemoriesFromDisk(this.baseDir, this.logger);
    this.longTermCache = cache;
    this.idIndex = idIndex;
    this.loaded = true;
  }

  // ── Short-Term Memory (session-scoped, in-memory) ──────────────

  async getShortTerm(sessionId: string, agentRole: AgentRole, limit: number): Promise<MemoryEntry[]> {
    const key = `${sessionId}:${agentRole}`;
    if (this.isShortTermExpired(key)) {
      this.shortTermStore.delete(key);
      this.shortTermExpiry.delete(key);
      return [];
    }
    return (this.shortTermStore.get(key) ?? []).slice(0, limit);
  }

  async setShortTerm(sessionId: string, entry: MemoryEntryInput): Promise<void> {
    const key = `${sessionId}:${entry.agentRole}`;
    const list = this.shortTermStore.get(key) ?? [];
    list.unshift(hydrateEntry(entry));
    if (list.length > 50) list.length = 50;
    this.shortTermStore.set(key, list);
    this.shortTermExpiry.set(key, Date.now() + this.SHORT_TERM_TTL_MS);
  }

  private evictExpiredShortTerm(): number {
    let evicted = 0;
    const now = Date.now();
    for (const [key, expiry] of this.shortTermExpiry) {
      if (now > expiry) {
        this.shortTermStore.delete(key);
        this.shortTermExpiry.delete(key);
        evicted++;
      }
    }
    return evicted;
  }

  private isShortTermExpired(key: string): boolean {
    const expiry = this.shortTermExpiry.get(key);
    return expiry !== undefined && Date.now() > expiry;
  }

  // ── Long-Term Memory (per-agent, persisted to JSON) ────────────

  async queryLongTerm(agentRole: AgentRole, _embedding: number[], limit: number): Promise<MemoryEntry[]> {
    const entries = this.longTermCache.get(agentRole) ?? [];
    return entries
      .filter(e => e.relevanceScore > 0.1)
      .sort((a, b) => rankEntry(b) - rankEntry(a))
      .slice(0, limit)
      .map(e => touchEntry(e));
  }

  async saveLongTerm(entry: MemoryEntryInput): Promise<void> {
    const role = entry.agentRole as StoreKey;
    const entries = this.longTermCache.get(role) ?? [];

    const duplicate = entries.find(e =>
      e.content === entry.content ||
      (e.type === entry.type && jaccardSimilarity(e.content, entry.content) > 0.8),
    );

    if (duplicate) {
      duplicate.relevanceScore = Math.min(duplicate.relevanceScore + 0.3, 2.0);
      duplicate.lastAccessed = new Date();
      duplicate.accessCount++;
      duplicate.content = entry.content;
      if (entry.tags) {
        duplicate.tags = [...new Set([...duplicate.tags, ...entry.tags])];
      }
    } else {
      const full = hydrateEntry(entry);
      entries.push(full);
      this.idIndex.set(full.id, role);
    }

    this.longTermCache.set(role, entries);
    this.debouncedPersist(role);
  }

  // ── Advanced Query ─────────────────────────────────────────────

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const roles = query.roles ?? ALL_ROLES;
    let results: MemoryEntry[] = [];

    for (const role of roles) {
      results.push(...(this.longTermCache.get(role as StoreKey) ?? []));
    }

    if (query.includeGlobal && !roles.includes('global')) {
      results.push(...(this.longTermCache.get('global') ?? []));
    }

    if (query.types?.length) {
      const typeSet = new Set<MemoryType>(query.types);
      results = results.filter(e => typeSet.has(e.type));
    }
    if (query.tags?.length) {
      results = results.filter(e => query.tags!.every(tag => e.tags.includes(tag)));
    }
    if (query.minRelevance !== undefined) {
      results = results.filter(e => e.relevanceScore >= query.minRelevance!);
    }
    if (query.minEffectiveness !== undefined) {
      results = results.filter(e => !isNaN(e.effectiveness) && e.effectiveness >= query.minEffectiveness!);
    }

    if (query.queryText) {
      const queryWords = tokenize(query.queryText);
      results = results
        .map(e => ({ entry: e, score: textMatchScore(queryWords, e.content) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(x => x.entry);
    } else {
      results.sort((a, b) => rankEntry(b) - rankEntry(a));
    }

    return results.slice(0, query.limit ?? 10).map(e => touchEntry(e));
  }

  // ── Global Shared Memory ───────────────────────────────────────

  async getGlobal(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.query({ ...query, roles: ['global'] });
  }

  async saveGlobal(entry: MemoryEntryInput): Promise<void> {
    await this.saveLongTerm({ ...entry, agentRole: 'global' });
  }

  // ── Feedback Loop ──────────────────────────────────────────────

  async recordOutcome(entryId: string, success: boolean): Promise<void> {
    const role = this.idIndex.get(entryId);
    if (!role) return;
    const entry = (this.longTermCache.get(role) ?? []).find(e => e.id === entryId);
    if (!entry) return;

    if (success) {
      entry.successCount++;
      entry.relevanceScore = Math.min(entry.relevanceScore + 0.1, 2.0);
    } else {
      entry.failureCount++;
      entry.relevanceScore = Math.max(entry.relevanceScore - 0.05, 0);
    }
    const total = entry.successCount + entry.failureCount;
    entry.effectiveness = total > 0 ? entry.successCount / total : NaN;
    this.debouncedPersist(role);
  }

  // ── Embedding (stub — no-op until vector DB connected) ─────────

  async embed(_text: string): Promise<number[]> {
    return [];
  }

  // ── Maintenance & Stats ────────────────────────────────────────

  async runDecay(): Promise<{ decayed: number; archived: number }> {
    return runStoreDecay(this.longTermCache, r => this.persistRole(r), () => this.evictExpiredShortTerm(), this.logger);
  }

  clearSession(sessionId: string): void {
    for (const key of this.shortTermStore.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.shortTermStore.delete(key);
        this.shortTermExpiry.delete(key);
      }
    }
  }

  getStats() {
    return computeMemoryStats(this.longTermCache, this.shortTermStore);
  }

  getTopPatterns(limit = 10): MemoryEntry[] {
    return getTopPatterns(this.longTermCache, limit);
  }

  getTopFailures(limit = 10): MemoryEntry[] {
    return getTopFailures(this.longTermCache, limit);
  }

  // ── Disk I/O ───────────────────────────────────────────────────

  private async persistRole(role: StoreKey): Promise<void> {
    await persistRoleToDisk(this.baseDir, role, this.longTermCache.get(role) ?? []);
  }

  private debouncedPersist(role: StoreKey): void {
    const existing = this.persistDebounce.get(role);
    if (existing) clearTimeout(existing);
    this.persistDebounce.set(role, setTimeout(() => {
      this.persistRole(role).catch(err => {
        this.logger.warn(`Failed to persist ${role} memory`, { error: (err as Error).message });
      });
    }, 100));
  }
}
