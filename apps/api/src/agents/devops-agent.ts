// ─────────────────────────────────────────────────────────────
// DevOps Agent — Generates infrastructure/deployment files
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class DevOpsAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { spec, fileTree, files, plan } = task.input as {
      spec: Record<string, unknown>;
      fileTree?: string[];
      files?: { path?: string }[];
      plan?: Record<string, unknown>;
    };

    const inferredTree = Array.isArray(fileTree)
      ? fileTree
      : Array.isArray(files)
        ? files.map(f => f.path).filter((p): p is string => typeof p === 'string')
        : [];

    let prompt = `## Project Specification\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;

    if (plan && Object.keys(plan).length > 0) {
      prompt += `## Execution Plan\n\n\`\`\`json\n${JSON.stringify(plan, null, 2)}\n\`\`\`\n\n`;
    }

    prompt += `## File Tree\n\n`;
    prompt += inferredTree.length > 0
      ? inferredTree.map(f => `- ${f}`).join('\n')
      : '- (No file tree provided, infer from specification)';
    prompt += '\n\n';

    if (memories.length > 0) {
      prompt += `## Infrastructure Patterns from Memory\n\n`;
      for (const mem of memories) {
        prompt += `- [${mem.type}] ${mem.content}\n`;
      }
      prompt += '\n';
    }

    prompt += `Generate infrastructure and deployment files as defined in your system prompt.`;
    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!output.files || !Array.isArray(output.files) || output.files.length === 0) {
      throw new Error('Validation: missing or empty files array');
    }

    const files = output.files as { path?: string; content?: string }[];
    for (const file of files) {
      if (!file.path || typeof file.path !== 'string') {
        throw new Error('Validation: devops output file missing path');
      }
      if (!file.content || typeof file.content !== 'string') {
        throw new Error(`Validation: devops file ${file.path} missing content`);
      }
    }

    const requiredFiles = [
      'Dockerfile',
      'docker-compose.yml',
      '.env.example',
      '.dockerignore',
      '.gitignore',
      'scripts/deploy.sh',
      'scripts/deploy.ps1',
    ];
    const generatedPaths = new Set((output.files as { path: string }[]).map(f => f.path));
    for (const req of requiredFiles) {
      if (!generatedPaths.has(req)) {
        this.logger.warn(`[devops] Missing expected file: ${req}`);
      }
    }
  }

  protected async extractLearnings(_task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const files = (output.files as { path: string }[]) ?? [];
    if (files.length === 0) return [];

    return [{
      agentRole: 'devops',
      type: 'pattern',
      content: `Generated ${files.length} infra files: ${files.map(f => f.path).join(', ')}`,
      relevanceScore: 0.7,
      tags: ['deployment'],
      metadata: { fileCount: files.length },
    } as MemoryEntry];
  }
}
