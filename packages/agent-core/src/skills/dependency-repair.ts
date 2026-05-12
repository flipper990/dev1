import { hasDependencySignals } from './skill-utils';
import type { SkillRegistryEntry } from './types';

export const dependencyRepairSkill: SkillRegistryEntry = {
  skill: {
    id: 'dependency-repair',
    name: 'Dependency Repair',
    description: 'Keep package declarations, imports, and framework versions consistent before runtime validation.',
    agentRoles: ['builder'],
    whenToUse: 'Use when builder is emitting config, responding to dependency or import feedback, or touching files with bare module imports.',
    promptInstructions: [
      'Every bare module import must be declared in the nearest package.json dependency or devDependency block.',
      'Do not add packages for relative imports, Node built-ins, CSS assets, images, or local alias paths.',
      'Prefer the existing stack versions already present in package.json; only add or adjust packages needed by emitted code.',
      'When repairing ERESOLVE or peer dependency failures, choose compatible package majors rather than forcing install flags.',
    ].join('\n'),
    maxTokenBudget: 170,
    relatedValidators: ['dependency-validator', 'final-integrity-gate'],
    version: '1.0.0',
  },
  isRelevant: (ctx) => ctx.role === 'builder' && hasDependencySignals(ctx),
};
