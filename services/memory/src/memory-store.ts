import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { Logger, generateId, now, config } from '@devteam/core';
import type { MemoryEntry, MemoryQuery, AgentRole } from '@devteam/core';

// ─── In-memory + file-backed store ────────────────────────────────────────────

export class MemoryStore {
  private entries: MemoryEntry[] = [];
  private readonly logger = new Logger('memory-store');
  private readonly filePath: string;

  constructor(namespace = 'default') {
    const dir = join(config.storage.path, 'memory');
    mkdirSync(dir, { recursive: true });
    this.filePath = join(dir, `${namespace}.json`);
    this.load();
  }

  // ── Write ──────────────────────────────────────────────────────────────

  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry> {
    const full: MemoryEntry = {
      ...entry,
      id: generateId('mem'),
      createdAt: now(),
    };
    this.entries.push(full);
    this.persist();
    return full;
  }

  // ── Retrieve ───────────────────────────────────────────────────────────

  async retrieve(query: MemoryQuery): Promise<MemoryEntry[]> {
    this.evictExpired();

    let results = this.entries;

    if (query.agentRole) {
      results = results.filter((e) => e.agentRole === query.agentRole);
    }

    if (query.sessionId) {
      results = results.filter((e) => e.sessionId === query.sessionId);
    }

    if (query.tags?.length) {
      results = results.filter((e) =>
        query.tags!.some((tag) => e.tags.includes(tag)),
      );
    }

    if (query.textQuery) {
      const lower = query.textQuery.toLowerCase();
      const terms = lower.split(/\s+/).filter(Boolean);
      results = results
        .map((e) => ({ entry: e, score: this.scoreRelevance(e, terms) }))
        .filter(({ score }) => score > 0)
        .sort((a, b) => b.score - a.score)
        .map(({ entry }) => entry);
    } else {
      // Most recent first
      results = results.slice().sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }

    return results.slice(0, query.limit ?? 10);
  }

  // ── Delete ─────────────────────────────────────────────────────────────

  async deleteBySession(sessionId: string): Promise<number> {
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => e.sessionId !== sessionId);
    this.persist();
    return before - this.entries.length;
  }

  // ── Helpers ────────────────────────────────────────────────────────────

  private scoreRelevance(entry: MemoryEntry, terms: string[]): number {
    const text = `${entry.content} ${entry.tags.join(' ')}`.toLowerCase();
    return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0);
  }

  private evictExpired(): void {
    const now_ = Date.now();
    const before = this.entries.length;
    this.entries = this.entries.filter(
      (e) => !e.expiresAt || new Date(e.expiresAt).getTime() > now_,
    );
    if (this.entries.length < before) this.persist();
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    try {
      this.entries = JSON.parse(readFileSync(this.filePath, 'utf8')) as MemoryEntry[];
    } catch {
      this.logger.warn('Failed to load memory, starting fresh', { path: this.filePath });
      this.entries = [];
    }
  }

  private persist(): void {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.entries, null, 2));
    } catch (err) {
      this.logger.error('Failed to persist memory', { error: err });
    }
  }
}

// ─── Per-agent scoped adapter ─────────────────────────────────────────────────

export class AgentMemory {
  constructor(
    private readonly store: MemoryStore,
    private readonly agentRole: AgentRole | 'global',
  ) {}

  async store(entry: Omit<MemoryEntry, 'id' | 'createdAt' | 'agentRole'>): Promise<MemoryEntry> {
    return this.store.store({ ...entry, agentRole: this.agentRole });
  }

  async retrieve(query: Omit<MemoryQuery, 'agentRole'>): Promise<MemoryEntry[]> {
    return this.store.retrieve({ ...query, agentRole: this.agentRole });
  }
}

// ─── Shared singleton store ───────────────────────────────────────────────────

export const globalMemoryStore = new MemoryStore('global');
