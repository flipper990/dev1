import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normalizeProjectRelativePath,
  resolvePathWithinRoot,
  toSafeArchiveEntryPath,
  UnsafeProjectPathError,
} from './safe-path.js';

test('normalizeProjectRelativePath normalizes separators and dot segments', () => {
  assert.equal(normalizeProjectRelativePath('src\\app\\..\\app\\page.tsx'), 'src/app/page.tsx');
  assert.equal(normalizeProjectRelativePath('./package.json'), 'package.json');
});

test('normalizeProjectRelativePath rejects traversal and absolute paths', () => {
  assert.throws(
    () => normalizeProjectRelativePath('../secrets.txt'),
    (err: unknown) => err instanceof UnsafeProjectPathError && err.reason === 'path-traversal',
  );
  assert.throws(
    () => normalizeProjectRelativePath('/etc/passwd'),
    (err: unknown) => err instanceof UnsafeProjectPathError && err.reason === 'absolute-path',
  );
  assert.throws(
    () => normalizeProjectRelativePath('C:\\Windows\\System32\\drivers\\etc\\hosts'),
    (err: unknown) => err instanceof UnsafeProjectPathError && err.reason === 'absolute-path',
  );
});

test('resolvePathWithinRoot keeps paths under the provided root', () => {
  const resolved = resolvePathWithinRoot('/tmp/devteam-project', 'apps/web/package.json');
  assert.match(resolved.absolutePath, /tmp[\\/]+devteam-project[\\/]+apps[\\/]+web[\\/]+package\.json$/);
  assert.equal(resolved.relativePath, 'apps/web/package.json');
});

test('toSafeArchiveEntryPath rejects unsafe archive names', () => {
  assert.equal(toSafeArchiveEntryPath('apps/api/src/server.ts'), 'apps/api/src/server.ts');
  assert.throws(
    () => toSafeArchiveEntryPath('../../outside.txt'),
    (err: unknown) => err instanceof UnsafeProjectPathError && err.reason === 'path-traversal',
  );
});
