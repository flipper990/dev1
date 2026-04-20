import type { MemoryEntry, ProjectPreferences } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PlannerInput {
  prompt: string;
  preferences?: ProjectPreferences;
  memoryHints?: string[];
}

export interface PlannerOutput {
  projectName: string;
  summary: string;
  goals: string[];
  techStack: {
    language: string;
    framework?: string;
    testFramework?: string;
    additionalLibraries: string[];
  };
  architecture: string;
  milestones: Array<{ title: string; description: string }>;
  risks: string[];
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert software architect and technical planner.
Your job is to analyze a user's project request and produce a detailed, structured plan.

Rules:
- Be concrete and specific — no vague descriptions
- Choose modern, production-ready technologies
- Output ONLY valid JSON matching the required schema
- Never include markdown outside of JSON string values`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class PlannerAgent extends BaseAgent<PlannerInput, PlannerOutput> {
  constructor() {
    super('planner', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: PlannerInput, memories: MemoryEntry[]): string {
    const memHints =
      input.memoryHints?.length
        ? `\n\nRelevant context from previous projects:\n${input.memoryHints.join('\n')}`
        : memories.length
          ? `\n\nPast learnings:\n${memories.map((m) => m.content).join('\n')}`
          : '';

    const prefs = input.preferences
      ? `\n\nUser preferences:\n${JSON.stringify(input.preferences, null, 2)}`
      : '';

    return `Plan this project and respond with JSON only:

User request: ${input.prompt}${prefs}${memHints}

Required JSON schema:
{
  "projectName": "string",
  "summary": "string — one paragraph",
  "goals": ["string"],
  "techStack": {
    "language": "string",
    "framework": "string | undefined",
    "testFramework": "string | undefined",
    "additionalLibraries": ["string"]
  },
  "architecture": "string — describe key components",
  "milestones": [{ "title": "string", "description": "string" }],
  "risks": ["string"]
}`;
  }

  protected parseOutput(raw: string): PlannerOutput {
    const parsed = this.extractJson<PlannerOutput>(raw);

    if (!parsed.projectName || !parsed.summary || !Array.isArray(parsed.goals)) {
      throw new ValidationError('Planner output missing required fields', {
        received: Object.keys(parsed),
      });
    }

    parsed.goals = parsed.goals.filter(Boolean);
    parsed.milestones ??= [];
    parsed.risks ??= [];
    parsed.techStack.additionalLibraries ??= [];

    return parsed;
  }
}
