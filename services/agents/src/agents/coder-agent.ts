import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';
import type { PlannerOutput } from './planner-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoderInput {
  plan: PlannerOutput;
  architecture?: string;
}

export interface CoderOutput {
  files: ProjectFile[];
  summary: string;
  dependencies: Record<string, string>;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert software engineer.
Your job is to write production-ready code based on a project plan.

Rules:
- Write complete, working code — no placeholders or TODOs unless unavoidable
- Follow the selected language/framework best practices
- Include proper error handling, types, and clear variable names
- Provide every file needed to run the project
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class CoderAgent extends BaseAgent<CoderInput, CoderOutput> {
  constructor() {
    super('coder', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: CoderInput, memories: MemoryEntry[]): string {
    const archSection = input.architecture
      ? `\n\nDetailed architecture:\n${input.architecture}`
      : '';

    const pastCode =
      memories.length
        ? `\n\nCode patterns from previous sessions:\n${memories.map((m) => m.content.slice(0, 300)).join('\n---\n')}`
        : '';

    return `Write all source files for this project and respond with JSON only:

Plan:
${JSON.stringify(input.plan, null, 2)}${archSection}${pastCode}

Required JSON schema:
{
  "files": [
    {
      "path": "relative/path/file.ext",
      "content": "full file content as string",
      "language": "typescript | javascript | python | etc."
    }
  ],
  "summary": "string — what was implemented",
  "dependencies": { "packageName": "version" }
}

Important: path must be relative (no leading /). Include all files needed to run the project.`;
  }

  protected parseOutput(raw: string): CoderOutput {
    const parsed = this.extractJson<CoderOutput>(raw);

    if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
      throw new ValidationError('Coder output must include at least one file');
    }

    for (const file of parsed.files) {
      if (!file.path || typeof file.content !== 'string') {
        throw new ValidationError('Each file must have path and content', { file });
      }
    }

    parsed.dependencies ??= {};
    parsed.summary ??= '';

    return parsed;
  }
}
