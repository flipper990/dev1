// ─────────────────────────────────────────────────────────────
// Reviewer Agent — Reviews code for correctness and security
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class ReviewerAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { spec, files } = task.input as {
      spec: Record<string, unknown>;
      files: { path: string; content: string }[];
    };

    // Send only the contract-verification surface — the full spec (fileTree, dbSchema,
    // components) is already encoded in the code and doubles the token count needlessly.
    const verificationRef = {
      apiContracts: (spec as any).apiContracts ?? [],
      envVars:      (spec as any).envVars ?? [],
    };

    let prompt = `## Verification Reference\n\n\`\`\`json\n${JSON.stringify(verificationRef)}\n\`\`\`\n\n`;

    prompt += `## Generated Codebase (${files.length} files)\n\n`;
    for (const file of files) {
      prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }

    if (memories.length > 0) {
      prompt += `## Known Bug Patterns\n\n`;
      for (const mem of memories) {
        prompt += `- [${mem.type}] ${mem.content}\n`;
      }
      prompt += '\n';
    }

    prompt += `Review the codebase and produce a report as defined in your system prompt.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!output.issues || !Array.isArray(output.issues)) {
      throw new Error('Validation: missing issues array');
    }
    const validSeverities = new Set(['critical', 'high', 'medium', 'low', 'info']);
    for (const issue of output.issues as Record<string, unknown>[]) {
      if (!issue.file || !issue.severity || !issue.description) {
        throw new Error('Validation: issue missing required fields (file, severity, description)');
      }
      if (!validSeverities.has(issue.severity as string)) {
        throw new Error(`Validation: invalid severity "${issue.severity}", must be critical|high|medium|low|info`);
      }
    }
    if (typeof output.score !== 'number' || output.score < 0 || output.score > 100) {
      throw new Error('Validation: score must be 0–100');
    }
    if (typeof output.passable !== 'boolean') {
      throw new Error('Validation: passable must be boolean');
    }
    if (!output.summary || typeof output.summary !== 'string') {
      throw new Error('Validation: missing review summary');
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const issues = (output.issues as { category: string; severity: string; description: string }[]) ?? [];
    const critical = issues.filter(i => i.severity === 'critical' || i.severity === 'high');
    if (critical.length === 0) return [];

    return critical.slice(0, 3).map(issue => ({
      agentRole: 'reviewer',
      type: 'error_fix' as const,
      content: `[${issue.severity}/${issue.category}] ${issue.description}`,
      relevanceScore: 1.5,
      tags: ['error-handling', issue.category as string],
      metadata: { severity: issue.severity, category: issue.category },
    })) as MemoryEntry[];
  }
}
