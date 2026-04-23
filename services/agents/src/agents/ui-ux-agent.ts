import type { MemoryEntry, ProjectFile } from '@devteam/core';
import { ValidationError } from '@devteam/core';
import { BaseAgent } from '../base-agent.js';
import type { PlannerOutput } from './planner-agent.js';
import type { IntentAnalyzerOutput } from './intent-analyzer-agent.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UIUXInput {
  plan: PlannerOutput;
  intent: IntentAnalyzerOutput;
}

export interface DesignSystem {
  aesthetic: string;
  palette: {
    bg: string;
    surface: string;
    border: string;
    text: string;
    muted: string;
    accent: string;
    success: string;
    warning: string;
    danger: string;
  };
  typography: {
    fontFamily: string;
    headingFamily?: string;
    scale: string;
  };
  radii: { sm: string; md: string; lg: string };
  spacing: string;
  motion: string;
  componentLibrary: 'shadcn/ui' | 'custom' | 'headlessui' | 'radix';
  density: 'compact' | 'comfortable' | 'spacious';
  darkMode: 'default' | 'light' | 'system';
}

export interface UIUXOutput {
  designSystem: DesignSystem;
  layoutPatterns: string[];
  componentsNeeded: string[];
  pages: Array<{ path: string; purpose: string; sections: string[] }>;
  styleFiles: ProjectFile[];
  summary: string;
}

// ─── Prompt ───────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior product designer and design-systems engineer.
Your job is to define the complete visual design system BEFORE any code is written.

Design principles (apply ALL):
- Modern SaaS aesthetic — think Linear, Vercel, Stripe, Cal.com, Raycast
- Generous whitespace, clear hierarchy, subtle shadows, soft borders
- Typography: use a single high-quality sans-serif (Inter, Geist, or system-ui fallback), tight letter-spacing on headings
- Color: restrained neutral palette + ONE strong accent color. Avoid rainbow UIs.
- Components: rounded-lg default, subtle hover/focus rings, 150ms ease-out transitions
- Always produce BOTH light and dark mode tokens via CSS variables
- Prefer shadcn/ui component library for React projects

Output:
- A concrete design system with real hex colors, real fonts, real spacing
- Ready-to-ship tailwind.config and globals.css files that implement the system
- Output ONLY valid JSON matching the required schema`;

// ─── Agent ────────────────────────────────────────────────────────────────────

export class UIUXAgent extends BaseAgent<UIUXInput, UIUXOutput> {
  protected override readonly maxOutputTokens = 8192;

  constructor() {
    super('ui_ux', SYSTEM_PROMPT);
  }

  protected buildPrompt(input: UIUXInput, _memories: MemoryEntry[]): string {
    return `Design the visual system for this project and respond with JSON only:

Intent:
- Project type: ${input.intent.projectType}
- Brand vibe: ${input.intent.brandVibe}
- Audience: ${input.intent.targetAudience}
- Features: ${input.intent.features.join(', ')}

Plan:
- Name: ${input.plan.projectName}
- Summary: ${input.plan.summary}
- Frontend: ${input.plan.techStack.framework ?? input.plan.techStack.language}

Required JSON schema:
{
  "designSystem": {
    "aesthetic": "string — one-line aesthetic description",
    "palette": {
      "bg":      "hex — page background",
      "surface": "hex — card/elevated surface",
      "border":  "hex — subtle borders",
      "text":    "hex — primary text",
      "muted":   "hex — secondary text",
      "accent":  "hex — single brand accent",
      "success": "hex",
      "warning": "hex",
      "danger":  "hex"
    },
    "typography": {
      "fontFamily":     "string — body font stack",
      "headingFamily":  "string | undefined",
      "scale":          "string — e.g. 1.25 (major third)"
    },
    "radii":   { "sm": "rem", "md": "rem", "lg": "rem" },
    "spacing": "string — baseline unit e.g. 4px / 0.25rem",
    "motion":  "string — e.g. 150ms cubic-bezier(0.4, 0, 0.2, 1)",
    "componentLibrary": "shadcn/ui | custom | headlessui | radix",
    "density":  "compact | comfortable | spacious",
    "darkMode": "default | light | system"
  },
  "layoutPatterns": ["string — e.g. sticky-header-with-blur, sidebar-nav-app-shell, hero-gradient-mesh, bento-grid, card-list"],
  "componentsNeeded": ["string — list of reusable components (Button, Card, Dialog, Input, Navbar, Skeleton, Toast, ...)"],
  "pages": [
    {
      "path": "string — e.g. / or /dashboard",
      "purpose": "string — what this page is for",
      "sections": ["string — in-page sections"]
    }
  ],
  "styleFiles": [
    {
      "path": "string — e.g. tailwind.config.ts or app/globals.css",
      "content": "string — full file content with REAL token values",
      "language": "string"
    }
  ],
  "summary": "string — one paragraph design rationale"
}

Important: styleFiles MUST contain tailwind.config with the palette mapped to theme.extend.colors AND a globals.css with CSS variables for both light and dark mode.`;
  }

  protected parseOutput(raw: string): UIUXOutput {
    const parsed = this.extractJson<UIUXOutput>(raw);

    if (!parsed.designSystem || !parsed.designSystem.palette) {
      throw new ValidationError('UI/UX output missing designSystem or palette', {
        received: Object.keys(parsed),
      });
    }

    parsed.layoutPatterns   ??= [];
    parsed.componentsNeeded ??= [];
    parsed.pages            ??= [];
    parsed.styleFiles       ??= [];
    parsed.summary          ??= '';

    // Sanitise styleFiles the same way CoderAgent does.
    parsed.styleFiles = parsed.styleFiles.filter((f) => {
      if (!f || typeof f !== 'object') return false;
      if (!f.path || typeof f.path !== 'string') return false;
      if (typeof f.content !== 'string') return false;
      const cleaned = f.path.replace(/^[\\/]+/, '').replace(/\\/g, '/');
      if (cleaned.includes('..') || cleaned.length === 0) return false;
      f.path = cleaned;
      return true;
    });

    return parsed;
  }
}
