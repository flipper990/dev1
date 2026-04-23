// ─────────────────────────────────────────────────────────────
// Intent Expander Agent — first stage of the pipeline
// Converts vague user prompts into a rich product specification.
// Output's expandedPrompts[] replaces the raw user prompt for
// every downstream agent.
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class IntentExpanderAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { prompts, userPreferences } = task.input as {
      prompts: string[];
      userPreferences?: Record<string, unknown>;
    };

    const sections: string[] = [];

    sections.push('## Original User Prompts\n');
    prompts.forEach((p, i) => sections.push(`**Prompt ${i + 1}:** ${p}`));

    if (userPreferences && Object.keys(userPreferences).length > 0) {
      sections.push(`## User Preferences\n\n\`\`\`json\n${JSON.stringify(userPreferences)}\n\`\`\``);
    }

    sections.push(this.formatMemoriesForPrompt(memories));

    sections.push(
      'Expand these prompts into the detailed product specification defined in your system prompt. ' +
      'The expandedPrompts[0] field is the single source of truth every downstream agent will consume.',
    );
    return sections.join('\n\n');
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    const requireString = (k: string) => {
      if (!output[k] || typeof output[k] !== 'string') {
        throw new Error(`Validation: missing or invalid ${k}`);
      }
    };
    requireString('productName');
    requireString('productCategory');
    requireString('oneLiner');

    if (!Array.isArray(output.expandedPrompts) || output.expandedPrompts.length === 0) {
      throw new Error('Validation: expandedPrompts must be a non-empty array');
    }
    const first = output.expandedPrompts[0];
    if (typeof first !== 'string' || first.trim().length < 200) {
      throw new Error('Validation: expandedPrompts[0] must be a detailed prompt (>= 200 chars)');
    }

    if (!output.features || typeof output.features !== 'object') {
      throw new Error('Validation: missing features');
    }
    const features = output.features as Record<string, unknown>;
    if (!Array.isArray(features.core) || features.core.length === 0) {
      throw new Error('Validation: features.core must be a non-empty array');
    }

    if (!output.uiExpectations || typeof output.uiExpectations !== 'object') {
      throw new Error('Validation: missing uiExpectations');
    }
    if (!output.qualityStandards || typeof output.qualityStandards !== 'object') {
      throw new Error('Validation: missing qualityStandards');
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const spec = output as {
      productName?: string;
      productCategory?: string;
      features?: { core?: unknown[] };
    };
    const coreCount = Array.isArray(spec.features?.core) ? spec.features!.core!.length : 0;
    return [
      {
        agentRole: 'intent_expander',
        type: 'pattern',
        content: `Expanded "${spec.productName ?? 'unknown'}" (${spec.productCategory ?? 'n/a'}) with ${coreCount} core features`,
        relevanceScore: 0.9,
        tags: ['intent', 'product-spec'],
        metadata: { productName: spec.productName, productCategory: spec.productCategory, coreFeatureCount: coreCount },
      } as unknown as MemoryEntry,
    ];
  }
}
