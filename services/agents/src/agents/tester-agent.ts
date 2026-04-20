import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';
import type { PlannerOutput } from './planner-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TesterInput {
  files: ProjectFile[];
  plan: PlannerOutput;
}

export interface TestFile {
  path: string;
  content: string;
  framework: string;
}

export interface TesterOutput {
  testFiles: TestFile[];
  coverage: string[];
  missingCoverage: string[];
  summary: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert test engineer.
Your job is to write comprehensive unit and integration tests.

Rules:
- Use the test framework specified in the plan (default: Jest)
- Cover all public functions, edge cases, and error paths
- Write readable, maintainable tests with clear descriptions
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class TesterAgent extends BaseAgent<TesterInput, TesterOutput> {
  constructor() {
    super('tester', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: TesterInput, _memories: MemoryEntry[]): string {
    const framework = input.plan.techStack.testFramework ?? 'Jest';
    const fileList = input.files
      .slice(0, 10) // cap to avoid huge prompts
      .map((f) => `### ${f.path}\n\`\`\`${f.language ?? ''}\n${f.content.slice(0, 2000)}\n\`\`\``)
      .join('\n\n');

    return `Write tests using ${framework} for the following code. Respond with JSON only:

${fileList}

Required JSON schema:
{
  "testFiles": [
    {
      "path": "string — relative path e.g. tests/unit/foo.test.ts",
      "content": "full test file content",
      "framework": "string"
    }
  ],
  "coverage": ["string — what is covered"],
  "missingCoverage": ["string — what could not be covered"],
  "summary": "string"
}`;
  }

  protected parseOutput(raw: string): TesterOutput {
    const parsed = this.extractJson<TesterOutput>(raw);

    if (!Array.isArray(parsed.testFiles)) {
      throw new ValidationError('Tester output must include testFiles array');
    }

    parsed.coverage ??= [];
    parsed.missingCoverage ??= [];
    parsed.summary ??= '';

    return parsed;
  }
}
