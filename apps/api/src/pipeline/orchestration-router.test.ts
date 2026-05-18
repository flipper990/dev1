import { test } from 'node:test';
import assert from 'node:assert/strict';
import { classifyPromptTier } from './prompt-tier-classifier.js';
import { routeOrchestrationTier } from './orchestration-router.js';

const cfg = {
  tier1FastEnabled: true,
  tier2StructuredEnabled: true,
  tier3ContractFirstEnabled: true,
  tier1: { timeoutMs: 600000, retryBudget: 1 },
  tier2: { timeoutMs: 1200000, retryBudget: 2 },
  tier3: { timeoutMs: 1800000, retryBudget: 3 },
};

test('router: landing page -> tier1 fast path', () => {
  const tier = classifyPromptTier(['Build a simple landing page with hero and CTA.']);
  const route = routeOrchestrationTier(tier.tier, cfg);
  assert.equal(tier.tier, 'TIER_1_FRONTEND_ONLY');
  assert.equal(route.generationPath, 'tier1-fast');
});

test('router: pricing page -> tier1 fast path', () => {
  const tier = classifyPromptTier(['Build a simple pricing page with three plans and feature comparison.']);
  const route = routeOrchestrationTier(tier.tier, cfg);
  assert.equal(tier.tier, 'TIER_1_FRONTEND_ONLY');
  assert.equal(route.generationPath, 'tier1-fast');
});

test('router: CRUD app -> tier2 structured path', () => {
  const tier = classifyPromptTier(['Build a CRUD app with list/add/edit/delete and search filters.']);
  const route = routeOrchestrationTier(tier.tier, cfg);
  assert.equal(tier.tier, 'TIER_2_STRUCTURED_APP');
  assert.equal(route.generationPath, 'tier2-structured');
});

test('router: admin dashboard with forms/state -> tier2 structured path', () => {
  const tier = classifyPromptTier(['Build an admin dashboard with forms, filters, and complex local state.']);
  const route = routeOrchestrationTier(tier.tier, cfg);
  assert.equal(tier.tier, 'TIER_2_STRUCTURED_APP');
  assert.equal(route.generationPath, 'tier2-structured');
});

test('router: auth/database/API app -> tier3 contract-first path', () => {
  const tier = classifyPromptTier(['Build a fullstack app with auth, database, and API routes.']);
  const route = routeOrchestrationTier(tier.tier, cfg);
  assert.equal(tier.tier, 'TIER_3_FULLSTACK');
  assert.equal(route.generationPath, 'tier3-contract-first');
});
