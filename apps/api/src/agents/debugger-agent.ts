// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Debugger Agent â€” Produces patches from review issues
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class DebuggerAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { issues, affectedFiles, spec } = task.input as {
      issues: Record<string, unknown>[];
      affectedFiles: { path: string; content: string }[];
      spec?: Record<string, unknown>;
    };

    let prompt = `## Issues to Fix (${issues.length})\n\n\`\`\`json\n${JSON.stringify(issues)}\n\`\`\`\n\n`;

    prompt += `## Affected Files\n\n`;
    for (const file of affectedFiles) {
      prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }

    // Only include tech stack â€” fixes should match the project's language/framework style.
    // All other spec fields are already encoded in the file content above.
    if (spec && (spec as any).techStack) {
      prompt += `## Tech Stack (for fix style reference)\n\n\`\`\`json\n${JSON.stringify((spec as any).techStack)}\n\`\`\`\n\n`;
    }

    prompt += this.formatMemoriesForPrompt(memories);

    prompt += `Produce patches for the issues as defined in your system prompt. Fix critical and high severity first.`;
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
      if (!patch.file || typeof patch.file !== 'string') {
        throw new Error('Validation: patch missing file path');
      }
      if (!patch.oldContent || !patch.newContent) {
        throw new Error(`Validation: patch for ${patch.file} missing oldContent or newContent`);
      }
      if (patch.oldContent === patch.newContent) {
        this.logger.warn(`[debugger] Patch for ${patch.file} has identical old/new content â€” no-op`);
      }
    }
    if (!output.unresolved || !Array.isArray(output.unresolved)) {
      throw new Error('Validation: missing unresolved array');
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const patches = (output.patches as { file: string; explanation: string }[]) ?? [];
    return patches.slice(0, 3).map(p => ({
      agentRole: 'debugger',
      type: 'error_fix' as const,
      content: `Fixed ${p.file}: ${p.explanation}`,
      relevanceScore: 1.2,
      tags: ['error-handling'],
      metadata: { file: p.file },
    })) as MemoryEntry[];
  }
}
