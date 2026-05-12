import { hasPreviewSignals } from './skill-utils';
import type { SkillRegistryEntry } from './types';

export const previewHealthSkill: SkillRegistryEntry = {
  skill: {
    id: 'preview-health',
    name: 'Preview Health',
    description: 'Diagnose live-preview, HTTP probe, runtime log, and container health failures.',
    agentRoles: ['qa'],
    whenToUse: 'Use when runtimeFeedback, preview logs, HTTP probes, Docker/container errors, or blank-page signals are present.',
    promptInstructions: [
      'Treat live-preview failures as gating evidence, not optional polish.',
      'Separate infrastructure symptoms from application root causes before recommending patches.',
      'If HTTP probes fail, verify route existence, server readiness, and client-side rendering before changing unrelated UI.',
      'Use logs and system checks to produce targeted issues that builder can fix in the next loop.',
    ].join('\n'),
    maxTokenBudget: 190,
    relatedValidators: ['preview-validator', 'quality-assurance'],
    version: '1.0.0',
  },
  isRelevant: (ctx) => ctx.role === 'qa' && hasPreviewSignals(ctx),
};
