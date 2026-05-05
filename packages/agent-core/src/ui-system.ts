// ─────────────────────────────────────────────────────────────
// UI Design System — single source of truth for what "good UI" means
// in every generated app.
//
// Three exports:
//   1. UI_SYSTEM_PROMPT — markdown block injected verbatim into builder
//      and polish prompts. Defines layout, tokens, typography, allowed
//      Tailwind classes, and forbidden patterns.
//   2. validateUiSystemCompliance(files) — static scanner that returns
//      structured violations. Used as a pre-QA gate so the LLM cannot
//      ship UI that breaks the contract.
//   3. uiSystemViolationsAsIssues(violations) — convert violations into
//      QA-issue shape so the existing rebuild loop picks them up.
//
// Design philosophy: this is a CONSTRAINT on the LLM, not a runtime
// framework. The audit and primitives still live in ui-foundation.ts /
// agent-input-builder.ts; THIS module gives the model the rules in
// prose and rejects the output when it cheats.
// ─────────────────────────────────────────────────────────────

import type { FileLike } from './agent-input-builder.js';

// ── Prompt block ─────────────────────────────────────────────────

export const UI_SYSTEM_PROMPT = `## 🎨 UI DESIGN SYSTEM — STRICT RULES (non-negotiable)

Every generated frontend MUST follow this system. Output that violates it
will be rejected and rebuilt. Treat each rule as a hard constraint.

### 1. Layout — every page uses the App Shell

\`\`\`
┌─────────────────────────────────────────────────┐
│  Topbar (h-14, sticky top-0)                    │
├──────────────┬──────────────────────────────────┤
│  Sidebar     │  Content (max-w-7xl mx-auto p-6) │
│  (w-64,      │                                  │
│   shrink-0)  │                                  │
└──────────────┴──────────────────────────────────┘
\`\`\`

Required files (create them if absent — do not rename):
  - \`components/layout/AppShell.tsx\` — wraps Sidebar + Topbar + main
  - \`components/layout/Sidebar.tsx\`  — fixed left nav, w-64, bg-card
  - \`components/layout/Topbar.tsx\`   — sticky h-14 header, bg-background, border-b border-border
  - Content area: \`<main className="flex-1 overflow-y-auto"><div className="mx-auto max-w-7xl p-6">{children}</div></main>\`

App Router: \`app/layout.tsx\` MUST render \`<AppShell>{children}</AppShell>\`.

### 2. Color tokens — semantic only

Use ONLY these Tailwind class roots for color. They map to CSS variables
defined in \`globals.css\` and themed in \`tailwind.config.ts\`:

  Surface:   \`bg-background\`, \`bg-card\`, \`bg-popover\`, \`bg-muted\`
  Text:      \`text-foreground\`, \`text-muted-foreground\`, \`text-card-foreground\`
  Brand:     \`bg-primary\`, \`text-primary\`, \`text-primary-foreground\`, \`bg-primary/90\`
  Accent:    \`bg-secondary\`, \`bg-accent\`, \`text-accent-foreground\`
  State:     \`bg-destructive\`, \`text-destructive\`, \`border-destructive\`
  Border:    \`border-border\`, \`border-input\`, \`ring-ring\`

❌ FORBIDDEN: \`bg-blue-500\`, \`text-indigo-600\`, \`bg-sky-400\`, \`bg-cyan-300\`,
   \`text-gray-700\`, any palette color (\`bg-{red|green|blue|…}-N\`).
❌ FORBIDDEN: hex colors (\`#3b82f6\`) anywhere except \`globals.css\` /
   \`tailwind.config.ts\` / \`lib/design-tokens.ts\`.
❌ FORBIDDEN: \`style={{ color: '...' }}\` and any inline color CSS.
✅ Status colors via \`<Badge variant="success|warning|destructive">\`.

### 3. Typography scale — 6 sizes only

  - \`text-xs\`   (12px) — labels, helper text
  - \`text-sm\`   (14px) — body, table cells, form input
  - \`text-base\` (16px) — emphasized body
  - \`text-lg\`   (18px) — card titles
  - \`text-xl\`   (20px) — section headings
  - \`text-2xl\`  (24px) — page titles
  - \`text-3xl\`  (30px) — hero / dashboard h1 only

Weights: \`font-normal\`, \`font-medium\`, \`font-semibold\`. Nothing heavier.
Line-height: rely on Tailwind defaults; \`leading-none\` only on titles.

❌ FORBIDDEN: \`text-4xl\`, \`text-5xl\`, \`text-6xl\`, \`font-bold\`,
   \`font-extrabold\`, \`font-black\`, \`text-[20px]\` arbitrary sizes.

### 4. Spacing scale — 4-px grid

Allowed Tailwind spacing values for \`p|m|gap|space-x|space-y\`:
  \`0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 14, 16, 20, 24, 32, 40, 48, 56, 64\`

❌ FORBIDDEN: \`p-7\`, \`m-9\`, \`gap-11\`, \`space-y-13\` (off-grid values).
❌ FORBIDDEN: arbitrary values \`p-[17px]\`, \`m-[23px]\`.

Common patterns:
  - Section gap: \`space-y-6\` or \`gap-6\`
  - Card padding: \`p-6\` (header), \`p-6 pt-0\` (content)
  - Form field gap: \`space-y-4\`
  - Inline gap: \`gap-2\` (icon + label) or \`gap-3\` (label + control)

### 5. Components — use the primitives, never raw HTML

EVERY user-facing element MUST use one of:

  Forms:      \`<Button>\`, \`<Input>\`, \`<Textarea>\`, \`<Select>\`, \`<Checkbox>\`, \`<Switch>\`, \`<RadioGroup>\`
  Surfaces:   \`<Card>\`, \`<Dialog>\`, \`<Sheet>\`, \`<Popover>\`, \`<Tooltip>\`
  Feedback:   \`<Badge>\`, \`<Toast>\` (via \`toast()\`), \`<Skeleton>\`, \`<Spinner>\`, \`<Alert>\`
  Nav:        \`<Tabs>\`, \`<Breadcrumbs>\`, \`<DropdownMenu>\`
  Data:       \`<Table>\`, \`<EmptyState>\`, \`<DataList>\`

Import path: \`@/components/ui/<Name>\`. If a primitive does not yet exist
in existingFiles, CREATE it under \`components/ui/\` using the patterns
already established in the codebase.

❌ FORBIDDEN outside \`components/ui/*\` and \`components/layout/*\`:
   - Raw \`<button>\`, \`<input>\`, \`<textarea>\`, \`<select>\`, \`<a class=\"btn…\">\`
   - Custom modal / dialog implementations (use \`<Dialog>\`)
   - Custom toast implementations (use the toast helper)
   - Hand-rolled spinners (use \`<Spinner>\` or \`<Skeleton>\`)

### 6. Borders, radius, shadow

  Radius:  \`rounded-md\` (default), \`rounded-lg\` (cards, dialogs),
           \`rounded-full\` (avatars, pills). Nothing else.
  Border:  \`border\` + \`border-border\` (or \`border-input\` on form fields).
  Shadow:  \`shadow-sm\` (cards), \`shadow-md\` (popovers), \`shadow-lg\`
           (dialogs). Nothing custom.

### 7. State + data fetching

  - Client data: \`@tanstack/react-query\` or \`swr\`. Never \`useEffect + fetch\`.
  - Forms: \`react-hook-form\` + \`zod\` resolver. Never uncontrolled state-only forms.
  - Loading: \`<Skeleton>\` or \`<Spinner>\`, never a bare "Loading…" string.
  - Empty: \`<EmptyState>\` with title + description + (optional) action.
  - Error: \`<Alert variant="destructive">\` inside the affected card / page.

### 8. Accessibility — non-negotiable

  - Every \`<input>\` (i.e. \`<Input>\`) has an associated \`<label>\` (the
    primitive does this when you pass \`label\`).
  - Every interactive element has a visible focus ring
    (\`focus-visible:ring-2 focus-visible:ring-primary\`). The primitives
    already do this — do not strip it.
  - Icons that are decoration: \`aria-hidden=\"true\"\`. Icons that carry
    meaning: have an accessible name (\`<button aria-label="Close">\`).
  - Color must NEVER be the only signal — pair badges with text.

### 9. Output discipline

When emitting files: use the primitives from \`components/ui/\`. If one is
missing, ADD it before the page that needs it. Do NOT inline fallback
HTML. Do NOT add custom CSS files (Tailwind only). Do NOT add a second
component library.

Violations will be detected statically and fed back as QA issues — the
build loop will reject the slice and rebuild until the rules hold.
`;

// ── Compliance scanner ───────────────────────────────────────────

export interface UiSystemViolation {
  file: string;
  rule:
    | 'forbidden-palette-color'
    | 'inline-hex-color'
    | 'inline-style'
    | 'forbidden-typography'
    | 'forbidden-font-weight'
    | 'arbitrary-tailwind-value'
    | 'off-grid-spacing'
    | 'raw-button'
    | 'raw-input'
    | 'raw-textarea'
    | 'raw-select'
    | 'forbidden-radius'
    | 'use-effect-fetch'
    | 'missing-app-shell'
    | 'missing-primitive'
    | 'missing-design-tokens'
    | 'missing-tailwind-config';
  /** Short human-readable description. */
  message: string;
  /** Up to 5 concrete examples. */
  samples?: string[];
  count?: number;
}

export interface UiSystemReport {
  violations: UiSystemViolation[];
  /** True when violations exceed thresholds — pipeline should reject. */
  failed: boolean;
  /** Total violation occurrences across all files. */
  totalCount: number;
  /** Number of frontend (.tsx/.jsx) files inspected. */
  inspected: number;
}

/** Tailwind palette names that are NEVER allowed (use semantic tokens). */
const FORBIDDEN_PALETTES = [
  'slate','gray','zinc','neutral','stone',
  'red','orange','amber','yellow','lime','green','emerald','teal','cyan','sky','blue','indigo','violet','purple','fuchsia','pink','rose',
];
const PALETTE_GROUP = FORBIDDEN_PALETTES.join('|');
const PALETTE_PROP_GROUP = '(?:bg|text|border|ring|from|to|via|divide|placeholder|caret|fill|stroke|outline|decoration|accent)';

const FORBIDDEN_TEXT_SIZES = ['text-4xl','text-5xl','text-6xl','text-7xl','text-8xl','text-9xl'];
const FORBIDDEN_FONT_WEIGHTS = ['font-bold','font-extrabold','font-black','font-thin','font-extralight'];
const ALLOWED_RADIUS = new Set(['rounded-md','rounded-lg','rounded-full','rounded-none','rounded']);
const ALLOWED_SPACING = new Set([0,1,2,3,4,5,6,8,10,12,14,16,20,24,32,40,48,56,64]);

const REQUIRED_PRIMITIVES = ['Button','Input','Card','Dialog','Badge'];

function isFrontendPath(p: string): boolean {
  return /\.(tsx|jsx)$/.test(p);
}

function isPrimitiveOrTokenFile(p: string): boolean {
  return /components\/(ui|primitives|layout)\//.test(p)
    || /lib\/design-tokens\.(ts|tsx|js)$/.test(p)
    || /globals\.css$/.test(p)
    || /tailwind\.config\.(ts|js|cjs|mjs)$/.test(p);
}

/**
 * Strict static check. Returns concrete violations the LLM must fix.
 * Skips the primitive library files themselves (they're allowed to use
 * raw <button>, palette colors in their cva variants, etc.).
 */
export function validateUiSystemCompliance(files: FileLike[]): UiSystemReport {
  const report: UiSystemReport = { violations: [], failed: false, totalCount: 0, inspected: 0 };

  // Detect overall structure.
  let hasShell = false;
  let hasTokens = false;
  let hasTailwindCfg = false;
  const havePrimitives = new Set<string>();

  for (const f of files) {
    if (/components\/layout\/(AppShell|Sidebar|Topbar)/.test(f.path)) hasShell = true;
    if (/lib\/design-tokens\.(ts|tsx|js)$/.test(f.path)) hasTokens = true;
    if (/tailwind\.config\.(ts|js|cjs|mjs)$/.test(f.path)) {
      hasTailwindCfg = true;
      // Treat presence of semantic color wiring as design-tokens-equivalent
      // even if a separate tokens file isn't emitted.
      if (/['"]hsl\(var\(--/.test(f.content)) hasTokens = true;
    }
    const primMatch = f.path.match(/components\/(?:ui|primitives)\/(Button|Input|Card|Dialog|Badge|Textarea|Select|Checkbox|Switch|RadioGroup|Sheet|Popover|Tooltip|Tabs|DropdownMenu|Table|EmptyState|Skeleton|Spinner|Alert|Toast)/);
    if (primMatch) havePrimitives.add(primMatch[1]);
  }

  // Per-file scan.
  const paletteRx = new RegExp(`\\b${PALETTE_PROP_GROUP}-(?:${PALETTE_GROUP})-\\d{2,3}\\b`, 'g');
  const arbitraryValueRx = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy]|w|h|text|leading|tracking|rounded|border|shadow|bg|top|bottom|left|right)-\[[^\]]+\]/g;
  const spacingRx = /\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy])-(\d+)\b/g;
  const radiusRx = /\brounded(?:-(?:none|sm|md|lg|xl|2xl|3xl|full))?\b/g;
  const hexRx = /#[0-9a-fA-F]{3,8}\b/g;

  for (const f of files) {
    if (!isFrontendPath(f.path)) continue;
    report.inspected++;
    if (isPrimitiveOrTokenFile(f.path)) continue;

    const c = f.content;

    // Palette colors.
    const paletteMatches = [...c.matchAll(paletteRx)].map((m) => m[0]);
    if (paletteMatches.length > 0) {
      report.violations.push({
        file: f.path, rule: 'forbidden-palette-color', count: paletteMatches.length,
        message: 'Tailwind palette colors are forbidden — use semantic tokens (bg-primary, text-foreground, …)',
        samples: Array.from(new Set(paletteMatches)).slice(0, 5),
      });
    }

    // Inline hex (excluding pure black/white).
    const hexMatches = [...c.matchAll(hexRx)].map((m) => m[0]).filter((h) => !/^#[fF]{3,8}$/.test(h) && !/^#0{3,8}$/.test(h));
    if (hexMatches.length > 0) {
      report.violations.push({
        file: f.path, rule: 'inline-hex-color', count: hexMatches.length,
        message: 'Hex colors are forbidden outside design-tokens / globals.css',
        samples: Array.from(new Set(hexMatches)).slice(0, 5),
      });
    }

    // Inline style={{ ... }}.
    const inlineStyle = (c.match(/style\s*=\s*\{\{/g) ?? []).length;
    if (inlineStyle > 0) {
      report.violations.push({
        file: f.path, rule: 'inline-style', count: inlineStyle,
        message: 'Inline style={{...}} is forbidden — use Tailwind utilities from the system',
      });
    }

    // Forbidden text sizes.
    const bigText = FORBIDDEN_TEXT_SIZES.filter((t) => new RegExp(`\\b${t}\\b`).test(c));
    if (bigText.length > 0) {
      report.violations.push({
        file: f.path, rule: 'forbidden-typography', count: bigText.length,
        message: 'Typography scale forbids text-4xl and larger — cap at text-3xl',
        samples: bigText,
      });
    }

    // Forbidden font weights.
    const heavy = FORBIDDEN_FONT_WEIGHTS.filter((t) => new RegExp(`\\b${t}\\b`).test(c));
    if (heavy.length > 0) {
      report.violations.push({
        file: f.path, rule: 'forbidden-font-weight', count: heavy.length,
        message: 'Allowed font weights: font-normal, font-medium, font-semibold only',
        samples: heavy,
      });
    }

    // Arbitrary [..] values.
    const arbitrary = [...c.matchAll(arbitraryValueRx)].map((m) => m[0]);
    if (arbitrary.length > 0) {
      report.violations.push({
        file: f.path, rule: 'arbitrary-tailwind-value', count: arbitrary.length,
        message: 'Arbitrary Tailwind values [..] are forbidden — use scale tokens',
        samples: Array.from(new Set(arbitrary)).slice(0, 5),
      });
    }

    // Off-grid spacing.
    const offGrid: string[] = [];
    for (const m of c.matchAll(spacingRx)) {
      const n = Number(m[1]);
      if (!ALLOWED_SPACING.has(n)) offGrid.push(m[0]);
    }
    if (offGrid.length > 0) {
      report.violations.push({
        file: f.path, rule: 'off-grid-spacing', count: offGrid.length,
        message: 'Off-grid spacing — allowed: 0,1,2,3,4,5,6,8,10,12,14,16,20,24,32,40,48,56,64',
        samples: Array.from(new Set(offGrid)).slice(0, 5),
      });
    }

    // Forbidden radius.
    const radiusMatches = [...c.matchAll(radiusRx)].map((m) => m[0]).filter((r) => !ALLOWED_RADIUS.has(r));
    if (radiusMatches.length > 0) {
      report.violations.push({
        file: f.path, rule: 'forbidden-radius', count: radiusMatches.length,
        message: 'Allowed radii: rounded-md, rounded-lg, rounded-full only',
        samples: Array.from(new Set(radiusMatches)).slice(0, 5),
      });
    }

    // Raw HTML interactive elements.
    const rawBtn = (c.match(/<button[\s>]/g) ?? []).length;
    if (rawBtn > 0) {
      report.violations.push({ file: f.path, rule: 'raw-button', count: rawBtn,
        message: 'Use <Button> primitive from @/components/ui/Button instead of raw <button>' });
    }
    const rawInp = (c.match(/<input[\s>]/g) ?? []).length;
    if (rawInp > 0) {
      report.violations.push({ file: f.path, rule: 'raw-input', count: rawInp,
        message: 'Use <Input> primitive from @/components/ui/Input instead of raw <input>' });
    }
    const rawTa = (c.match(/<textarea[\s>]/g) ?? []).length;
    if (rawTa > 0) {
      report.violations.push({ file: f.path, rule: 'raw-textarea', count: rawTa,
        message: 'Use <Textarea> primitive instead of raw <textarea>' });
    }
    const rawSel = (c.match(/<select[\s>]/g) ?? []).length;
    if (rawSel > 0) {
      report.violations.push({ file: f.path, rule: 'raw-select', count: rawSel,
        message: 'Use <Select> primitive instead of raw <select>' });
    }

    // useEffect + fetch antipattern.
    const efm = (c.match(/useEffect\s*\([\s\S]{0,500}?fetch\s*\(/g) ?? []).length;
    if (efm > 0) {
      report.violations.push({ file: f.path, rule: 'use-effect-fetch', count: efm,
        message: 'useEffect + fetch is forbidden — use @tanstack/react-query or swr' });
    }
  }

  // Structural violations only matter if there's any frontend at all.
  if (report.inspected > 0) {
    if (!hasShell) {
      report.violations.push({ file: 'components/layout/AppShell.tsx', rule: 'missing-app-shell',
        message: 'Missing AppShell + Sidebar + Topbar layout — every page must use the App Shell' });
    }
    for (const need of REQUIRED_PRIMITIVES) {
      if (!havePrimitives.has(need)) {
        report.violations.push({ file: `components/ui/${need}.tsx`, rule: 'missing-primitive',
          message: `Missing required primitive: ${need}` });
      }
    }
    if (!hasTokens) {
      report.violations.push({ file: 'lib/design-tokens.ts', rule: 'missing-design-tokens',
        message: 'Missing design tokens — emit lib/design-tokens.ts or wire tokens into tailwind.config.ts' });
    }
    if (!hasTailwindCfg) {
      report.violations.push({ file: 'tailwind.config.ts', rule: 'missing-tailwind-config',
        message: 'Missing tailwind.config.ts that consumes the design tokens' });
    }
  }

  report.totalCount = report.violations.reduce((acc, v) => acc + (v.count ?? 1), 0);

  // Reject thresholds:
  //  - Any structural miss (missing-app-shell / missing-primitive /
  //    missing-design-tokens / missing-tailwind-config) ⇒ reject.
  //  - Any forbidden palette color, inline hex, inline style, or arbitrary
  //    value ⇒ reject (these are unambiguous violations).
  //  - Off-grid spacing / typography / weight / radius / raw-element
  //    violations: reject when any occur. The model can either fix or
  //    suppress the rebuild via whitelist (none yet).
  report.failed = report.violations.length > 0;
  return report;
}

/**
 * Convert violations to QA-issue rows the rebuild loop already understands.
 * Caps at the most actionable items so a tiny rebuild prompt isn't drowned
 * in 500 magic-spacing entries.
 */
export function uiSystemViolationsAsIssues(
  report: UiSystemReport,
  cap = 30,
): Array<{ category: string; message: string; hint?: string; rootCause?: string }> {
  const issues: Array<{ category: string; message: string; hint?: string; rootCause?: string }> = [];
  for (const v of report.violations) {
    issues.push({
      category: 'ui-system',
      message: `${v.rule} in ${v.file}${v.count ? ` (×${v.count})` : ''}: ${v.message}`,
      hint: v.samples && v.samples.length > 0 ? `e.g. ${v.samples.join(', ')}` : undefined,
      rootCause: 'UI design-system violation',
    });
    if (issues.length >= cap) break;
  }
  return issues;
}
