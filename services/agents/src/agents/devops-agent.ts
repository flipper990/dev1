import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DevOpsInput {
  files: ProjectFile[];
  projectName: string;
  preferences?: {
    targetCloud?: 'vercel' | 'aws' | 'gcp' | 'azure' | 'none';
    includeCI?: boolean;
  };
}

export interface DevOpsOutput {
  deploymentFiles: ProjectFile[];
  summary: string;
  deployInstructions: string[];
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are an expert DevOps engineer.
Your job is to create complete, production-ready deployment configuration.

Requirements:
- Dockerfile with multi-stage build (build → production)
- docker-compose.yml for local development
- .env.example with all required variables
- scripts/deploy.sh (bash, set -euo pipefail)
- scripts/deploy.ps1 (PowerShell, $ErrorActionPreference = 'Stop')
- .github/workflows/deploy.yml (CI/CD pipeline)
- If targetCloud is vercel: include vercel.json
- If targetCloud is aws: include basic CloudFormation template
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

const EXPECTED_FILES = [
  'Dockerfile',
  'docker-compose.yml',
  '.env.example',
  'scripts/deploy.sh',
  'scripts/deploy.ps1',
  '.github/workflows/deploy.yml',
];

export class DevOpsAgent extends BaseAgent<DevOpsInput, DevOpsOutput> {
  constructor() {
    super('devops', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: DevOpsInput, _memories: MemoryEntry[]): string {
    const cloudSection = input.preferences?.targetCloud
      ? `\nTarget cloud: ${input.preferences.targetCloud}`
      : '';

    const fileList = input.files
      .map((f) => f.path)
      .join('\n');

    return `Create deployment configuration for "${input.projectName}". Respond with JSON only:

Project file tree:
${fileList}${cloudSection}
Include CI/CD: ${input.preferences?.includeCI !== false ? 'yes' : 'no'}

Required JSON schema:
{
  "deploymentFiles": [
    {
      "path": "string",
      "content": "full file content",
      "language": "string | undefined"
    }
  ],
  "summary": "string",
  "deployInstructions": ["string — ordered steps"]
}`;
  }

  protected parseOutput(raw: string): DevOpsOutput {
    const parsed = this.extractJson<DevOpsOutput>(raw);

    if (!Array.isArray(parsed.deploymentFiles) || parsed.deploymentFiles.length === 0) {
      throw new ValidationError('DevOps output must include deploymentFiles');
    }

    const paths = new Set(parsed.deploymentFiles.map((f) => f.path));
    const missing = EXPECTED_FILES.filter((f) => !paths.has(f));
    if (missing.length > 0) {
      // Log missing but don't fail — orchestrator will fill fallbacks
      console.warn(`[devops-agent] Missing expected files: ${missing.join(', ')}`);
    }

    parsed.summary ??= '';
    parsed.deployInstructions ??= [];

    return parsed;
  }
}
