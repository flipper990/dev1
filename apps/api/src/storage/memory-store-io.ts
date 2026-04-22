import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import type { AgentRole, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../packages/agent-core/src/base-agent.js';

export type StoreKey = AgentRole | 'global';

export const ALL_ROLES: StoreKey[] = [
  'planner', 'architect', 'developer', 'reviewer',
  'tester', 'debugger', 'devops', 'optimizer', 'global',
];

export interface DiskLoadResult {
  cache: Map<StoreKey, MemoryEntry[]>;
  idIndex: Map<string, StoreKey>;
}

export async function loadMemoriesFromDisk(baseDir: string, logger: Logger): Promise<DiskLoadResult> {
  await mkdir(baseDir, { recursive: true });

  const cache = new Map<StoreKey, MemoryEntry[]>();
  const idIndex = new Map<string, StoreKey>();

  for (const role of ALL_ROLES) {
    const filePath = join(baseDir, `${role}.json`);
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

        cache.set(role, entries);
        for (const e of entries) {
          idIndex.set(e.id, role);
        }

        logger.debug(`Loaded ${entries.length} memories for ${role}`);
      } catch (err) {
        logger.warn(`Failed to load memory for ${role}`, { error: (err as Error).message });
      }
    }
  }

  return { cache, idIndex };
}

export async function persistRoleToDisk(baseDir: string, role: StoreKey, entries: MemoryEntry[]): Promise<void> {
  const filePath = join(baseDir, `${role}.json`);
  await writeFile(filePath, JSON.stringify(entries, null, 2), 'utf-8');
}
