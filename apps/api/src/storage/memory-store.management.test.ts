import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { FileMemoryStore } from './memory-store.js';

const logger = { info() {}, warn() {}, error() {}, debug() {} };

test('managed memory CRUD persists and influence remains auditable after deletion', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devteam-memory-'));
  try {
    const store = new FileMemoryStore(dir, logger); await store.init();
    const created = await store.createManaged({ agentRole: 'builder', type: 'preference', content: 'Prefer explicit server contracts.', relevanceScore: 1, tags: ['api-design'], metadata: { projectId: 'project-1', source: 'project', pinned: false } });
    assert.equal(store.inspectAll().length, 1);
    await store.updateManaged(created.id, { content: 'Prefer typed server contracts.', pinned: true });
    assert.equal(store.inspectAll()[0].metadata.pinned, true);
    await store.recordInfluence({ projectId: 'project-1', runId: 'run-1', taskId: 'task-1', agentRole: 'builder', memories: store.inspectAll() });
    assert.equal(store.getInfluence('project-1')[0].memoryId, created.id);
    await store.deleteManaged(created.id); assert.equal(store.inspectAll().length, 0);
    const reloaded = new FileMemoryStore(dir, logger); await reloaded.init();
    assert.equal(reloaded.inspectAll().length, 0);
    assert.equal(reloaded.getInfluence('project-1')[0].content, 'Prefer typed server contracts.');
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('inspection does not mutate last-used counters', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'devteam-memory-'));
  try {
    const store = new FileMemoryStore(dir, logger); await store.init();
    await store.createManaged({ agentRole: 'qa', type: 'pattern', content: 'Run focused validation first.', relevanceScore: 1, tags: [], metadata: { projectId: 'project-1', source: 'agent' } });
    const before = store.inspectAll()[0]; store.inspectAll(); store.inspectAll(); const after = store.inspectAll()[0];
    assert.equal(after.accessCount, before.accessCount); assert.equal(String(after.lastAccessed), String(before.lastAccessed));
  } finally { await rm(dir, { recursive: true, force: true }); }
});
