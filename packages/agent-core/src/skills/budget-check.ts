import { hasBudgetSignals } from './skill-utils';
import type { SkillRegistryEntry } from './types';

export const budgetCheckSkill: SkillRegistryEntry = {
  skill: {
    id: 'budget-check',
    name: 'Budget Check',
    description: 'Adapt work scope when generation spend is under pressure without faking billing or suppressing real diagnostics.',
    agentRoles: ['spec', 'builder', 'qa', 'polish'],
    whenToUse: 'Use only when the generation budget context indicates material budget pressure.',
    promptInstructions: [
      'Prioritize correctness, bootability, and user-visible core flows over optional polish.',
      'Do not claim real billing actions were taken; only react to tracked generation spend context.',
      'Prefer smaller complete outputs over large partial outputs that trigger retries.',
      'Name any intentionally deferred non-critical work in diagnostics or warnings when the output format allows it.',
    ].join('\n'),
    maxTokenBudget: 140,
    relatedValidators: ['generation-budget'],
    version: '1.0.0',
  },
  isRelevant: (ctx) => hasBudgetSignals(ctx),
};
