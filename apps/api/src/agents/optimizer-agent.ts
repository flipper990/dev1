// ─────────────────────────────────────────────────────────────
// Optimizer Agent — Final-pass performance optimization
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class OptimizerAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { files, spec, qaReport } = task.input as {
      files: { path: string; content: string }[];
      spec: Record<string, unknown>;
      qaReport?: Record<string, unknown>;
    };

    // Filter to optimizable source files — test files and config files yield no
    // optimization benefit and can easily double the prompt token count.
    const SOURCE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|cs|rs|swift|kt)$/;
    const TEST_PAT  = /\.(test|spec)\.[^/]+$|[\\/]__tests__[\\/]/;
    const sourceFiles = files.filter(f => SOURCE_EXT.test(f.path) && !TEST_PAT.test(f.path));

    let prompt = `## Tech Stack\n\n\`\`\`json\n${JSON.stringify((spec as any).techStack ?? {})}\n\`\`\`\n\n`;

    prompt += `## Codebase to Optimize (${sourceFiles.length} source files)\n\n`;
    for (const file of sourceFiles) {
      prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }

    if (qaReport) {
      prompt += `## QA Report\n\n\`\`\`json\n${JSON.stringify(qaReport)}\n\`\`\`\n\n`;
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
