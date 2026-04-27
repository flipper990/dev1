// ─────────────────────────────────────────────────────────────
// Builder Agent — generates the full-stack codebase from the spec.
// Re-runs in QA-feedback mode when QA verdict = 'needs-improvement'.
// ─────────────────────────────────────────────────────────────

import { BaseAgent } from '../../../../packages/agent-core/src/base-agent.js';
import type { Task, MemoryEntry } from '../../../../packages/agent-core/src/types.js';
import { extractJSON } from './utils.js';

interface FeatureSlice {
  id: string;
  purpose?: string;
  routes?: string[];
  apiIds?: string[];
  dbTables?: string[];
  components?: string[];
  acceptance?: string[];
}

interface BuilderInput {
  spec: Record<string, unknown>;
  existingFiles?: Array<{ path: string; content: string; language?: string }>;
  qaFeedback?: Record<string, unknown>;
  iteration?: number;
  currentSlice?: FeatureSlice;
  sliceIndex?: number;
  totalSlices?: number;
}

export class BuilderAgent extends BaseAgent {
  protected async buildPrompt(task: Task, memories: MemoryEntry[]): Promise<string> {
    const { spec, existingFiles, qaFeedback, iteration, currentSlice, sliceIndex, totalSlices } =
      task.input as unknown as BuilderInput;
    const iter = iteration ?? 1;

    let prompt = `## Build Iteration: ${iter}\n\n`;

    if (currentSlice && typeof sliceIndex === 'number' && typeof totalSlices === 'number') {
      prompt += `## ⚡ ACTIVE FEATURE SLICE — ${sliceIndex + 1} of ${totalSlices}: \`${currentSlice.id}\`\n\n`;
      prompt += `You are building ONLY this slice in this pass. Preserve every other file in existingFiles\n`;
      prompt += `byte-for-byte. Emit incremental output: only files this slice creates or modifies.\n\n`;
      prompt += `\`\`\`json\n${JSON.stringify(currentSlice, null, 2)}\n\`\`\`\n\n`;
      prompt += `Implement this slice end-to-end:\n`;
      prompt += `  • Frontend route(s): ${(currentSlice.routes ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Backend API endpoints (apiIds): ${(currentSlice.apiIds ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Prisma model(s) / table(s): ${(currentSlice.dbTables ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Components: ${(currentSlice.components ?? []).join(', ') || '(none)'}\n`;
      prompt += `  • Acceptance criteria — every one MUST hold once this pass completes:\n`;
      for (const a of currentSlice.acceptance ?? []) prompt += `      - ${a}\n`;
      prompt += `\n`;
      prompt += `If this slice depends on tables/components owned by an earlier slice, USE them as-is\n`;
      prompt += `from existingFiles — do not redefine. If you discover the earlier slice's files are\n`;
      prompt += `missing or wrong, the QA agent will flag it; do not silently rewrite them here.\n\n`;
    }

    prompt += `## Product Specification\n\n\`\`\`json\n${JSON.stringify(spec, null, 2)}\n\`\`\`\n\n`;

    if (qaFeedback && Object.keys(qaFeedback).length > 0) {
      prompt += `## QA FEEDBACK — fix EVERY issue listed below\n\n\`\`\`json\n${JSON.stringify(qaFeedback, null, 2)}\n\`\`\`\n\n`;
    }

    if (Array.isArray(existingFiles) && existingFiles.length > 0) {
      prompt += `## Existing Codebase (${existingFiles.length} files) — patch in place where possible\n\n`;
      for (const f of existingFiles) {
        prompt += `### ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\`\n\n`;
      }
    }

    prompt += this.formatMemoriesForPrompt(memories);

    if (currentSlice) {
      prompt += `Build slice "${currentSlice.id}" only. Emit only files this slice creates or modifies, plus an updated IMPLEMENTATION_CHECKLIST.md.`;
    } else {
      prompt += iter === 1
        ? `Generate the COMPLETE codebase per the spec. Emit IMPLEMENTATION_CHECKLIST.md last.`
        : `Address the QA feedback. Emit only changed/new files plus an updated IMPLEMENTATION_CHECKLIST.md.`;
    }

    return prompt;
  }

  protected async parseOutput(raw: string, _task: Task): Promise<Record<string, unknown>> {
    return extractJSON(raw);
  }

  protected async validateOutput(output: Record<string, unknown>, _task: Task): Promise<void> {
    if (!Array.isArray(output.files) || output.files.length === 0) {
      throw new Error('Validation: builder produced no files');
    }
    for (const f of output.files as Array<Record<string, unknown>>) {
      if (typeof f.path !== 'string' || typeof f.content !== 'string') {
        throw new Error('Validation: every file requires { path, content }');
      }
    }
  }

  protected async extractLearnings(task: Task, output: Record<string, unknown>): Promise<MemoryEntry[]> {
    const files = (output.files as Array<{ path: string }>) ?? [];
    const iter = (task.input as unknown as BuilderInput).iteration ?? 1;
    if (iter > 1) {
      // Track what feedback the builder addressed.
      return [{
        agentRole: 'builder',
        type: 'pattern',
        content: `Re-build iteration ${iter}: produced ${files.length} files in response to QA feedback.`,
        relevanceScore: 0.7,
        tags: ['builder', 'qa-loop'],
        metadata: { iteration: iter, fileCount: files.length },
      } as unknown as MemoryEntry];
    }
    return [{
      agentRole: 'builder',
      type: 'pattern',
      content: `Initial build: ${files.length} files generated.`,
      relevanceScore: 0.6,
      tags: ['builder'],
      metadata: { fileCount: files.length },
    } as unknown as MemoryEntry];
  }
}
