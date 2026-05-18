import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedPathForTier, validateTier3RequiredContracts } from './tier-policy.js';

const requiredContracts = [
  'src/contracts/api-contract.ts',
  'src/contracts/data-model-contract.ts',
  'src/contracts/route-contract.ts',
  'src/contracts/boundary-contract.ts',
];

test('tier1 policy blocks backend files', () => {
  assert.equal(isAllowedPathForTier('TIER_1_FRONTEND_ONLY', 'src/server/index.ts'), false);
  assert.equal(isAllowedPathForTier('TIER_1_FRONTEND_ONLY', 'src/app/api/users/route.ts'), false);
  assert.equal(isAllowedPathForTier('TIER_1_FRONTEND_ONLY', 'src/contracts/api-contract.ts'), false);
  assert.equal(isAllowedPathForTier('TIER_1_FRONTEND_ONLY', 'db/schema.ts'), false);
  assert.equal(isAllowedPathForTier('TIER_1_FRONTEND_ONLY', 'tests/app.test.ts'), false);
  assert.equal(isAllowedPathForTier('TIER_1_FRONTEND_ONLY', 'src/__tests__/page.spec.tsx'), false);
});

test('tier2 policy allows structured frontend files', () => {
  assert.equal(isAllowedPathForTier('TIER_2_STRUCTURED_APP', 'src/app/dashboard/page.tsx'), true);
  assert.equal(isAllowedPathForTier('TIER_2_STRUCTURED_APP', 'src/components/RecordsTable.tsx'), true);
  assert.equal(isAllowedPathForTier('TIER_2_STRUCTURED_APP', 'src/lib/local-data-store.ts'), true);
  assert.equal(isAllowedPathForTier('TIER_2_STRUCTURED_APP', 'src/server/db/schema.ts'), false);
});

test('tier3 policy requires contract files', () => {
  const partial = validateTier3RequiredContracts([
    { path: 'src/contracts/api-contract.ts' },
    { path: 'src/contracts/route-contract.ts' },
  ]);
  assert.equal(partial.ok, false);
  assert.deepEqual(partial.missing.sort(), ['src/contracts/boundary-contract.ts', 'src/contracts/data-model-contract.ts']);

  const complete = validateTier3RequiredContracts(requiredContracts.map((p) => ({ path: p })));
  assert.equal(complete.ok, true);
  assert.deepEqual(complete.missing, []);
  assert.equal(isAllowedPathForTier('TIER_3_FULLSTACK', 'src/contracts/api-contract.ts'), true);
});
