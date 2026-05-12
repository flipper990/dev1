import type { AgentRole } from '../types';
import { backendContractSkill } from './backend-contract';
import { budgetCheckSkill } from './budget-check';
import { dependencyRepairSkill } from './dependency-repair';
import { exportReadinessSkill } from './export-readiness';
import { previewHealthSkill } from './preview-health';
import { stackSelectionSkill } from './stack-selection';
import { testGapsSkill } from './test-gaps';
import type { DevteamSkill, SkillId, SkillRegistryEntry, SkillSelectionContext } from './types';

export const DEVTEAM_SKILL_REGISTRY: readonly SkillRegistryEntry[] = [
  stackSelectionSkill,
  dependencyRepairSkill,
  previewHealthSkill,
  backendContractSkill,
  budgetCheckSkill,
  testGapsSkill,
  exportReadinessSkill,
] as const;

export const DEVTEAM_SKILLS: readonly DevteamSkill[] = DEVTEAM_SKILL_REGISTRY.map((entry) => entry.skill);

export function getSkill(id: SkillId): DevteamSkill | undefined {
  return DEVTEAM_SKILLS.find((skill) => skill.id === id);
}

export function getSkillsForRole(role: AgentRole): DevteamSkill[] {
  return DEVTEAM_SKILLS.filter((skill) => skill.agentRoles.includes(role));
}

export function selectSkillsForPrompt(context: SkillSelectionContext): DevteamSkill[] {
  return DEVTEAM_SKILL_REGISTRY
    .filter((entry) => entry.skill.agentRoles.includes(context.role))
    .filter((entry) => entry.isRelevant(context))
    .map((entry) => entry.skill);
}

export function renderSkillsForPrompt(context: SkillSelectionContext): string {
  const skills = selectSkillsForPrompt(context);
  if (skills.length === 0) return '';

  const sections = skills.map((skill) => [
    `### ${skill.name} (${skill.id}, v${skill.version}, budget ${skill.maxTokenBudget} tokens)`,
    skill.whenToUse,
    skill.promptInstructions,
    `Related validators: ${skill.relatedValidators.join(', ')}`,
  ].join('\n'));

  return [
    '## DEVteam Skill Playbooks',
    'Use only the playbooks below for this task. They are internal guidance, not external plugins.',
    ...sections,
    '',
  ].join('\n\n');
}

export function validateSkillRegistry(entries: readonly SkillRegistryEntry[] = DEVTEAM_SKILL_REGISTRY): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const skill = entry.skill;
    if (!skill.id) errors.push('skill missing id');
    if (seen.has(skill.id)) errors.push(`duplicate skill id: ${skill.id}`);
    seen.add(skill.id);
    if (!skill.name.trim()) errors.push(`${skill.id}: name missing`);
    if (!skill.description.trim()) errors.push(`${skill.id}: description missing`);
    if (!Array.isArray(skill.agentRoles) || skill.agentRoles.length === 0) errors.push(`${skill.id}: agentRoles missing`);
    if (!skill.whenToUse.trim()) errors.push(`${skill.id}: whenToUse missing`);
    if (!skill.promptInstructions.trim()) errors.push(`${skill.id}: promptInstructions missing`);
    if (!Number.isInteger(skill.maxTokenBudget) || skill.maxTokenBudget <= 0) errors.push(`${skill.id}: maxTokenBudget must be a positive integer`);
    if (!Array.isArray(skill.relatedValidators)) errors.push(`${skill.id}: relatedValidators must be an array`);
    if (!/^\d+\.\d+\.\d+$/.test(skill.version)) errors.push(`${skill.id}: version must be semver`);
    if (typeof entry.isRelevant !== 'function') errors.push(`${skill.id}: relevance predicate missing`);
  }
  return errors;
}
