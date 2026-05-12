import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { ProjectRecord } from './project-store.js';
import { ProjectStore } from './project-store.js';

function createLogger(): Logger {
  return {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  };
}

function createProject(id: string, files: Array<{ path: string; content: string }>): ProjectRecord {
  const now = new Date().toISOString();
  return {
    id,
    sessionId: `sess-${id}`,
    name: `Project ${id}`,
    prompts: ['Build app'],
    status: 'generating',
    files,
    tasks: [],
    totalTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    createdAt: now,
    version: 1,
    versionHistory: [],
  };
}

test('ProjectStore.save rejects traversal paths and does not escape output root', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'devteam-project-store-'));
  try {
    const store = new ProjectStore(baseDir, createLogger());
    const projectId = 'proj-save-traversal';
    const project = createProject(projectId, [{ path: '../../escape.txt', content: 'owned' }]);

    await assert.rejects(
      () => store.save(project, { caller: 'test', reason: 'path-safety-save' }),
      /unsafe generated file path/i,
    );

    assert.equal(existsSync(path.join(baseDir, projectId, 'escape.txt')), false);
    assert.equal(existsSync(path.join(baseDir, 'escape.txt')), false);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test('ProjectStore.update(persistFiles) rejects traversal paths and does not escape output root', async () => {
  const baseDir = await mkdtemp(path.join(tmpdir(), 'devteam-project-store-'));
  try {
    const store = new ProjectStore(baseDir, createLogger());
    const projectId = 'proj-update-traversal';
    await store.save(
      createProject(projectId, [{ path: 'apps/web/package.json', content: '{"name":"ok"}\n' }]),
      { caller: 'test', reason: 'path-safety-initial-save' },
    );

    await assert.rejects(
      () => store.update(
        projectId,
        (current) => {
          current.files = [{ path: '../escape.txt', content: 'owned' }];
        },
        { caller: 'test', reason: 'path-safety-update', persistFiles: true },
      ),
      /unsafe generated file path/i,
    );

    assert.equal(existsSync(path.join(baseDir, projectId, 'escape.txt')), false);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});
