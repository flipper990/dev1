// ─────────────────────────────────────────────────────────────
// Debugger Agent — Produces patches from review issues
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './planner-agent.js';

export class DebuggerAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { issues, affectedFiles, spec } = task.input as {
      issues: Record<string, unknown>[];
      affectedFiles: { path: string; content: string }[];
      spec?: Record<string, unknown>;
    };

    let prompt = `## Issues to Fix (${issues.length})\n\n\`\`\`json\n${JSON.stringify(issues, null, 2)}\n\`\`\`\n\n`;

    prompt += `## Affected Files\n\n`;
    for (const file of affectedFiles) {
      prompt += `### ${file.path}\n\`\`\`\n${file.content}\n\`\`\`\n\n`;
    }

    if (spec) {
      prompt += `## Project Spec (for context)\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;
    }

    if (memories.length > 0) {
      prompt += `## Known Fix Patterns\n\n`;
      for (const mem of memories) {
        prompt += `- [${mem.type}] ${mem.content}\n`;
      }
      prompt += '\n';
    }

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
        this.logger.warn(`[debugger] Patch for ${patch.file} has identical old/new content — no-op`);
      }
    }
    for (const patch of output.patches as Record<string, unknown>[]) {
      if (!patch.file || typeof patch.file !== 'string') {
        throw new Error('Validation: patch missing file path');
      }
      if (!patch.oldContent || !patch.newContent) {
        throw new Error(`Validation: patch for ${patch.file} missing oldContent or newContent`);
      }
      if (patch.oldContent === patch.newContent) {
        this.logger.warn(`[debugger] Patch for ${patch.file} has identical old/new content — no-op`);
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
