// ─────────────────────────────────────────────────────────────
// Developer Agent — Generates source code files from spec
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class DeveloperAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { spec, fileAssignment, context } = task.input as {
      spec: Record<string, unknown>;
      fileAssignment: string[];
      context?: Record<string, unknown>;
    };

    let prompt = `## Technical Specification\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;

    prompt += `## Files to Generate\n\n`;
    prompt += fileAssignment.map(f => `- ${f}`).join('\n');
    prompt += '\n\n';

    if (context && Object.keys(context).length > 0) {
      prompt += `## Already Generated Files (for import resolution)\n\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\`\n\n`;
    }

    if (memories.length > 0) {
      prompt += `## Code Patterns from Memory\n\n`;
      for (const mem of memories) {
        prompt += `- [${mem.type}] ${mem.content}\n`;
      }
      prompt += '\n';
    }

    prompt += `Generate all listed files with complete, production-quality code as defined in your system prompt.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!output.files || !Array.isArray(output.files) || output.files.length === 0) {
      throw new Error('Validation: missing or empty files array');
    }
    const files = output.files as { path?: string; content?: string; language?: string }[];
    const paths = new Set<string>();
    for (const file of files) {
      if (!file.path || typeof file.path !== 'string') {
        throw new Error('Validation: file missing path');
      }
      if (paths.has(file.path)) {
        throw new Error(`Validation: duplicate file path: ${file.path}`);
      }
      paths.add(file.path);
      if (!file.content || typeof file.content !== 'string') {
        throw new Error(`Validation: file ${file.path} missing content`);
      }
      if (file.content.includes('// TODO') || file.content.includes('// ...')) {
        this.logger.warn(`[developer] File ${file.path} contains placeholder code`);
      }
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const files = (output.files as { path: string; language?: string }[]) ?? [];
    const learnings: MemoryEntry[] = [];

    const languages = [...new Set(files.map(f => f.language).filter(Boolean))];
    learnings.push({
      agentRole: 'developer',
      type: 'pattern',
      content: `Generated ${files.length} files (${languages.join(', ')}): ${files.map(f => f.path).slice(0, 8).join(', ')}${files.length > 8 ? '...' : ''}`,
      relevanceScore: 1.0,
      tags: ['code-style', 'tech-stack'],
      metadata: { fileCount: files.length, languages },
    } as MemoryEntry);

    return learnings;
  }
}
