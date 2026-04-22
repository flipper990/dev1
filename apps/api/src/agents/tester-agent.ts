// ─────────────────────────────────────────────────────────────
// Tester Agent — Generates test suites
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class TesterAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { files, apiContracts, spec } = task.input as {
      files: { path: string; content: string }[];
      apiContracts: Record<string, unknown>[];
      spec: Record<string, unknown>;
    };

    let prompt = `## Project Specification\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;

    prompt += `## Source Files (${files.length} files)\n\n`;
    for (const file of files) {
      prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }

    if (apiContracts.length > 0) {
      prompt += `## API Contracts\n\n\`\`\`json\n${JSON.stringify(apiContracts, null, 2)}\n\`\`\`\n\n`;
    }

    if (memories.length > 0) {
      prompt += `## Testing Patterns from Memory\n\n`;
      for (const mem of memories) {
        prompt += `- [${mem.type}] ${mem.content}\n`;
      }
      prompt += '\n';
    }

    prompt += `Generate test files as defined in your system prompt.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!output.testFiles || !Array.isArray(output.testFiles) || output.testFiles.length === 0) {
      throw new Error('Validation: missing or empty testFiles');
    }
    const validTypes = new Set(['unit', 'integration', 'component', 'e2e']);
    for (const tf of output.testFiles as Record<string, unknown>[]) {
      if (!tf.path || !tf.content) {
        throw new Error('Validation: test file missing path or content');
      }
      if (tf.testType && !validTypes.has(tf.testType as string)) {
        this.logger.warn(`[tester] Unknown test type: ${tf.testType}`);
      }
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const testFiles = (output.testFiles as { path: string; testType?: string }[]) ?? [];
    if (testFiles.length === 0) return [];

    const byType = new Map<string, number>();
    for (const f of testFiles) {
      const t = f.testType ?? 'unknown';
      byType.set(t, (byType.get(t) ?? 0) + 1);
    }
    const breakdown = Array.from(byType.entries()).map(([t, c]) => `${c} ${t}`).join(', ');

    return [{
      agentRole: 'tester',
      type: 'pattern',
      content: `Generated ${testFiles.length} test files (${breakdown})`,
      relevanceScore: 0.8,
      tags: ['testing'],
      metadata: { testCount: testFiles.length },
    } as MemoryEntry];
  }
}
