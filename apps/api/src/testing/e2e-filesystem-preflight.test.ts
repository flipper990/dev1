import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  buildIsolatedE2eDataRoot,
  cleanupE2eRunRoot,
  preflightE2eDataRoot,
} from './e2e-filesystem-preflight.js';

test('buildIsolatedE2eDataRoot keeps paths under data/test-runs', () => {
  const apiRoot = 'C:/repo/apps/api';
  const paths = buildIsolatedE2eDataRoot(apiRoot, 'run-123');
  assert.match(paths.rootDir.replace(/\\/g, '/'), /\/data\/test-runs\/run-123$/i);
  assert.match(paths.projectsDir.replace(/\\/g, '/'), /\/data\/test-runs\/run-123\/projects$/i);
  assert.match(paths.memoryDir.replace(/\\/g, '/'), /\/data\/test-runs\/run-123\/memory$/i);
});

test('preflightE2eDataRoot can write/read/delete and create/remove directories', async () => {
  const root = await mkdtemp(join(tmpdir(), 'e2e-preflight-ok-'));
  const paths = {
    rootDir: root,
    projectsDir: join(root, 'projects'),
    memoryDir: join(root, 'memory'),
  };
  await preflightE2eDataRoot(paths);
  await cleanupE2eRunRoot(root);
});

test('preflightE2eDataRoot fails early when projectsDir is not writable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'e2e-preflight-deny-'));
  const projectsAsFile = join(root, 'projects');
  await writeFile(projectsAsFile, 'occupied', 'utf8');
  const paths = {
    rootDir: root,
    projectsDir: projectsAsFile,
    memoryDir: join(root, 'memory'),
  };
  await assert.rejects(() => preflightE2eDataRoot(paths), /file already exists|eexist/i);
  await rm(root, { recursive: true, force: true });
});
