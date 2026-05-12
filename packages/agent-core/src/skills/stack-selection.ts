import type { SkillRegistryEntry } from './types';

export const stackSelectionSkill: SkillRegistryEntry = {
  skill: {
    id: 'stack-selection',
    name: 'Stack Selection',
    description: 'Choose or preserve the project technology stack and make it explicit in the specification.',
    agentRoles: ['spec'],
    whenToUse: 'Use during specification when stackSelectionMode is auto or when userPreferences contains a manual techStackOverride.',
    promptInstructions: [
      'Determine whether stack selection is manual or auto before naming files, packages, or validators.',
      'If the user supplied a stack override, mirror it into techStack exactly and do not silently substitute defaults.',
      'If stack selection is auto, choose a coherent frontend, backend, database, ORM, validator, and styling stack based on the product requirements.',
      'Record the rationale briefly so builder and validators have a stable contract.',
    ].join('\n'),
    maxTokenBudget: 180,
    relatedValidators: ['tech-stack'],
    version: '1.0.0',
  },
  isRelevant: (ctx) => ctx.role === 'spec',
};
