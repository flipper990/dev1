import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OptimizerInput {
  files: ProjectFile[];
  performanceConcerns: string[];   // from reviewer
}

export interface OptimizationChange {
  file: string;
  type: 'performance' | 'readability' | 'bundle-size' | 'accessibility' | 'seo';
  description: string;
}

export interface OptimizerOutput {
  files: ProjectFile[];               // only files that were actually changed
  changes: OptimizationChange[];
  summary: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a performance and code quality engineer.
Your job is to optimize code for speed, bundle size, readability, and best practices.

Rules:
- Memoize expensive computations; avoid unnecessary re-renders in React
- Remove unused imports, dead code, and redundant logic
- Add meaningful accessibility attributes (aria-*, alt, role) to UI components
- Improve SEO meta tags and semantic HTML where applicable
- Keep all existing functionality intact — only optimize, never remove features
- Return complete file contents — not diffs or snippets
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class OptimizerAgent extends BaseAgent<OptimizerInput, OptimizerOutput> {
  protected override readonly maxOutputTokens = 16_384;

  constructor() {
    super('optimizer', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: OptimizerInput, _memories: MemoryEntry[]): string {
    const concerns = input.performanceConcerns.length > 0
      ? input.performanceConcerns.map((c) => `- ${c}`).join('\n')
      : '(No specific performance concerns — do a general optimisation pass)';

    const fileList = input.files
      .map((f) => `### ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\``)
      .join('\n\n');

    return `Optimise this code for performance and quality. Respond with JSON only.

Known performance concerns:
${concerns}

Files:
${fileList}

Required JSON schema:
{
  "files": [
    {
      "path": "string — same relative path as input",
      "content": "string — complete optimised file content",
      "language": "string"
    }
  ],
  "changes": [
    {
      "file": "string",
      "type": "performance | readability | bundle-size | accessibility | seo",
      "description": "string — what was optimised and why"
    }
  ],
  "summary": "string"
}

Important: Return ONLY files you actually changed or optimized. Unchanged files will be preserved automatically.`;
  }

  protected parseOutput(raw: string): OptimizerOutput {
    const parsed = this.extractJson<OptimizerOutput>(raw);

    if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
      throw new ValidationError('Optimizer output must include files array');
    }

    for (const file of parsed.files) {
      if (!file.path || typeof file.content !== 'string') {
        throw new ValidationError('Each file must have path and content', { file });
      }
    }

    parsed.changes  ??= [];
    parsed.summary  ??= '';

    return parsed;
  }
}
