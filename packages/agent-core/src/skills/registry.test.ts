import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEVTEAM_SKILLS,
  getSkillsForRole,
  renderSkillsForPrompt,
  selectSkillsForPrompt,
  validateSkillRegistry,
} from './registry';
import type { SkillId } from './types';

const expectedIds: SkillId[] = [
  'stack-selection',
  'dependency-repair',
  'preview-health',
  'backend-contract',
  'budget-check',
  'test-gaps',
  'export-readiness',
];

test('DEVteam skill registry contains valid typed skill definitions', () => {
  assert.deepEqual(validateSkillRegistry(), []);
  assert.deepEqual(
    DEVTEAM_SKILLS.map((skill) => skill.id).sort(),
    [...expectedIds].sort(),
  );

  for (const skill of DEVTEAM_SKILLS) {
    assert.ok(skill.name.length > 0, `${skill.id} has a name`);
    assert.ok(skill.description.length > 0, `${skill.id} has a description`);
    assert.ok(skill.whenToUse.length > 0, `${skill.id} has usage guidance`);
    assert.ok(skill.promptInstructions.length > 0, `${skill.id} has prompt instructions`);
    assert.ok(skill.maxTokenBudget > 0, `${skill.id} has a positive token budget`);
    assert.match(skill.version, /^\d+\.\d+\.\d+$/, `${skill.id} has semver version`);
  }
});

test('registered skills are constrained to the intended agent roles', () => {
  assert.deepEqual(getSkillsForRole('spec').map((skill) => skill.id).sort(), ['budget-check', 'stack-selection']);
  assert.deepEqual(getSkillsForRole('builder').map((skill) => skill.id).sort(), ['backend-contract', 'budget-check', 'dependency-repair']);
  assert.deepEqual(getSkillsForRole('qa').map((skill) => skill.id).sort(), ['budget-check', 'preview-health', 'test-gaps']);
  assert.deepEqual(getSkillsForRole('polish').map((skill) => skill.id).sort(), ['budget-check', 'export-readiness']);
});

test('skill selection injects only role-approved relevant playbooks', () => {
  const specSkills = selectSkillsForPrompt({
    role: 'spec',
    prompts: ['Build a CRM with dashboards.'],
  });
  assert.deepEqual(specSkills.map((skill) => skill.id), ['stack-selection']);

  const builderSkills = selectSkillsForPrompt({
    role: 'builder',
    phase: 'backend',
    spec: {
      apiContracts: [{ id: 'users.list', method: 'GET', path: '/api/users' }],
    },
    files: [
      { path: 'src/app/api/users/route.ts', content: "import { z } from 'zod';" },
      { path: 'package.json', content: '{"dependencies":{}}' },
    ],
  });
  assert.deepEqual(builderSkills.map((skill) => skill.id).sort(), ['backend-contract', 'dependency-repair']);

  const qaSkills = selectSkillsForPrompt({
    role: 'qa',
    runtimeFeedback: { issues: [{ category: 'preview', message: 'blank page' }] },
    files: [
      { path: 'src/app/page.tsx', content: 'export default function Page(){return <main/>}' },
      { path: 'src/app/api/users/route.ts', content: 'export function GET(){}' },
    ],
  });
  assert.deepEqual(qaSkills.map((skill) => skill.id).sort(), ['preview-health', 'test-gaps']);

  const polishSkills = selectSkillsForPrompt({
    role: 'polish',
    files: [
      { path: 'package.json', content: '{"scripts":{"dev":"next dev"}}' },
      { path: 'README.md', content: '# App' },
    ],
  });
  assert.deepEqual(polishSkills.map((skill) => skill.id), ['export-readiness']);
});

test('skill prompt rendering omits unrelated skills', () => {
  const rendered = renderSkillsForPrompt({
    role: 'builder',
    phase: 'backend',
    spec: { apiContracts: [{ id: 'items.list', method: 'GET', path: '/api/items' }] },
  });

  assert.match(rendered, /Backend Contract/);
  assert.doesNotMatch(rendered, /Preview Health/);
  assert.doesNotMatch(rendered, /Export Readiness/);
});

test('budget-check is selected only when budget context is active', () => {
  assert.deepEqual(
    selectSkillsForPrompt({ role: 'builder', budget: { enabled: true, percentUsed: 0.75 } }).map((skill) => skill.id),
    ['budget-check'],
  );
  assert.deepEqual(
    selectSkillsForPrompt({ role: 'builder', budget: { enabled: false, percentUsed: 0.95 } }).map((skill) => skill.id),
    [],
  );
});
