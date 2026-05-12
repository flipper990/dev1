import { hasExportReadinessSignals } from './skill-utils';
import type { SkillRegistryEntry } from './types';

export const exportReadinessSkill: SkillRegistryEntry = {
  skill: {
    id: 'export-readiness',
    name: 'Export Readiness',
    description: 'Check that the generated project can be downloaded, installed, configured, and handed off cleanly.',
    agentRoles: ['polish'],
    whenToUse: 'Use during final polish when a real file tree exists and the project is approaching export or handoff.',
    promptInstructions: [
      'Ensure package scripts, environment examples, README notes, and deployment/config files match the generated stack.',
      'Remove internal-only diagnostics, dead placeholders, and references to unavailable backend services from user-facing files.',
      'Preserve source ownership: do not rename routes, delete generated features, or change stack choices late in polish.',
      'Prefer small targeted patches that improve handoff readiness without adding new product scope.',
    ].join('\n'),
    maxTokenBudget: 160,
    relatedValidators: ['production-polish-audit', 'final-integrity-gate'],
    version: '1.0.0',
  },
  isRelevant: (ctx) => ctx.role === 'polish' && hasExportReadinessSignals(ctx),
};
