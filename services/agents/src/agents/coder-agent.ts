import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';
import type { PlannerOutput } from './planner-agent.js';
import type { DesignSystem } from './ui-ux-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CoderInput {
  plan: PlannerOutput;
  architecture?: string;
  designSystem?: DesignSystem;
  layoutPatterns?: string[];
  componentsNeeded?: string[];
  existingStyleFiles?: ProjectFile[];

  // ── Update / iteration mode ─────────────────────────────────────────────
  /** All files that currently exist in the project. Triggers patch mode. */
  existingFiles?: ProjectFile[];
  /** The user's raw update prompt, relayed verbatim to the model. */
  updateInstructions?: string;
}

export interface CoderOutput {
  files: ProjectFile[];
  summary: string;
  dependencies: Record<string, string>;
  /** Paths the model asked to delete entirely. Only honoured in update mode. */
  filesToDelete?: string[];
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
  protected override readonly maxOutputTokens = 32_768;

  constructor() {
    super('coder', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: CoderInput, memories: MemoryEntry[]): string {
    const archSection = input.architecture
      ? `\n\nDetailed architecture:\n${input.architecture}`
      : '';

    const designSection = input.designSystem
      ? `\n\n=== DESIGN SYSTEM (MANDATORY — every UI file must follow this) ===\n` +
        `Aesthetic: ${input.designSystem.aesthetic}\n` +
        `Component library: ${input.designSystem.componentLibrary} (prefer its primitives over raw divs)\n` +
        `Palette: ${JSON.stringify(input.designSystem.palette)}\n` +
        `Typography: ${JSON.stringify(input.designSystem.typography)}\n` +
        `Radii: ${JSON.stringify(input.designSystem.radii)}\n` +
        `Spacing: ${input.designSystem.spacing}\n` +
        `Motion: ${input.designSystem.motion}\n` +
        `Density: ${input.designSystem.density}\n` +
        `Dark mode: ${input.designSystem.darkMode}\n` +
        (input.layoutPatterns?.length ? `Layout patterns to use: ${input.layoutPatterns.join(', ')}\n` : '') +
        (input.componentsNeeded?.length ? `Reusable components to build: ${input.componentsNeeded.join(', ')}\n` : '') +
        `\nSTRICT UI RULES:\n` +
        `- Use Tailwind utility classes that map to the palette tokens (bg-bg, text-text, border-border, accent-accent, etc.)\n` +
        `- Never invent one-off hex colors inside components — always reference tokens\n` +
        `- Every interactive element needs hover + focus-visible states\n` +
        `- Every async section needs loading and empty states\n` +
        `- Use semantic HTML + aria labels where appropriate\n` +
        `- Prefer rounded-md / rounded-lg, shadow-sm, subtle borders over heavy shadows\n` +
        `- Generous whitespace (py-12 / py-16 for sections, gap-6 for grids)\n`
      : '';

    const existingStyleFilesSection = input.existingStyleFiles?.length
      ? `\n\nPre-generated style files (already exist — DO NOT regenerate these, but your code MUST honor them):\n${input.existingStyleFiles.map(f => `- ${f.path}`).join('\n')}`
      : '';

    // ── Update / iteration mode ─────────────────────────────────────────
    // When existingFiles is present, switch to *patch mode*: the coder is
    // told to emit ONLY new or modified files, plus an optional deletion list.
    const isUpdate = !!input.existingFiles?.length;
    const existingFilesSection = isUpdate
      ? `\n\n=== EXISTING CODEBASE (${input.existingFiles!.length} files — PRESERVE UNTOUCHED FILES) ===\n` +
        `Paths currently in the project:\n${input.existingFiles!.map(f => `- ${f.path} (${f.content.length} chars)`).join('\n')}\n`
      : '';
    const updateInstructionsSection = input.updateInstructions
      ? `\n\n=== UPDATE REQUEST ===\n${input.updateInstructions}\n`
      : '';
    const patchRules = isUpdate
      ? `\n\n=== PATCH MODE RULES ===\n` +
        `- Emit ONLY the files you need to ADD or MODIFY for this update.\n` +
        `- Every existing path you DO NOT include will be preserved verbatim.\n` +
        `- To modify a file, output its full new content at the same path.\n` +
        `- To add a file, output it at a new path.\n` +
        `- To delete a file, list its path in the top-level "filesToDelete" array.\n` +
        `- Do NOT re-emit unchanged files. That wastes tokens and risks drift.\n` +
        `- Keep the overall architecture, naming conventions and design system consistent with existing files.\n`
      : '';

    const pastCode =
      memories.length
        ? `\n\nCode patterns from previous sessions:\n${memories.map((m) => m.content.slice(0, 300)).join('\n---\n')}`
        : '';

    const verb = isUpdate ? 'Patch the existing project' : 'Write all source files for this project';

    return `${verb} and respond with JSON only:

Plan:
${JSON.stringify(input.plan, null, 2)}${archSection}${designSection}${existingStyleFilesSection}${existingFilesSection}${updateInstructionsSection}${patchRules}${pastCode}

Required JSON schema:
{
  "files": [
    {
      "path": "relative/path/file.ext",
      "content": "full file content as string",
      "language": "typescript | javascript | python | etc."
    }
  ],
  "filesToDelete": ["relative/path/old.ext"],
  "summary": "string — what was implemented or changed",
  "dependencies": { "packageName": "version" }
}

Important: path must be relative (no leading /). ${isUpdate ? 'Emit only ADDED or MODIFIED files.' : 'Include all files needed to run the project.'}`;
  }

  protected parseOutput(raw: string): CoderOutput {
    const parsed = this.extractJson<CoderOutput>(raw);

    if (!Array.isArray(parsed.files) || parsed.files.length === 0) {
      throw new ValidationError('Coder output must include at least one file');
    }

    const seenPaths = new Set<string>();
    const validFiles: ProjectFile[] = [];
    for (const file of parsed.files) {
      if (!file || typeof file !== 'object') continue;
      if (!file.path || typeof file.path !== 'string') continue;
      if (typeof file.content !== 'string') continue;
      // Strip leading slash / backslash; reject path traversal.
      const cleaned = file.path.replace(/^[\\/]+/, '').replace(/\\/g, '/');
      if (cleaned.includes('..') || cleaned.length === 0) continue;
      if (seenPaths.has(cleaned)) continue;
      seenPaths.add(cleaned);
      // Skip placeholder files that slipped through.
      if (/^\s*(?:\/\/\s*TODO|#\s*TODO|\/\*\s*TODO)/i.test(file.content) && file.content.trim().length < 40) continue;
      validFiles.push({ ...file, path: cleaned });
    }

    if (validFiles.length === 0) {
      // In patch mode, a pure deletion or no-op update is allowed.
      const isUpdate = Array.isArray(parsed.filesToDelete) && parsed.filesToDelete.length > 0;
      if (!isUpdate) {
        throw new ValidationError('Coder output had no valid files after sanitisation');
      }
    }

    parsed.files = validFiles;
    parsed.dependencies ??= {};
    parsed.summary ??= '';

    // Sanitise filesToDelete the same way — relative paths only, no traversal.
    if (Array.isArray(parsed.filesToDelete)) {
      const seen = new Set<string>();
      const cleanDeletes: string[] = [];
      for (const raw of parsed.filesToDelete) {
        if (typeof raw !== 'string') continue;
        const cleaned = raw.replace(/^[\\/]+/, '').replace(/\\/g, '/');
        if (!cleaned || cleaned.includes('..') || seen.has(cleaned)) continue;
        seen.add(cleaned);
        cleanDeletes.push(cleaned);
      }
      parsed.filesToDelete = cleanDeletes;
    } else {
      parsed.filesToDelete = [];
    }

    return parsed;
  }
}
