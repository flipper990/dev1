// ─────────────────────────────────────────────────────────────
// File-based Memory Store — Full implementation
//
// Per-agent JSON files + global shared memory + advanced query.
// Designed as the dev/staging backend that mirrors the production
// MemoryManager (Redis + pgvector) interface 1:1.
//
// To upgrade to vector DB: swap this for MemoryManager from
// agent-core/memory.ts — same MemoryStore interface, zero code
// changes elsewhere.
// ─────────────────────────────────────────────────────────────

import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
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

// All roles + 'global'
type StoreKey = AgentRole | 'global';
const ALL_ROLES: StoreKey[] = [
  'planner', 'architect', 'developer', 'reviewer',
  'tester', 'debugger', 'devops', 'optimizer', 'global',
];

export class FileMemoryStore implements MemoryStore {
  private baseDir: string;
  private logger: Logger;

  // In-memory short-term storage (session-scoped, lost on restart)
  private shortTermStore = new Map<string, MemoryEntry[]>();
  // TTL tracking for short-term entries (key → expiry timestamp)
  private shortTermExpiry = new Map<string, number>();
  private readonly SHORT_TERM_TTL_MS = 2 * 60 * 60 * 1000; // 2 hours

  // In-memory cache of long-term memories (persisted to disk)
  private longTermCache = new Map<StoreKey, MemoryEntry[]>();

  // Index: entryId → StoreKey (for fast recordOutcome)
  private idIndex = new Map<string, StoreKey>();

  private loaded = false;
  private persistDebounce = new Map<StoreKey, ReturnType<typeof setTimeout>>();

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
    await this.loadFromDisk();
  }

  // ══════════════════════════════════════════════════════════
  // Short-Term Memory (session-scoped, in-memory)
  // ══════════════════════════════════════════════════════════

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

    list.unshift(this.hydrate(entry));

    if (list.length > 50) list.length = 50;
    this.shortTermStore.set(key, list);
    this.shortTermExpiry.set(key, Date.now() + this.SHORT_TERM_TTL_MS);
  }

  /** Evict expired short-term entries. Called by runDecay(). */
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

  // ══════════════════════════════════════════════════════════
  // Long-Term Memory (per-agent, persisted to JSON)
  // ══════════════════════════════════════════════════════════

  async queryLongTerm(agentRole: AgentRole, _embedding: number[], limit: number): Promise<MemoryEntry[]> {
    const entries = this.longTermCache.get(agentRole) ?? [];
    return entries
      .filter(e => e.relevanceScore > 0.1)
      .sort((a, b) => this.rank(b) - this.rank(a))
      .slice(0, limit)
      .map(e => this.touch(e));
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
      // Merge tags
      if (entry.tags) {
        const tagSet = new Set([...duplicate.tags, ...entry.tags]);
        duplicate.tags = [...tagSet];
      }
    } else {
      const full = this.hydrate(entry);
      entries.push(full);
      this.idIndex.set(full.id, role);
    }

    this.longTermCache.set(role, entries);
    this.debouncedPersist(role);
  }

  // ══════════════════════════════════════════════════════════
  // Advanced Query (filter by type, tags, effectiveness)
  // ══════════════════════════════════════════════════════════

  async query(query: MemoryQuery): Promise<MemoryEntry[]> {
    const roles = query.roles ?? ALL_ROLES;
    let results: MemoryEntry[] = [];

    for (const role of roles) {
      const entries = this.longTermCache.get(role as StoreKey) ?? [];
      results.push(...entries);
    }

    // Include global if requested and not already in roles
    if (query.includeGlobal && !roles.includes('global')) {
      results.push(...(this.longTermCache.get('global') ?? []));
    }

    // Apply filters
    if (query.types && query.types.length > 0) {
      const typeSet = new Set<MemoryType>(query.types);
      results = results.filter(e => typeSet.has(e.type));
    }

    if (query.tags && query.tags.length > 0) {
      results = results.filter(e =>
        query.tags!.every(tag => e.tags.includes(tag)),
      );
    }

    if (query.minRelevance !== undefined) {
      results = results.filter(e => e.relevanceScore >= query.minRelevance!);
    }

    if (query.minEffectiveness !== undefined) {
      results = results.filter(e =>
        !isNaN(e.effectiveness) && e.effectiveness >= query.minEffectiveness!,
      );
    }

    // Text search (keyword-based when no vector DB)
    if (query.queryText) {
      const queryWords = tokenize(query.queryText);
      results = results
        .map(e => ({ entry: e, score: textMatchScore(queryWords, e.content) }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score)
        .map(x => x.entry);
    } else {
      results.sort((a, b) => this.rank(b) - this.rank(a));
    }

    const limit = query.limit ?? 10;
    return results.slice(0, limit).map(e => this.touch(e));
  }

  // ══════════════════════════════════════════════════════════
  // Global Shared Memory
  // ══════════════════════════════════════════════════════════

  async getGlobal(query: MemoryQuery): Promise<MemoryEntry[]> {
    return this.query({ ...query, roles: ['global'] });
  }

  async saveGlobal(entry: MemoryEntryInput): Promise<void> {
    await this.saveLongTerm({ ...entry, agentRole: 'global' });
  }

  // ══════════════════════════════════════════════════════════
  // Feedback Loop — Record success/failure for a memory entry
  // ══════════════════════════════════════════════════════════

  async recordOutcome(entryId: string, success: boolean): Promise<void> {
    const role = this.idIndex.get(entryId);
    if (!role) return;

    const entries = this.longTermCache.get(role);
    if (!entries) return;

    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;

    if (success) {
      entry.successCount++;
      entry.relevanceScore = Math.min(entry.relevanceScore + 0.1, 2.0);
    } else {
      entry.failureCount++;
      entry.relevanceScore = Math.max(entry.relevanceScore - 0.05, 0);
    }

    // Recalculate effectiveness
    const total = entry.successCount + entry.failureCount;
    entry.effectiveness = total > 0 ? entry.successCount / total : NaN;

    this.debouncedPersist(role);
  }

  // ══════════════════════════════════════════════════════════
  // Embedding (stub — no-op until vector DB connected)
  // ══════════════════════════════════════════════════════════

  async embed(_text: string): Promise<number[]> {
    return [];
  }

  // ══════════════════════════════════════════════════════════
  // Maintenance & Stats
  // ══════════════════════════════════════════════════════════

  async runDecay(): Promise<{ decayed: number; archived: number }> {
    let decayed = 0;
    let archived = 0;

    for (const [role, entries] of this.longTermCache) {
      for (const entry of entries) {
        entry.relevanceScore *= 0.95;
        decayed++;
      }

      // Preserve high-effectiveness entries even with low relevance
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const before = entries.length;
      const filtered = entries.filter(e =>
        e.relevanceScore > 0.05 || e.lastAccessed > thirtyDaysAgo || e.effectiveness > 0.8,
      );
      archived += before - filtered.length;

      this.longTermCache.set(role, filtered);
      await this.persistRole(role);
    }

    this.logger.info('Memory decay complete', { decayed, archived });

    // Also evict expired short-term entries
    const shortTermEvicted = this.evictExpiredShortTerm();
    if (shortTermEvicted > 0) {
      this.logger.info(`Evicted ${shortTermEvicted} expired short-term memory slots`);
    }

    return { decayed, archived };
  }

  clearSession(sessionId: string): void {
    for (const key of this.shortTermStore.keys()) {
      if (key.startsWith(`${sessionId}:`)) {
        this.shortTermStore.delete(key);
        this.shortTermExpiry.delete(key);
      }
    }
  }

  getStats(): MemoryStats {
    const longTermEntries: Record<string, number> = {};
    const byType: Record<string, number> = {};
    let totalEntries = 0;
    let totalEffectivenessSum = 0;
    let totalEffectivenessCount = 0;

    for (const [role, entries] of this.longTermCache) {
      longTermEntries[role] = entries.length;
      totalEntries += entries.length;

      for (const e of entries) {
        byType[e.type] = (byType[e.type] ?? 0) + 1;
        if (!isNaN(e.effectiveness)) {
          totalEffectivenessSum += e.effectiveness;
          totalEffectivenessCount++;
        }
      }
    }

    return {
      shortTermSessions: this.shortTermStore.size,
      longTermEntries,
      totalEntries,
      byType,
      avgEffectiveness: totalEffectivenessCount > 0
        ? totalEffectivenessSum / totalEffectivenessCount
        : NaN,
      globalEntries: (this.longTermCache.get('global') ?? []).length,
    };
  }

  /** Get the top N most effective memories across all agents. */
  getTopPatterns(limit = 10): MemoryEntry[] {
    const all: MemoryEntry[] = [];
    for (const entries of this.longTermCache.values()) {
      all.push(...entries.filter(e =>
        e.type === 'pattern' && !isNaN(e.effectiveness) && e.effectiveness > 0,
      ));
    }
    return all
      .sort((a, b) => b.effectiveness - a.effectiveness || b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  /** Get the most common failure patterns. */
  getTopFailures(limit = 10): MemoryEntry[] {
    const all: MemoryEntry[] = [];
    for (const entries of this.longTermCache.values()) {
      all.push(...entries.filter(e => e.type === 'failure' || e.type === 'error_fix'));
    }
    return all
      .sort((a, b) => b.accessCount - a.accessCount || b.relevanceScore - a.relevanceScore)
      .slice(0, limit);
  }

  // ══════════════════════════════════════════════════════════
  // Internals
  // ══════════════════════════════════════════════════════════

  /** Hydrate a partial entry into a full MemoryEntry. */
  private hydrate(entry: MemoryEntryInput): MemoryEntry {
    return {
      ...entry,
      tags: entry.tags ?? [],
      id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date(),
      lastAccessed: new Date(),
      accessCount: 0,
      successCount: 0,
      failureCount: 0,
      effectiveness: NaN,
    };
  }

  /** Update last-accessed timestamp. */
  private touch(entry: MemoryEntry): MemoryEntry {
    entry.lastAccessed = new Date();
    entry.accessCount++;
    return entry;
  }

  /** Composite ranking: relevance + effectiveness + recency + frequency. */
  private rank(entry: MemoryEntry): number {
    let score = entry.relevanceScore;

    // Boost effective patterns
    if (!isNaN(entry.effectiveness) && entry.effectiveness > 0) {
      score += entry.effectiveness * 0.5;
    }

    // Recency boost (decays over 30 days)
    const ageMs = Date.now() - new Date(entry.lastAccessed).getTime();
    const ageDays = ageMs / (1000 * 60 * 60 * 24);
    score += Math.max(0, 0.3 * (1 - ageDays / 30));

    // Frequency boost (logarithmic)
    if (entry.accessCount > 0) {
      score += 0.1 * Math.log2(1 + entry.accessCount);
    }

    return score;
  }

  /** Debounce disk writes per role (100ms). */
  private debouncedPersist(role: StoreKey): void {
    const existing = this.persistDebounce.get(role);
    if (existing) clearTimeout(existing);
    this.persistDebounce.set(role, setTimeout(() => {
      this.persistRole(role).catch(err => {
        this.logger.warn(`Failed to persist ${role} memory`, { error: (err as Error).message });
      });
    }, 100));
  }

  // ── Disk I/O ──────────────────────────────────────────

  private async loadFromDisk(): Promise<void> {
    if (this.loaded) return;

    for (const role of ALL_ROLES) {
      const filePath = join(this.baseDir, `${role}.json`);
      if (existsSync(filePath)) {
        try {
          const raw = await readFile(filePath, 'utf-8');
          const entries = JSON.parse(raw) as MemoryEntry[];

          // Migrate old entries to new schema
          for (const e of entries) {
            if (e.tags === undefined) (e as any).tags = [];
            if (e.successCount === undefined) (e as any).successCount = 0;
            if (e.failureCount === undefined) (e as any).failureCount = 0;
            if (e.effectiveness === undefined) (e as any).effectiveness = NaN;
          }

          this.longTermCache.set(role, entries);

          // Build id index
          for (const e of entries) {
            this.idIndex.set(e.id, role);
          }

          this.logger.debug(`Loaded ${entries.length} memories for ${role}`);
        } catch (err) {
          this.logger.warn(`Failed to load memory for ${role}`, { error: (err as Error).message });
        }
      }
    }

    this.loaded = true;
  }

  private async persistRole(role: StoreKey): Promise<void> {
    const entries = this.longTermCache.get(role) ?? [];
    const filePath = join(this.baseDir, `${role}.json`);
    await writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
  }
}

// ══════════════════════════════════════════════════════════════
// Stats Type
// ══════════════════════════════════════════════════════════════

export interface MemoryStats {
  shortTermSessions: number;
  longTermEntries: Record<string, number>;
  totalEntries: number;
  byType: Record<string, number>;
  avgEffectiveness: number;
  globalEntries: number;
}

// ══════════════════════════════════════════════════════════════
// Text Utilities (keyword search when no vector DB)
// ══════════════════════════════════════════════════════════════

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2);
}

function jaccardSimilarity(a: string, b: string): number {
  const wordsA = new Set(tokenize(a));
  const wordsB = new Set(tokenize(b));
  let intersection = 0;
  for (const w of wordsA) {
    if (wordsB.has(w)) intersection++;
  }
  const union = wordsA.size + wordsB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Simple TF-overlap score for keyword-based search. */
function textMatchScore(queryWords: string[], content: string): number {
  const contentWords = new Set(tokenize(content));
  let matches = 0;
  for (const w of queryWords) {
    if (contentWords.has(w)) matches++;
  }
  return queryWords.length === 0 ? 0 : matches / queryWords.length;
}
