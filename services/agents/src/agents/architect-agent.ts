import type { MemoryEntry } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';
import type { PlannerOutput } from './planner-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ArchitectInput {
  plan: PlannerOutput;
}

export interface ComponentSpec {
  name: string;
  type: 'ui' | 'service' | 'model' | 'util' | 'config';
  description: string;
  dependencies: string[];
}

export interface ApiEndpoint {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  description: string;
  requestBody?: string;
  responseBody?: string;
}

export interface ArchitectOutput {
  overview: string;
  folderStructure: string[];           // list of paths e.g. "src/components/Button.tsx"
  components: ComponentSpec[];
  apiEndpoints: ApiEndpoint[];
  dataModels: Array<{ name: string; fields: Record<string, string> }>;
  stateManagement: string;
  stylingApproach: string;
  keyDecisions: string[];
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior software architect.
Your job is to translate a project plan into a concrete technical architecture.

Rules:
- Define every file/folder that will be created
- Be specific about components, their purpose and how they connect
- Design clean, RESTful API endpoints where applicable
- Choose appropriate patterns (MVC, feature-folders, etc.) for the tech stack
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class ArchitectAgent extends BaseAgent<ArchitectInput, ArchitectOutput> {
  constructor() {
    super('architect', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: ArchitectInput, _memories: MemoryEntry[]): string {
    return `Design the technical architecture for this project and respond with JSON only:

Plan:
${JSON.stringify(input.plan, null, 2)}

Required JSON schema:
{
  "overview": "string — architecture summary",
  "folderStructure": ["string — each path relative to project root"],
  "components": [
    {
      "name": "string",
      "type": "ui | service | model | util | config",
      "description": "string",
      "dependencies": ["string — component names this depends on"]
    }
  ],
  "apiEndpoints": [
    {
      "method": "GET | POST | PUT | PATCH | DELETE",
      "path": "string",
      "description": "string",
      "requestBody": "string | undefined",
      "responseBody": "string | undefined"
    }
  ],
  "dataModels": [
    {
      "name": "string",
      "fields": { "fieldName": "type" }
    }
  ],
  "stateManagement": "string — describe state strategy",
  "stylingApproach": "string — CSS/styling strategy",
  "keyDecisions": ["string — architectural decisions and rationale"]
}`;
  }

  protected parseOutput(raw: string): ArchitectOutput {
    const parsed = this.extractJson<ArchitectOutput>(raw);

    if (!parsed.overview || !Array.isArray(parsed.folderStructure)) {
      throw new ValidationError('Architect output missing required fields', {
        received: Object.keys(parsed),
      });
    }

    parsed.components     ??= [];
    parsed.apiEndpoints   ??= [];
    parsed.dataModels     ??= [];
    parsed.stateManagement ??= '';
    parsed.stylingApproach ??= '';
    parsed.keyDecisions   ??= [];

    return parsed;
  }
}
