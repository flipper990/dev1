import type { MemoryEntry, ProjectPreferences } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntentAnalyzerInput {
  prompt: string;
  preferences?: ProjectPreferences;
}

export type ProjectType =
  | 'web-app'
  | 'saas'
  | 'landing-page'
  | 'dashboard'
  | 'social-platform'
  | 'ecommerce'
  | 'blog-cms'
  | 'api-only'
  | 'ai-app'
  | 'other';

export type Complexity = 'simple' | 'medium' | 'complex';

export interface IntentAnalyzerOutput {
  refinedPrompt: string;
  projectType: ProjectType;
  complexity: Complexity;
  features: string[];
  capabilities: {
    hasFrontend: boolean;
    hasBackend: boolean;
    hasDatabase: boolean;
    hasAuth: boolean;
    hasRealtime: boolean;
    hasPayments: boolean;
    hasFileUpload: boolean;
    hasAI: boolean;
  };
  brandVibe: string;
  targetAudience: string;
  stackHints: {
    frontend?: string;
    backend?: string;
    database?: string;
  };
  clarifyingQuestions: string[];
  summary: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert product analyst.
Your job is to take a user's raw project request and extract structured intent.

Rules:
- Infer missing details from context (e.g. "Facebook clone" → hasAuth, hasRealtime, hasDatabase)
- Be precise about complexity: simple = single page / landing, medium = CRUD app, complex = multi-feature fullstack with auth + realtime + DB
- brandVibe should be a concrete aesthetic hint (e.g. "modern SaaS, dark, professional", "playful, colorful, friendly", "minimal, editorial, serif")
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class IntentAnalyzerAgent extends BaseAgent<IntentAnalyzerInput, IntentAnalyzerOutput> {
  protected override readonly maxOutputTokens = 2048;

  constructor() {
    super('intent_analyzer', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: IntentAnalyzerInput, _memories: MemoryEntry[]): string {
    const prefs = input.preferences
      ? `\n\nUser preferences: ${JSON.stringify(input.preferences)}`
      : '';

    return `Analyze this project request and respond with JSON only:

User request: ${input.prompt}${prefs}

Required JSON schema:
{
  "refinedPrompt": "string — cleaned, expanded version of the request",
  "projectType": "web-app | saas | landing-page | dashboard | social-platform | ecommerce | blog-cms | api-only | ai-app | other",
  "complexity": "simple | medium | complex",
  "features": ["string — each concrete feature"],
  "capabilities": {
    "hasFrontend": boolean,
    "hasBackend": boolean,
    "hasDatabase": boolean,
    "hasAuth": boolean,
    "hasRealtime": boolean,
    "hasPayments": boolean,
    "hasFileUpload": boolean,
    "hasAI": boolean
  },
  "brandVibe": "string — concrete aesthetic direction",
  "targetAudience": "string",
  "stackHints": {
    "frontend": "string | undefined — if user hinted/implied specific tech",
    "backend": "string | undefined",
    "database": "string | undefined"
  },
  "clarifyingQuestions": ["string — questions we'd ideally ask the user"],
  "summary": "string — one-sentence summary of the intent"
}`;
  }

  protected parseOutput(raw: string): IntentAnalyzerOutput {
    const parsed = this.extractJson<IntentAnalyzerOutput>(raw);

    if (!parsed.refinedPrompt || !parsed.projectType || !parsed.complexity) {
      throw new ValidationError('Intent analyzer output missing required fields', {
        received: Object.keys(parsed),
      });
    }

    parsed.features ??= [];
    parsed.capabilities ??= {
      hasFrontend: true,
      hasBackend: false,
      hasDatabase: false,
      hasAuth: false,
      hasRealtime: false,
      hasPayments: false,
      hasFileUpload: false,
      hasAI: false,
    };
    parsed.brandVibe ??= 'modern, clean, professional';
    parsed.targetAudience ??= 'general users';
    parsed.stackHints ??= {};
    parsed.clarifyingQuestions ??= [];
    parsed.summary ??= '';

    return parsed;
  }
}
