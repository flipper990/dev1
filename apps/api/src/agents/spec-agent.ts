// ─────────────────────────────────────────────────────────────
// Spec Agent — combines intent expansion + planning + architecture
// into a single authoritative product specification.
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class SpecAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { prompts, userPreferences, globalMemoryHints } = task.input as {
      prompts: string[];
      userPreferences?: Record<string, unknown>;
      globalMemoryHints?: string[];
    };

    let prompt = '';

    // ── STACK SELECTION MODE ───────────────────────────────────────────────
    // 'auto' (default): the user did not pick a stack in the UI; the spec
    //   agent must choose an appropriate stack based on the prompt's intent.
    // 'manual': the user picked specific technologies — they are emitted
    //   below as a hard, non-negotiable override.
    //
    // Backward safety: legacy projects with no `stackSelectionMode` are
    // treated as 'manual' iff a non-empty `techStackOverride` exists, else
    // 'auto'.
    const override =
      (userPreferences?.techStackOverride as Record<string, string> | undefined) ??
      undefined;
    const declaredMode = userPreferences?.stackSelectionMode as 'auto' | 'manual' | undefined;
    const stackSelectionMode: 'auto' | 'manual' =
      declaredMode === 'manual' || declaredMode === 'auto'
        ? declaredMode
        : override && Object.keys(override).length > 0
          ? 'manual'
          : 'auto';

    const injectOverride = stackSelectionMode === 'manual' && !!override && Object.keys(override).length > 0;

    this.logger.info('spec:stack', {
      stackSelectionMode,
      injectedBlock: injectOverride,
      override: override ?? null,
    });

    if (stackSelectionMode === 'auto') {
      prompt += `## ⚙️ STACK SELECTION MODE: AUTO\n\n`;
      prompt += `The user has NOT manually picked a tech stack. Choose the most appropriate\n`;
      prompt += `stack for the requested product based on the prompt's intent and constraints.\n`;
      prompt += `Justify your choice in the spec briefly. Do not silently fall back to a\n`;
      prompt += `template default if a different stack better fits the user's request.\n\n`;
    }

    if (injectOverride) {
      prompt += `## ⛔ CRITICAL — USER-CHOSEN TECH STACK (HARD OVERRIDE)\n\n`;
      prompt += `The user picked this stack in the UI. This OVERRIDES every default in your\n`;
      prompt += `system prompt (Fastify, Postgres+Prisma, Next.js, etc.). DO NOT substitute,\n`;
      prompt += `"upgrade", or fall back to defaults. Emit techStack values that match these\n`;
      prompt += `picks verbatim. Pick npm packages and file-tree entries that fit this stack.\n\n`;
      for (const [k, v] of Object.entries(override!)) {
        prompt += `  • ${k}: ${v}\n`;
      }
      prompt += `\nIf a chosen technology is incompatible with another (e.g. Prisma + MongoDB),\n`;
      prompt += `prefer the user's most-specific pick and adapt the rest. Never silently swap.\n\n`;
      prompt += `Mirror these picks into the output techStack object exactly:\n`;
      prompt += `\`\`\`json\n${JSON.stringify(override, null, 2)}\n\`\`\`\n\n`;
    }

    prompt += `## User Prompts (${prompts.length})\n\n`;
    prompts.forEach((p, i) => { prompt += `### Prompt ${i + 1}\n${p}\n\n`; });

    if (userPreferences && Object.keys(userPreferences).length > 0) {
      prompt += `## User Preferences\n\n\`\`\`json\n${JSON.stringify(userPreferences, null, 2)}\n\`\`\`\n\n`;
    }

    if (Array.isArray(globalMemoryHints) && globalMemoryHints.length > 0) {
      prompt += `## Memory Hints\n\n${globalMemoryHints.map(h => `- ${h}`).join('\n')}\n\n`;
    }

    prompt += this.formatMemoriesForPrompt(memories);

    prompt += `Produce the full product specification per the JSON schema in your system prompt.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (typeof output.expandedPrompt !== 'string' || output.expandedPrompt.length < 100) {
      throw new Error('Validation: expandedPrompt missing or too short (<100 chars)');
    }
    if (!Array.isArray(output.fileTree) || output.fileTree.length === 0) {
      throw new Error('Validation: fileTree missing or empty');
    }
    if (!Array.isArray(output.apiContracts)) {
      throw new Error('Validation: apiContracts missing');
    }
    if (!Array.isArray(output.frontendPages)) {
      throw new Error('Validation: frontendPages missing');
    }
    if (!Array.isArray(output.components)) {
      throw new Error('Validation: components missing');
    }
    if (!Array.isArray(output.featureSlices) || output.featureSlices.length === 0) {
      throw new Error('Validation: featureSlices missing or empty — product must be decomposed into at least one slice');
    }
    for (const s of output.featureSlices as Array<Record<string, unknown>>) {
      if (typeof s.id !== 'string' || s.id.length === 0) {
        throw new Error('Validation: every featureSlice requires an id');
      }
      if (!Array.isArray(s.acceptance) || s.acceptance.length === 0) {
        throw new Error(`Validation: featureSlice '${s.id}' must list at least one acceptance criterion`);
      }
    }
    // Per-page detail: every page must list its components AND describe its
    // sections / interactions so the builder has a concrete render target.
    // Pages without components produce empty shells.
    for (const p of output.frontendPages as Array<Record<string, unknown>>) {
      const path = (p.path as string) ?? '<unknown>';
      if (!Array.isArray(p.components) || p.components.length === 0) {
        throw new Error(`Validation: frontendPages '${path}' must list at least one component`);
      }
      // sections + interactions are strongly encouraged but tolerated as
      // empty arrays for trivial pages (e.g. /404). We require the keys to
      // exist so the LLM commits to the shape.
      if (p.sections !== undefined && !Array.isArray(p.sections)) {
        throw new Error(`Validation: frontendPages '${path}'.sections must be an array if present`);
      }
      if (p.interactions !== undefined && !Array.isArray(p.interactions)) {
        throw new Error(`Validation: frontendPages '${path}'.interactions must be an array if present`);
      }
    }
    // userFlows: at least one flow must exist so the builder has an end-to-end
    // journey to wire and QA can validate something. We do NOT require one
    // flow per featureSlice as a hard error — content-heavy pages (marketing
    // landing pages, docs sites) legitimately have many "section" slices but
    // a small number of real flows. The semantic validator emits a warning
    // when flows.length < slices.length so it's still surfaced.
    if (!Array.isArray(output.userFlows) || output.userFlows.length === 0) {
      throw new Error(
        'Validation: userFlows missing or empty — every spec must declare at least one end-to-end user flow (e.g. "visitor reads landing page and clicks primary CTA")',
      );
    }
    for (const f of output.userFlows as Array<Record<string, unknown>>) {
      const id = (f.id as string) ?? '<unknown>';
      if (typeof f.id !== 'string' || f.id.length === 0) {
        throw new Error('Validation: every userFlow requires an id');
      }
      if (!Array.isArray(f.steps) || f.steps.length === 0) {
        throw new Error(`Validation: userFlow '${id}' must list at least one step`);
      }
      for (const [i, step] of (f.steps as Array<Record<string, unknown>>).entries()) {
        if (typeof step.page !== 'string' || step.page.length === 0) {
          throw new Error(`Validation: userFlow '${id}'.steps[${i}].page is required`);
        }
        if (typeof step.action !== 'string' || step.action.length === 0) {
          throw new Error(`Validation: userFlow '${id}'.steps[${i}].action is required`);
        }
      }
    }
    if (!output.techStack || typeof output.techStack !== 'object') {
      throw new Error('Validation: techStack missing');
    }
    if (!output.designSystem || typeof output.designSystem !== 'object') {
      throw new Error('Validation: designSystem missing');
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const spec = output as {
      productCategory?: string;
      techStack?: Record<string, string>;
      fileTree?: unknown[];
      apiContracts?: unknown[];
      features?: { core?: unknown[] };
    };
    const learnings: MemoryEntry[] = [];
    const ts = spec.techStack ?? {};

    const stackParts = [ts.frontend, ts.backend, ts.database, ts.styling].filter(Boolean);
    if (stackParts.length > 0) {
      learnings.push({
        agentRole: 'spec',
        type: 'decision',
        content: `${spec.productCategory ?? 'product'} → stack ${stackParts.join(' + ')} • ${spec.fileTree?.length ?? 0} files • ${spec.apiContracts?.length ?? 0} endpoints`,
        relevanceScore: 1.1,
        tags: ['spec', 'architecture', 'tech-stack'],
        metadata: { techStack: ts, fileCount: spec.fileTree?.length ?? 0 },
      } as unknown as MemoryEntry);
    }

    const coreFeatures = spec.features?.core ?? [];
    if (coreFeatures.length > 0) {
      learnings.push({
        agentRole: 'spec',
        type: 'pattern',
        content: `Core features for ${spec.productCategory ?? 'product'}: ${coreFeatures.slice(0, 8).join(', ')}`,
        relevanceScore: 0.9,
        tags: ['spec', 'features'],
        metadata: { category: spec.productCategory },
      } as unknown as MemoryEntry);
    }

    return learnings;
  }
}
