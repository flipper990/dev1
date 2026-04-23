// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Developer Agent â€” Generates source code files from spec
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

export class DeveloperAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { spec, fileAssignment, context } = task.input as {
      spec: Record<string, unknown>;
      fileAssignment: string[];
      context?: Record<string, unknown>;
    };

    // Detect whether any assigned files are frontend/UI files.
    const FRONTEND_EXT = /\.(tsx|jsx|vue|svelte)$/i;
    const FRONTEND_PATHS = /\/(components|pages|app|views|screens|ui)\//i;
    const isFrontendBatch = fileAssignment.some(
      f => FRONTEND_EXT.test(f) || FRONTEND_PATHS.test(f),
    );

    let prompt = `## Technical Specification\n\n\`\`\`json\n${JSON.stringify(spec)}\n\`\`\`\n\n`;

    // Surface the design system prominently when generating UI code so the LLM
    // doesn't have to hunt for it inside the large spec blob.
    const designSystem = (spec as { designSystem?: Record<string, unknown> }).designSystem;
    if (isFrontendBatch && designSystem) {
      prompt += `## Design System (apply to ALL UI files in this batch)\n\n`;
      prompt += `\`\`\`json\n${JSON.stringify(designSystem)}\n\`\`\`\n\n`;
      prompt += `> Use the color palette, typography scale, spacing, and border-radius tokens above.\n`;
      prompt += `> Derive Tailwind theme extension values from these tokens in tailwind.config.ts.\n`;
      prompt += `> All primitives (Button, Input, Badge, Card, etc.) must implement the variant/size system from designSystem.primitives.\n\n`;
    }

    prompt += `## Files to Generate\n\n`;
    prompt += fileAssignment.map(f => `- ${f}`).join('\n');
    prompt += '\n\n';

    if (isFrontendBatch) {
      prompt += `## Frontend Generation Checklist\n\n`;
      prompt += `For each UI file in this batch, verify before outputting:\n`;
      prompt += `- [ ] Component has a TypeScript Props interface\n`;
      prompt += `- [ ] Primitive components (Button, Input) use React.forwardRef\n`;
      prompt += `- [ ] Multi-variant primitives use CVA (class-variance-authority)\n`;
      prompt += `- [ ] cn() helper imported from src/lib/cn.ts for conditional classes\n`;
      prompt += `- [ ] Loading state implemented (Skeleton or Spinner)\n`;
      prompt += `- [ ] Empty state implemented (EmptyState component)\n`;
      prompt += `- [ ] Error state displayed inline (not just a thrown exception)\n`;
      prompt += `- [ ] All inputs have visible labels (not placeholder-only)\n`;
      prompt += `- [ ] All interactive elements have focus-visible ring styles\n`;
      prompt += `- [ ] Layout is responsive (mobile-first, sidebar collapses on <md)\n`;
      prompt += `- [ ] Spacing follows 4px grid (Tailwind p-1/p-2/p-4/p-6/p-8)\n\n`;
    }

    if (context && Object.keys(context).length > 0) {
      prompt += `## Already Generated Files (for import resolution)\n\n\`\`\`json\n${JSON.stringify(context)}\n\`\`\`\n\n`;
    }

    prompt += this.formatMemoriesForPrompt(memories);

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

  protected async extractLearnings(task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const files = (output.files as { path: string; language?: string }[]) ?? [];
    if (files.length === 0) return [];

    const spec = (task.input as { spec?: { techStack?: Record<string, string> } }).spec;
    const languages = [...new Set(files.map(f => f.language).filter(Boolean))];
    const hasFrontend = files.some(f => /\.(tsx|jsx)$/.test(f.path));
    const hasAPI = files.some(f => /\/(api|routes|controllers)\//.test(f.path));
    const hasTests = files.some(f => /\.(test|spec)\.[jt]sx?$/.test(f.path));
    const ts = spec?.techStack ?? {};
    const stackParts = [ts.frontend, ts.backend, ts.styling].filter(Boolean);

    return [{
      agentRole: 'developer',
      type: 'pattern',
      content: `Generated ${files.length} ${languages.join('+')} files${hasFrontend ? ' (UI)' : ''}${hasAPI ? ' (API)' : ''}${hasTests ? ' +tests' : ''}${stackParts.length ? ` â€” ${stackParts.join('+')}` : ''}. Paths: ${files.map(f => f.path).slice(0, 5).join(', ')}${files.length > 5 ? ' â€¦' : ''}`,
      relevanceScore: 1.0,
      tags: ['code-style', 'tech-stack', ...(hasFrontend ? ['ui-ux'] as const : [])],
      metadata: { fileCount: files.length, languages, hasFrontend, hasAPI, hasTests },
    } as unknown as MemoryEntry];
  }
}
