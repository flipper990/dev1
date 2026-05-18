import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTier2StructuredGeneration } from './tier2-structured-runner.js';

const loggerStub = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

test('tier2 structured runner produces multipage app artifacts', async () => {
  const result = await runTier2StructuredGeneration({
    projectId: 'tier2-structured-test',
    prompt: 'Build a CRUD app with list/add/edit/delete and search filters.',
    logger: loggerStub,
  });

  const paths = new Set(result.files.map((f) => f.path.replace(/\\/g, '/')));
  assert.ok(paths.has('src/app/page.tsx'));
  assert.ok(paths.has('src/lib/route-graph.ts'));
  assert.ok(paths.has('src/components/RecordForm.tsx'));
  assert.ok(paths.has('src/lib/local-data-store.ts'));
  assert.ok(paths.has('src/lib/mock-data.ts'));
  assert.ok(result.slicesGenerated > 0);
});

test('tier2 structured runner keeps backend/db artifacts out of generated file set', async () => {
  const result = await runTier2StructuredGeneration({
    projectId: 'tier2-no-backend-test',
    prompt: 'Build an admin dashboard with forms, validation, filters, and complex state.',
    logger: loggerStub,
  });

  const paths = result.files.map((f) => f.path.replace(/\\/g, '/'));
  assert.equal(paths.some((p) => p.startsWith('server/')), false);
  assert.equal(paths.some((p) => p.startsWith('db/')), false);
  assert.equal(paths.some((p) => p.startsWith('migrations/')), false);
  assert.equal(paths.some((p) => p.startsWith('src/server/')), false);
  assert.equal(paths.some((p) => p.startsWith('src/app/api/')), false);
});
