import { hasTestGapSignals } from './skill-utils';
import type { SkillRegistryEntry } from './types';

export const testGapsSkill: SkillRegistryEntry = {
  skill: {
    id: 'test-gaps',
    name: 'Test Gaps',
    description: 'Identify missing or weak tests for critical flows without demanding unrealistic coverage.',
    agentRoles: ['qa'],
    whenToUse: 'Use when reviewing code that has source files but little or no test coverage.',
    promptInstructions: [
      'Flag missing tests for authentication, data mutation, billing-like flows, exports, destructive actions, and critical API contracts.',
      'Do not fail trivial static pages only because they lack tests; focus on risk-bearing behavior.',
      'When recommending tests, specify the file or flow and the assertion that would catch the defect.',
      'If the project has no test framework, report the gap rather than inventing unrelated infrastructure.',
    ].join('\n'),
    maxTokenBudget: 150,
    relatedValidators: ['quality-assurance'],
    version: '1.0.0',
  },
  isRelevant: (ctx) => ctx.role === 'qa' && hasTestGapSignals(ctx),
};
