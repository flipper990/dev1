import { hasApiContracts } from './skill-utils';
import type { SkillRegistryEntry } from './types';

export const backendContractSkill: SkillRegistryEntry = {
  skill: {
    id: 'backend-contract',
    name: 'Backend Contract',
    description: 'Implement API routes, schemas, and frontend fetch paths against the specification contract.',
    agentRoles: ['builder'],
    whenToUse: 'Use when spec.apiContracts, slice apiIds, db tables, server files, or backend phases are in scope.',
    promptInstructions: [
      'Use the exact method and path from spec.apiContracts; do not invent parallel endpoints.',
      'Keep request and response shapes stable across backend handlers, frontend fetches, and QA expectations.',
      'Return structured JSON with explicit error statuses for failure cases.',
      'If persistence is required, create the schema and access layer in the stack chosen by the spec.',
    ].join('\n'),
    maxTokenBudget: 180,
    relatedValidators: ['tech-stack', 'implementation-completeness', 'preview-validator'],
    version: '1.0.0',
  },
  isRelevant: (ctx) => ctx.role === 'builder' && (hasApiContracts(ctx) || String(ctx.phase ?? '').toLowerCase() === 'backend'),
};
