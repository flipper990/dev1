// ─────────────────────────────────────────────────────────────
// Optimizer Agent — Final-pass performance optimization
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './planner-agent.js';

export class OptimizerAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { files, spec, qaReport } = task.input as {
      files: { path: string; content: string }[];
      spec: Record<string, unknown>;
      qaReport?: Record<string, unknown>;
    };

    let prompt = `## Project Specification\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;

    prompt += `## Codebase (${files.length} files)\n\n`;
    for (const file of files) {
      prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }

    if (qaReport) {
      prompt += `## QA Report\n\n\`\`\`json\n${JSON.stringify(qaReport, null, 2)}\n\`\`\`\n\n`;
    }

    if (memories.length > 0) {
      prompt += `## Optimization Patterns from Memory\n\n`;
      for (const mem of memories) {
        prompt += `- [${mem.type}] ${mem.content}\n`;
      }
      prompt += '\n';
    }

    prompt += `Perform optimization analysis and produce patches as defined in your system prompt.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!output.patches || !Array.isArray(output.patches)) {
      throw new Error('Validation: missing patches array');
    }
    for (const patch of output.patches as Record<string, unknown>[]) {
      if (!patch.file || !patch.oldContent || !patch.newContent) {
        throw new Error('Validation: optimization patch missing file, oldContent, or newContent');
      }
    }
    if (!output.recommendations || !Array.isArray(output.recommendations)) {
      throw new Error('Validation: missing recommendations array');
    }
    if (!output.perfEstimate || typeof output.perfEstimate !== 'object') {
      throw new Error('Validation: missing perfEstimate object {
        throw new Error('Validation: optimization patch missing file, oldContent, or newContent');
      }
    }
    if (!output.recommendations || !Array.isArray(output.recommendations)) {
      throw new Error('Validation: missing recommendations array');
    }
    if (!output.perfEstimate || typeof output.perfEstimate !== 'object') {
      throw new Error('Validation: missing perfEstimate object');
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const patches = (output.patches as { category: string; impact: string }[]) ?? [];
    if (patches.length === 0) return [];

    return [{
      agentRole: 'optimizer',
      type: 'pattern' as const,
      content: `Applied ${patches.length} optimizations: ${patches.map(p => p.category).join(', ')}`,
      relevanceScore: 1.0,
      tags: ['performance'],
      metadata: { categories: patches.map(p => p.category) },
    } as MemoryEntry];
  }
}
