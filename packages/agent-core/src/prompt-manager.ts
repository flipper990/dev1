// ─────────────────────────────────────────────────────────────
// Prompt Manager — Configurable, versioned, composable prompts
// ─────────────────────────────────────────────────────────────

import type { AgentRole, PromptConfig, PromptExample } from './types';
import { PROMPTS } from './prompts';

// ── Prompt Registry ─────────────────────────────────────────

interface PromptVersion {
  version: string;
  prompt: string;
  createdAt: Date;
  isActive: boolean;
}

interface PromptEntry {
  role: AgentRole;
  versions: PromptVersion[];
  overrides: Map<string, string>;  // key=session/user scope, value=override prompt
  config: PromptConfig;
}

// ── Prompt Manager ──────────────────────────────────────────

export class PromptManager {
  private registry: Map<AgentRole, PromptEntry> = new Map();

  constructor() {
    this.loadDefaults();
  }

  /** Get the active prompt for an agent, with optional scope override */
  getPrompt(role: AgentRole, scope?: string): string {
    const entry = this.registry.get(role);
    if (!entry) return PROMPTS[role] ?? '';

    // Check scope-specific override first
    if (scope && entry.overrides.has(scope)) {
      return entry.overrides.get(scope)!;
    }

    // Return active version
    const active = entry.versions.find(v => v.isActive);
    return active?.prompt ?? PROMPTS[role] ?? '';
  }

  /** Get full prompt config for an agent */
  getConfig(role: AgentRole): PromptConfig {
    const entry = this.registry.get(role);
    if (!entry) {
      return {
        systemPrompt: PROMPTS[role] ?? '',
        templateVars: {},
        maxInputLength: 100_000,
        responseFormat: 'json',
        version: '1.0.0',
      };
    }
    return { ...entry.config };
  }

  /** Register a new prompt version for an agent */
  addVersion(role: AgentRole, version: string, prompt: string, activate = false): void {
    const entry = this.getOrCreateEntry(role);

    if (activate) {
      entry.versions.forEach(v => v.isActive = false);
    }

    entry.versions.push({
      version,
      prompt,
      createdAt: new Date(),
      isActive: activate,
    });

    if (activate) {
      entry.config.systemPrompt = prompt;
      entry.config.version = version;
    }
  }

  /** Activate a specific version */
  activateVersion(role: AgentRole, version: string): boolean {
    const entry = this.registry.get(role);
    if (!entry) return false;

    const target = entry.versions.find(v => v.version === version);
    if (!target) return false;

    entry.versions.forEach(v => v.isActive = false);
    target.isActive = true;
    entry.config.systemPrompt = target.prompt;
    entry.config.version = version;
    return true;
  }

  /** Set a scope-specific override (e.g., per-user or per-session) */
  setOverride(role: AgentRole, scope: string, prompt: string): void {
    const entry = this.getOrCreateEntry(role);
    entry.overrides.set(scope, prompt);
  }

  /** Remove a scope-specific override */
  removeOverride(role: AgentRole, scope: string): boolean {
    const entry = this.registry.get(role);
    return entry?.overrides.delete(scope) ?? false;
  }

  /** Set template variables for an agent */
  setTemplateVars(role: AgentRole, vars: Record<string, string>): void {
    const entry = this.getOrCreateEntry(role);
    entry.config.templateVars = { ...entry.config.templateVars, ...vars };
  }

  /** Set examples for few-shot prompting */
  setExamples(role: AgentRole, examples: PromptExample[]): void {
    const entry = this.getOrCreateEntry(role);
    entry.config.examples = examples;
  }

  /** Compose a full prompt: system + examples + template vars applied */
  compose(role: AgentRole, scope?: string, extraVars?: Record<string, string>): string {
    const entry = this.registry.get(role);
    let prompt = this.getPrompt(role, scope);

    // Apply template variables
    const vars: Record<string, string> = {
      ...(entry?.config.templateVars ?? {}),
      ...(extraVars ?? {}),
    };

    prompt = prompt.replace(/\{\{(\w+)\}\}/g, (match, key) => {
      return key in vars ? vars[key] : match;
    });

    // Append examples if configured
    const examples = entry?.config.examples;
    if (examples && examples.length > 0) {
      prompt += '\n\nEXAMPLES:\n';
      for (const ex of examples) {
        if (ex.description) prompt += `\n// ${ex.description}\n`;
        prompt += `Input:\n${ex.input}\n\nExpected Output:\n${ex.output}\n`;
        prompt += '---\n';
      }
    }

    return prompt;
  }

  /** List all versions for an agent */
  listVersions(role: AgentRole): { version: string; isActive: boolean; createdAt: Date }[] {
    const entry = this.registry.get(role);
    if (!entry) return [];
    return entry.versions.map(v => ({
      version: v.version,
      isActive: v.isActive,
      createdAt: v.createdAt,
    }));
  }

  /** Export all prompts for backup/migration */
  exportAll(): Record<AgentRole, { active: string; config: PromptConfig }> {
    const result: Record<string, { active: string; config: PromptConfig }> = {};
    for (const [role, entry] of this.registry) {
      result[role] = {
        active: entry.versions.find(v => v.isActive)?.prompt ?? '',
        config: entry.config,
      };
    }
    return result as Record<AgentRole, { active: string; config: PromptConfig }>;
  }

  // ── Private ───────────────────────────────────────────

  private loadDefaults(): void {
    const roles: AgentRole[] = [
      'planner', 'architect', 'developer', 'reviewer',
      'tester', 'debugger', 'devops', 'optimizer',
    ];

    for (const role of roles) {
      const prompt = PROMPTS[role];
      if (!prompt) continue;

      this.registry.set(role, {
        role,
        versions: [{
          version: '1.0.0',
          prompt,
          createdAt: new Date(),
          isActive: true,
        }],
        overrides: new Map(),
        config: {
          systemPrompt: prompt,
          templateVars: {},
          maxInputLength: 100_000,
          responseFormat: 'json',
          version: '1.0.0',
        },
      });
    }
  }

  private getOrCreateEntry(role: AgentRole): PromptEntry {
    if (!this.registry.has(role)) {
      const prompt = PROMPTS[role] ?? '';
      this.registry.set(role, {
        role,
        versions: [{
          version: '1.0.0',
          prompt,
          createdAt: new Date(),
          isActive: true,
        }],
        overrides: new Map(),
        config: {
          systemPrompt: prompt,
          templateVars: {},
          maxInputLength: 100_000,
          responseFormat: 'json',
          version: '1.0.0',
        },
      });
    }
    return this.registry.get(role)!;
  }
}
