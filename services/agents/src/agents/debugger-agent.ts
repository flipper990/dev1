import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';
import type { ReviewerOutput, ReviewIssue } from './reviewer-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DebuggerInput {
  files: ProjectFile[];
  reviewIssues: ReviewIssue[];
  securityConcerns: string[];
}

export interface DebugFix {
  file: string;
  description: string;
  before?: string;
  after: string;
}

export interface DebuggerOutput {
  files: ProjectFile[];           // only files that were actually fixed/changed
  fixesApplied: DebugFix[];
  remainingIssues: string[];
  summary: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert software debugger and security engineer.
Your job is to fix bugs, security vulnerabilities, and critical code issues.

Rules:
- Fix ALL critical and major issues identified in the review
- Address ALL security concerns (OWASP Top 10)
- Return complete file contents — not diffs or snippets
- Return ONLY files you actually modified; unchanged files will be preserved automatically
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class DebuggerAgent extends BaseAgent<DebuggerInput, DebuggerOutput> {
  protected override readonly maxOutputTokens = 16_384;

  constructor() {
    super('debugger', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: DebuggerInput, _memories: MemoryEntry[]): string {
    const criticalAndMajor = input.reviewIssues.filter(
      (i) => i.severity === 'critical' || i.severity === 'major',
    );

    const issueList = criticalAndMajor.length > 0
      ? criticalAndMajor.map((i) => `- [${i.severity.toUpperCase()}] ${i.file}: ${i.description}${i.fix ? ` → Suggested fix: ${i.fix}` : ''}`).join('\n')
      : '(No critical or major issues — do a final pass for any logic bugs)';

    const securityList = input.securityConcerns.length > 0
      ? input.securityConcerns.map((s) => `- ${s}`).join('\n')
      : '(No security concerns)';

    const fileList = input.files
      .map((f) => `### ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\``)
      .join('\n\n');

    return `Fix all critical/major issues and security concerns in this code. Respond with JSON only.

Issues to fix:
${issueList}

Security concerns:
${securityList}

Files:
${fileList}

Required JSON schema:
{
  "files": [
    {
      "path": "string — same relative path as input",
      "content": "string — complete fixed file content",
      "language": "string"
    }
  ],
  "fixesApplied": [
    {
      "file": "string",
      "description": "string — what was fixed",
      "after": "string — brief code snippet showing the fix"
    }
  ],
  "remainingIssues": ["string — issues that could not be fixed automatically"],
  "summary": "string"
}

Important: Return ONLY the files you actually fixed or modified. Unchanged files will be preserved automatically.`;
  }

  protected parseOutput(raw: string): DebuggerOutput {
    const parsed = this.extractJson<DebuggerOutput>(raw);

    if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
      throw new ValidationError('Debugger output must include files array');
    }

    for (const file of parsed.files) {
      if (!file.path || typeof file.content !== 'string') {
        throw new ValidationError('Each file must have path and content', { file });
      }
    }

    parsed.fixesApplied      ??= [];
    parsed.remainingIssues   ??= [];
    parsed.summary           ??= '';

    return parsed;
  }
}
