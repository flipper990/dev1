import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyPromptTier } from './prompt-tier-classifier.js';

test('landing page prompt -> tier1', () => {
  const result = classifyPromptTier(['Build a simple landing page with hero section, features, and CTA.']);
  assert.equal(result.tier, 'TIER_1_FRONTEND_ONLY');
});

test('pricing page prompt -> tier1', () => {
  const result = classifyPromptTier(['Build a simple pricing page with three plans and feature comparison.']);
  assert.equal(result.tier, 'TIER_1_FRONTEND_ONLY');
});

test('waitlist prompt -> tier1', () => {
  const result = classifyPromptTier(['Build a simple waitlist page with email capture form and confirmation state.']);
  assert.equal(result.tier, 'TIER_1_FRONTEND_ONLY');
});

test('dashboard with mock data prompt -> tier1', () => {
  const result = classifyPromptTier(['Build a simple SaaS dashboard with sidebar, KPI cards, and mock data.']);
  assert.equal(result.tier, 'TIER_1_FRONTEND_ONLY');
});

test('portfolio prompt -> tier1', () => {
  const result = classifyPromptTier(['Build a personal portfolio site with projects and contact section.']);
  assert.equal(result.tier, 'TIER_1_FRONTEND_ONLY');
});

test('docs/help prompt -> tier1', () => {
  const result = classifyPromptTier(['Build a docs help page with getting started and FAQ sections.']);
  assert.equal(result.tier, 'TIER_1_FRONTEND_ONLY');
});

test('CRUD app prompt -> tier2', () => {
  const result = classifyPromptTier(['Build a CRUD app with list/add/edit/delete and search filters.']);
  assert.equal(result.tier, 'TIER_2_STRUCTURED_APP');
});

test('admin dashboard with forms/state prompt -> tier2', () => {
  const result = classifyPromptTier(['Build an admin dashboard with forms, validation, filters, and complex state.']);
  assert.equal(result.tier, 'TIER_2_STRUCTURED_APP');
});

test('auth/database/api prompt -> tier3', () => {
  const result = classifyPromptTier(['Build a fullstack app with auth, database migrations, API routes and roles.']);
  assert.equal(result.tier, 'TIER_3_FULLSTACK');
});

test('tier3 signals win over tier1 hints', () => {
  const result = classifyPromptTier(['Build a landing page with hero and CTA plus auth, API, and database integration.']);
  assert.equal(result.tier, 'TIER_3_FULLSTACK');
});
