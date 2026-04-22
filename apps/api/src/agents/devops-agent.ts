// ─────────────────────────────────────────────────────────────
// DevOps Agent — Generates infrastructure/deployment files
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class DevOpsAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { spec, fileTree, generatedFiles } = task.input as {
      spec: Record<string, unknown>;
      fileTree?: string[];
      generatedFiles?: { path: string; language?: string }[];
    };

    let prompt = `## Project Specification\n\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\`\n\n`;

    prompt += `## File Tree\n\n`;
    prompt += (fileTree ?? []).length > 0
      ? (fileTree ?? []).map(f => `- ${f}`).join('\n')
      : '- (No file tree provided, infer from specification)';
    prompt += '\n\n';

    // Summarise generated files by language so devops can tailor the build config
    // without receiving full file content (not needed for infra generation).
    if (generatedFiles && generatedFiles.length > 0) {
      const byLang = generatedFiles.reduce<Record<string, number>>((acc, f) => {
        const lang = f.language ?? 'unknown';
        acc[lang] = (acc[lang] ?? 0) + 1;
        return acc;
      }, {});
      prompt += `## Generated Files Summary\n\n`;
      prompt += `${generatedFiles.length} files: ${Object.entries(byLang).map(([l, c]) => `${c} ${l}`).join(', ')}\n\n`;
    }

    prompt += this.formatMemoriesForPrompt(memories);

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
