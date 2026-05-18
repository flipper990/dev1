import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyTier1RuntimeExclusion, isTier1BackendArtifactPath, isTier1TestArtifactPath } from './test-artifact-policy.js';

test('drops explicit test artifacts in __tests__ and test-named files', () => {
  assert.equal(isTier1TestArtifactPath('src/app/__tests__/page.test.tsx'), true);
  assert.equal(isTier1TestArtifactPath('src/features/cards/card.test.ts'), true);
  assert.equal(isTier1TestArtifactPath('tests/ui/home.spec.tsx'), true);
});

test('preserves non-source assets under tests directories', () => {
  assert.equal(isTier1TestArtifactPath('tests/fixtures/articles.json'), false);
});

test('drops source files under tests directories by default tier1 scope', () => {
  assert.equal(isTier1TestArtifactPath('src/tests/runtime-helper.ts'), true);
  assert.equal(isTier1TestArtifactPath('apps/api/src/tests/router.ts'), true);
  assert.equal(isTier1TestArtifactPath('src/app/tests/page.tsx'), true);
  assert.equal(isTier1TestArtifactPath('apps/web/tests/runtime-helper.ts'), true);
  assert.equal(isTier1TestArtifactPath('packages/core/tests/runtime-helper.ts'), true);
});

test('preserves runtime spec-named sources outside explicit test directories', () => {
  assert.equal(isTier1TestArtifactPath('src/lib/openapi.spec.ts'), false);
  assert.equal(isTier1TestArtifactPath('packages/core/openapi.spec.ts'), false);
});

test('drops test/spec-named sources inside apps/**/tests and packages/**/tests', () => {
  assert.equal(isTier1TestArtifactPath('apps/web/tests/home.test.tsx'), true);
  assert.equal(isTier1TestArtifactPath('packages/core/tests/home.spec.ts'), true);
});

test('detects backend runtime artifacts excluded from tier1 preview', () => {
  assert.equal(isTier1BackendArtifactPath('apps/api/src/server.ts'), true);
  assert.equal(isTier1BackendArtifactPath('server/index.ts'), true);
  assert.equal(isTier1BackendArtifactPath('routes/users.ts'), true);
  assert.equal(isTier1BackendArtifactPath('db/client.ts'), true);
  assert.equal(isTier1BackendArtifactPath('pages/_document.tsx'), true);
  assert.equal(isTier1BackendArtifactPath('src/pages/index.tsx'), true);
  assert.equal(isTier1BackendArtifactPath('src/app/page.tsx'), false);
});

test('classifies runtime exclusions with explicit reason', () => {
  assert.equal(classifyTier1RuntimeExclusion('src/app/__tests__/page.test.tsx'), 'generated-test-artifact');
  assert.equal(classifyTier1RuntimeExclusion('apps/api/src/server.ts'), 'backend-runtime-artifact');
  assert.equal(classifyTier1RuntimeExclusion('src/components/Card.tsx'), null);
});
