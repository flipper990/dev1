// ─────────────────────────────────────────────────────────────
// Architect Agent — Converts plan into technical specification
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class ArchitectAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { plan, userPreferences } = task.input as {
      plan: Record<string, unknown>;
      userPreferences?: Record<string, unknown>;
    };

    let prompt = `## Execution Plan\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n\n`;

    if (userPreferences && Object.keys(userPreferences).length > 0) {
      prompt += `## User Preferences\n\n\`\`\`json\n${JSON.stringify(userPreferences, null, 2)}\n\`\`\`\n\n`;
    }

    if (memories.length > 0) {
      prompt += `## Architectural Patterns from Memory\n\n`;
      for (const mem of memories) {
        prompt += `- [${mem.type}] ${mem.content}\n`;
      }
      prompt += '\n';
    }

    prompt += `Convert this plan into a complete technical specification as defined in your system prompt.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!output.techStack || typeof output.techStack !== 'object') {
      throw new Error('Validation: missing techStack');
    }
    const stack = output.techStack as Record<string, unknown>;
    if (!stack.frontend || !stack.backend) {
      throw new Error('Validation: techStack must include frontend and backend');
    }
    if (!output.fileTree || !Array.isArray(output.fileTree) || output.fileTree.length === 0) {
      throw new Error('Validation: missing or empty fileTree');
    }
    // Check for duplicate paths
    const paths = new Set<string>();
    for (const path of output.fileTree as string[]) {
      if (paths.has(path)) {
        throw new Error(`Validation: duplicate file path in fileTree: ${path}`);
      }
      paths.add(path);
    }
    if (!output.apiContracts || !Array.isArray(output.apiContracts)) {
      throw new Error('Validation: missing apiContracts');
    }
    // Validate API contracts have required fields
    for (const contract of output.apiContracts as Record<string, unknown>[]) {
      if (!contract.method || !contract.path) {
        throw new Error('Validation: API contract missing method or path');
      }
    }
    if (!output.envVars || !Array.isArray(output.envVars)) {
      throw new Error('Validation: missing envVars');
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const spec = output as {
      techStack: Record<string, unknown>;
      fileTree: string[];
      apiContracts?: { method: string; path: string }[];
      dbSchema?: { tables?: { name: string }[] };
    };
    const learnings: MemoryEntry[] = [];

    learnings.push({
      agentRole: 'architect',
      type: 'pattern',
      content: `Spec: ${spec.fileTree.length} files, ${spec.apiContracts?.length ?? 0} endpoints, stack=${JSON.stringify(spec.techStack)}`,
      relevanceScore: 1.0,
      tags: ['architecture', 'tech-stack'],
      metadata: { techStack: spec.techStack, fileCount: spec.fileTree.length },
    } as MemoryEntry);

    if (spec.dbSchema?.tables && spec.dbSchema.tables.length > 0) {
      learnings.push({
        agentRole: 'architect',
        type: 'decision',
        content: `DB schema: ${spec.dbSchema.tables.map(t => t.name).join(', ')}`,
        relevanceScore: 0.9,
        tags: ['database', 'architecture'],
        metadata: { tableCount: spec.dbSchema.tables.length },
      } as MemoryEntry);
    }

    return learnings;
  }
}
