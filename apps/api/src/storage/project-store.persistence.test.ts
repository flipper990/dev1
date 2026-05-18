import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProjectStorePersistenceError,
  retryWindowsFsOperation,
} from './project-store.js';

test('retryWindowsFsOperation retries EPERM/EBUSY and eventually succeeds', async () => {
  let calls = 0;
  const result = await retryWindowsFsOperation('rename-project-json', async () => {
    calls += 1;
    if (calls < 3) {
      const err = new Error('operation not permitted') as Error & { code?: string };
      err.code = 'EPERM';
      throw err;
    }
    return 'ok';
  });
  assert.equal(result, 'ok');
  assert.equal(calls, 3);
});

test('retryWindowsFsOperation fails fast for non-retryable fs errors', async () => {
  let calls = 0;
  await assert.rejects(
    () => retryWindowsFsOperation('rename-project-json', async () => {
      calls += 1;
      const err = new Error('no such file or directory') as Error & { code?: string };
      err.code = 'ENOENT';
      throw err;
    }),
    /no such file or directory/i,
  );
  assert.equal(calls, 1);
});

test('ProjectStorePersistenceError preserves code, operation, and path', () => {
  const cause = new Error('EPERM');
  const err = new ProjectStorePersistenceError(
    'FILESYSTEM_PERMISSION_FAILURE',
    'save',
    'data/projects/p1/project.json',
    'project persistence failed',
    cause,
  );
  assert.equal(err.code, 'FILESYSTEM_PERMISSION_FAILURE');
  assert.equal(err.operation, 'save');
  assert.equal(err.path, 'data/projects/p1/project.json');
  assert.match(err.message, /project persistence failed/i);
  assert.equal((err as Error & { cause?: unknown }).cause, cause);
});

