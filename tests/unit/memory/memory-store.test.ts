import { describe, it, expect, beforeEach } from '@jest/globals';
import { MemoryStore } from '../../services/memory/src/memory-store.js';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ─── Override storage path for tests ──────────────────────────────────────

const TEST_DIR = join(tmpdir(), `devteam-test-${Date.now()}`);
process.env['STORAGE_PATH'] = TEST_DIR;

describe('MemoryStore', () => {
  let store: MemoryStore;

  beforeEach(() => {
    store = new MemoryStore(`test-${Math.random().toString(36).slice(2)}`);
  });

  it('stores and retrieves an entry', async () => {
    await store.store({
      agentRole: 'coder',
      sessionId: 'sess_1',
      projectId: 'proj_1',
      content: 'Use TypeScript strict mode',
      tags: ['typescript', 'coding'],
    });

    const results = await store.retrieve({ agentRole: 'coder', sessionId: 'sess_1' });
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('Use TypeScript strict mode');
  });

  it('filters by agentRole', async () => {
    await store.store({ agentRole: 'coder', sessionId: 's1', projectId: 'p1', content: 'code', tags: [] });
    await store.store({ agentRole: 'planner', sessionId: 's1', projectId: 'p1', content: 'plan', tags: [] });

    const coderResults = await store.retrieve({ agentRole: 'coder' });
    expect(coderResults).toHaveLength(1);
    expect(coderResults[0]!.agentRole).toBe('coder');
  });

  it('respects limit', async () => {
    for (let i = 0; i < 5; i++) {
      await store.store({ agentRole: 'coder', sessionId: 's1', projectId: 'p1', content: `entry ${i}`, tags: [] });
    }

    const results = await store.retrieve({ agentRole: 'coder', limit: 3 });
    expect(results).toHaveLength(3);
  });

  it('scores text relevance', async () => {
    await store.store({ agentRole: 'global', sessionId: 's1', projectId: 'p1', content: 'React hooks best practices', tags: ['react'] });
    await store.store({ agentRole: 'global', sessionId: 's1', projectId: 'p1', content: 'Docker networking guide', tags: ['docker'] });

    const results = await store.retrieve({ textQuery: 'React hooks' });
    expect(results[0]!.content).toContain('React');
  });

  it('deletes entries by session', async () => {
    await store.store({ agentRole: 'coder', sessionId: 'sess_delete', projectId: 'p1', content: 'temp', tags: [] });
    const deleted = await store.deleteBySession('sess_delete');
    expect(deleted).toBe(1);

    const remaining = await store.retrieve({ sessionId: 'sess_delete' });
    expect(remaining).toHaveLength(0);
  });
});
