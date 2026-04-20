import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReviewerInput {
  files: ProjectFile[];
  plan: { summary: string; goals: string[] };
}

export interface ReviewIssue {
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  file: string;
  line?: number;
  description: string;
  fix?: string;
}

export interface ReviewerOutput {
  approved: boolean;
  summary: string;
  issues: ReviewIssue[];
  securityConcerns: string[];
  performanceConcerns: string[];
  score: number; // 0–100
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert code reviewer and security engineer.
Your job is to review code for correctness, security, performance, and maintainability.

Rules:
- Check for OWASP Top 10 security issues
- Flag logic errors and potential runtime failures
- Identify performance bottlenecks
- Score code quality 0–100
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class ReviewerAgent extends BaseAgent<ReviewerInput, ReviewerOutput> {
  constructor() {
    super('reviewer', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: ReviewerInput, _memories: MemoryEntry[]): string {
    const fileList = input.files
      .map((f) => `### ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content}\n\`\`\``)
      .join('\n\n');

    return `Review this code and respond with JSON only:

Project goals: ${input.plan.goals.join(', ')}
Summary: ${input.plan.summary}

Files:
${fileList}

Required JSON schema:
{
  "approved": boolean,
  "summary": "string",
  "issues": [
    {
      "severity": "critical | major | minor | suggestion",
      "file": "string",
      "line": number | undefined,
      "description": "string",
      "fix": "string | undefined"
    }
  ],
  "securityConcerns": ["string"],
  "performanceConcerns": ["string"],
  "score": number
}`;
  }

  protected parseOutput(raw: string): ReviewerOutput {
    const parsed = this.extractJson<ReviewerOutput>(raw);

    if (typeof parsed.approved !== 'boolean' || typeof parsed.score !== 'number') {
      throw new ValidationError('Reviewer output missing required fields');
    }

    parsed.issues ??= [];
    parsed.securityConcerns ??= [];
    parsed.performanceConcerns ??= [];
    parsed.score = Math.max(0, Math.min(100, parsed.score));

    return parsed;
  }
}
