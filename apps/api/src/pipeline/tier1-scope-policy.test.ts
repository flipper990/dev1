import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyTier1RuntimeExclusion, isAllowedTier1RuntimePath } from './test-artifact-policy.js';

test('tier1 scope blocks backend and test artifacts', () => {
  assert.equal(classifyTier1RuntimeExclusion('server/index.ts'), 'backend-runtime-artifact');
  assert.equal(classifyTier1RuntimeExclusion('src/app/api/users/route.ts'), 'backend-runtime-artifact');
  assert.equal(classifyTier1RuntimeExclusion('src/components/Button.test.tsx'), 'generated-test-artifact');
});

test('tier1 scope allows frontend/runtime deterministic paths', () => {
  assert.equal(isAllowedTier1RuntimePath('src/app/page.tsx'), true);
  assert.equal(isAllowedTier1RuntimePath('src/app/layout.tsx'), true);
  assert.equal(isAllowedTier1RuntimePath('src/app/globals.css'), true);
  assert.equal(isAllowedTier1RuntimePath('src/components/Hero.tsx'), true);
  assert.equal(isAllowedTier1RuntimePath('src/lib/mock-data.ts'), true);
  assert.equal(isAllowedTier1RuntimePath('src/lib/api-client.ts'), true);
});

