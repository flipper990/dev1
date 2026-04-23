import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';
import type { ArchitectOutput, ApiEndpoint } from './architect-agent.js';
import type { IntentAnalyzerOutput } from './intent-analyzer-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface IntegrationInput {
  files: ProjectFile[];
  apiEndpoints: ApiEndpoint[];
  architecture?: Pick<ArchitectOutput, 'overview' | 'dataModels'>;
  intent: IntentAnalyzerOutput;
}

export interface WiringCheck {
  frontendUsage: string;   // e.g. "app/page.tsx calls fetch('/api/posts')"
  backendEndpoint: string; // e.g. "POST /api/posts — posts.router.ts"
  status: 'ok' | 'mismatch' | 'fixed' | 'missing-backend' | 'missing-frontend';
  note?: string;
}

export interface IntegrationOutput {
  files: ProjectFile[];        // only changed / new files
  wirings: WiringCheck[];
  issues: string[];
  summary: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior fullstack integration engineer.
Your job is to ensure the frontend talks correctly to the backend.

What you MUST check and fix:
- Every frontend fetch/axios call must target a real backend route (path + method)
- Mismatched paths (e.g. /api/post vs /api/posts) must be corrected
- Shared types / API client helpers should exist (e.g. lib/api.ts) to avoid hardcoded URLs
- Environment variables (API_URL, NEXT_PUBLIC_API_URL, DATABASE_URL, JWT_SECRET) must be defined consistently
- CORS must be configured on the backend if frontend is on a different origin
- Auth tokens must be sent consistently (Authorization header, cookies) on both sides
- Seed / example data helpers for local dev where useful

What you MUST NOT do:
- Do not rewrite unrelated files
- Do not delete files
- Only return files you actually modified or added

Output ONLY valid JSON matching the required schema.`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class IntegrationAgent extends BaseAgent<IntegrationInput, IntegrationOutput> {
  protected override readonly maxOutputTokens = 16384;

  constructor() {
    super('integration', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: IntegrationInput, _memories: MemoryEntry[]): string {
    // Only send the files most likely to be relevant to integration
    // (frontend pages/components that fetch + backend routes/controllers + existing api client + env files).
    const relevantFiles = input.files.filter((f) => {
      const p = f.path.toLowerCase();
      return (
        /\b(route|router|controller|handler|endpoint|api|server|app)\b/.test(p) ||
        /\b(fetch|axios|client|service)\b/.test(f.content.slice(0, 200).toLowerCase()) ||
        p.endsWith('.env') ||
        p.endsWith('.env.example') ||
        p.includes('lib/api') ||
        p.includes('services/') ||
        /^(app|pages|src\/app|src\/pages)\/.+\.(tsx|jsx|ts|js)$/.test(p)
      );
    });

    // Cap to avoid token blow-up. Trim file content too.
    const capped = relevantFiles.slice(0, 40).map((f) => ({
      path: f.path,
      content: f.content.length > 3500 ? f.content.slice(0, 3500) + '\n/* ...truncated... */' : f.content,
    }));

    return `Check and fix frontend ↔ backend integration. Respond with JSON only.

Intent capabilities: ${JSON.stringify(input.intent.capabilities)}

Declared API endpoints (from architect):
${JSON.stringify(input.apiEndpoints, null, 2)}

Relevant files (${capped.length} of ${input.files.length}):
${JSON.stringify(capped, null, 2)}

Required JSON schema:
{
  "files": [
    {
      "path": "relative/path/file.ext",
      "content": "full updated file content",
      "language": "typescript | javascript | etc"
    }
  ],
  "wirings": [
    {
      "frontendUsage":   "string — where on the frontend a call is made",
      "backendEndpoint": "string — which backend endpoint it targets",
      "status":          "ok | mismatch | fixed | missing-backend | missing-frontend",
      "note":            "string | undefined"
    }
  ],
  "issues": ["string — any remaining integration problems that could not be fixed automatically"],
  "summary": "string — what was wired / fixed"
}

Rules:
- Only include files you actually changed or newly created
- Do NOT repeat unchanged files
- Paths must be relative, no leading slash, no ".." traversal`;
  }

  protected parseOutput(raw: string): IntegrationOutput {
    const parsed = this.extractJson<IntegrationOutput>(raw);

    if (!parsed || typeof parsed !== 'object') {
      throw new ValidationError('Integration output is not an object');
    }

    parsed.files   ??= [];
    parsed.wirings ??= [];
    parsed.issues  ??= [];
    parsed.summary ??= '';

    // Same sanitisation rules as the coder agent.
    const seen = new Set<string>();
    parsed.files = parsed.files.filter((f) => {
      if (!f || typeof f !== 'object') return false;
      if (!f.path || typeof f.path !== 'string') return false;
      if (typeof f.content !== 'string') return false;
      const cleaned = f.path.replace(/^[\\/]+/, '').replace(/\\/g, '/');
      if (cleaned.includes('..') || cleaned.length === 0) return false;
      if (seen.has(cleaned)) return false;
      seen.add(cleaned);
      f.path = cleaned;
      return true;
    });

    return parsed;
  }
}
