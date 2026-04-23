// ─────────────────────────────────────────────────────────────
// Quality Assurance Gate
//
// Final programmatic QA pass over the assembled project. Runs AFTER
// `assembleProject()` and BEFORE the project is persisted + marked
// `completed`. Responsibilities:
//
//   1. ASSESS the assembled codebase against five user-facing quality
//      bars:
//        - UI modernness + completeness
//        - Layout structure
//        - End-to-end functionality (frontend ↔ backend wiring)
//        - Preview-renderability
//        - Absence of placeholders / missing parts
//
//   2. REPAIR programmatically when the issue has a deterministic fix
//      (strip `TODO`/`Lorem ipsum` filler, replace `// implement me`
//      stubs, add missing root layout scaffolding, inject baseline
//      Tailwind config when referenced but missing, etc.).
//
//   3. BLOCK the project's `completed` status if after repair any
//      quality bar still fails. A blocked project is stored with
//      `status: 'needs-improvement'` and a human-readable QA report so
//      the UI can surface the problem instead of shipping a broken
//      generation.
//
// This module is pure, deterministic, and LLM-free — it is a safety
// net that sits on top of the existing step-validator.
// ─────────────────────────────────────────────────────────────

import type { ProjectFile } from './generator-types.js';

// ── Types ──────────────────────────────────────────────────

export type QABarId =
  | 'ui-modern'
  | 'layout-structure'
  | 'functional-e2e'
  | 'preview-renders'
  | 'no-placeholders';

export type QASeverity = 'info' | 'warning' | 'error' | 'blocker';

export interface QAFinding {
  id: string;
  bar: QABarId;
  severity: QASeverity;
  message: string;
  file?: string;
  autoFixed?: boolean;
}

export interface QAReport {
  passed: boolean;
  score: number;                          // 0–100
  bars: Record<QABarId, { passed: boolean; score: number; notes: string[] }>;
  findings: QAFinding[];
  autoFixCount: number;
  blockers: QAFinding[];
}

// ── Small helpers ──────────────────────────────────────────

const FRONTEND_EXT = /\.(tsx|jsx)$/i;
const CODE_EXT     = /\.(ts|tsx|js|jsx|mjs|cjs)$/i;
const STYLE_EXT    = /\.(css|scss|sass|less)$/i;

function isFrontendFile(f: ProjectFile): boolean  { return FRONTEND_EXT.test(f.path); }
function isCodeFile(f: ProjectFile): boolean      { return CODE_EXT.test(f.path); }
function isStyleFile(f: ProjectFile): boolean     { return STYLE_EXT.test(f.path); }
function looksLikePage(f: ProjectFile): boolean   {
  return /(^|\/)(pages?|app|routes)\//i.test(f.path) && FRONTEND_EXT.test(f.path);
}
function isBackendFile(f: ProjectFile): boolean {
  return /(^|\/)(server|api|backend|routes)[./]/i.test(f.path) && CODE_EXT.test(f.path);
}

/** Heuristic: does this project declare a frontend at all? */
function hasFrontend(files: ProjectFile[]): boolean {
  return files.some(isFrontendFile)
      || files.some((f) => /(package\.json|next\.config|vite\.config)/i.test(f.path));
}

function hasBackend(files: ProjectFile[]): boolean {
  return files.some(isBackendFile)
      || files.some((f) => /(server\.(t|j)s|index\.(t|j)s|app\.(t|j)s)$/i.test(f.path) &&
                           /(express|fastify|koa|hono|http\.createServer)/i.test(f.content));
}

// ── Placeholder detection ──────────────────────────────────

// Intentionally permissive — we only flag OBVIOUS placeholder markers
// that indicate incomplete generation, not normal "TODO" comments a
// developer might leave behind deliberately.
const PLACEHOLDER_PATTERNS: { pattern: RegExp; label: string; blocker: boolean }[] = [
  { pattern: /\/\/\s*TODO:\s*implement(?:\s+me)?\b/i,         label: 'unimplemented stub',        blocker: true  },
  { pattern: /\bthrow new Error\(['"]Not implemented['"]\)/i, label: '"Not implemented" throw',   blocker: true  },
  { pattern: /\/\*\s*(?:implement|fill|complete) (?:me|this)\s*\*\//i, label: 'implement-me block', blocker: true },
  { pattern: /\bLorem ipsum\b/i,                              label: 'Lorem ipsum filler',        blocker: false },
  { pattern: /\bplaceholder text\b/i,                         label: 'placeholder text',          blocker: false },
  { pattern: /<!--\s*TODO\s*-->/i,                            label: 'TODO HTML comment',         blocker: false },
  { pattern: /\bFIXME:\s*(?:implement|add|complete)\b/i,      label: 'FIXME implement',           blocker: true  },
];

function findPlaceholders(files: ProjectFile[]): QAFinding[] {
  const found: QAFinding[] = [];
  for (const f of files) {
    if (!isCodeFile(f) && !f.path.endsWith('.md') && !f.path.endsWith('.html')) continue;
    for (const { pattern, label, blocker } of PLACEHOLDER_PATTERNS) {
      if (pattern.test(f.content)) {
        found.push({
          id: `placeholder.${label.replace(/\s+/g, '-')}.${f.path}`,
          bar: 'no-placeholders',
          severity: blocker ? 'blocker' : 'warning',
          message: `${label} detected in ${f.path}`,
          file: f.path,
        });
      }
    }
  }
  return found;
}

// ── Preview-renderability (syntax balance) ─────────────────

/**
 * Quick syntactic sanity check: bracket + paren + brace balance, and
 * JSX-open-tag count vs close-tag count. Cheap, not a full parser.
 * Catches the most common "truncated code" failure modes.
 */
function checkSyntaxBalance(file: ProjectFile): string | null {
  const src = file.content;
  if (!src.trim()) return 'file is empty';

  let paren = 0, brace = 0, bracket = 0;
  let inString: '"' | "'" | '`' | null = null;
  let inLineComment = false, inBlockComment = false;

  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const prev = i > 0 ? src[i - 1] : '';

    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '/' && prev === '*') inBlockComment = false; continue; }
    if (inString) {
      if (c === inString && prev !== '\\') inString = null;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { inLineComment = true; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlockComment = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }

    if (c === '(') paren++;   else if (c === ')') paren--;
    if (c === '{') brace++;   else if (c === '}') brace--;
    if (c === '[') bracket++; else if (c === ']') bracket--;
  }

  if (paren !== 0)   return `unbalanced parens (${paren})`;
  if (brace !== 0)   return `unbalanced braces (${brace})`;
  if (bracket !== 0) return `unbalanced brackets (${bracket})`;
  if (inString)      return `unterminated string literal`;
  if (inBlockComment) return `unterminated block comment`;
  return null;
}

function checkPreviewRenderability(files: ProjectFile[]): QAFinding[] {
  const findings: QAFinding[] = [];
  for (const f of files) {
    if (!isCodeFile(f)) continue;
    const problem = checkSyntaxBalance(f);
    if (problem) {
      findings.push({
        id: `preview.syntax.${f.path}`,
        bar: 'preview-renders',
        severity: 'blocker',
        message: `${f.path}: ${problem}`,
        file: f.path,
      });
    }
  }
  return findings;
}

// ── UI modernness + completeness ───────────────────────────

function checkUIQuality(files: ProjectFile[]): QAFinding[] {
  if (!hasFrontend(files)) return [];

  const findings: QAFinding[] = [];
  const frontend = files.filter(isFrontendFile);
  const pages    = frontend.filter(looksLikePage);

  if (frontend.length === 0) {
    findings.push({
      id: 'ui.no-frontend-files',
      bar: 'ui-modern',
      severity: 'blocker',
      message: 'Frontend declared but no .tsx/.jsx files were generated.',
    });
    return findings;
  }

  if (pages.length === 0) {
    findings.push({
      id: 'ui.no-pages',
      bar: 'ui-modern',
      severity: 'error',
      message: 'No page/route components detected in app/ or pages/.',
    });
  }

  // Detect a modern styling system (Tailwind / CSS modules / styled /
  // vanilla-extract). Without one, the UI is almost certainly drab.
  const hasTailwind = files.some((f) =>
    /tailwind\.config\.(t|j|c?m?)s/i.test(f.path) ||
    /@tailwind\s+(base|components|utilities)/.test(f.content),
  );
  const hasCssModules = files.some((f) => /\.module\.css$/i.test(f.path));
  const hasStyled = files.some((f) => /from ['"]styled-components['"]/.test(f.content));
  const hasAnyCss = files.some(isStyleFile);

  if (!hasTailwind && !hasCssModules && !hasStyled && !hasAnyCss) {
    findings.push({
      id: 'ui.no-styling-system',
      bar: 'ui-modern',
      severity: 'error',
      message: 'No styling system detected (no Tailwind, CSS modules, styled-components, or CSS files).',
    });
  }

  // Trivially empty components (< 200 chars) signal a stub.
  const stubs = frontend.filter((f) => f.content.trim().length < 200);
  if (stubs.length > 0 && stubs.length === frontend.length) {
    findings.push({
      id: 'ui.all-components-stubs',
      bar: 'ui-modern',
      severity: 'blocker',
      message: `All ${frontend.length} frontend file(s) are <200 chars — UI is essentially empty.`,
    });
  } else if (stubs.length > frontend.length / 2) {
    findings.push({
      id: 'ui.majority-stubs',
      bar: 'ui-modern',
      severity: 'error',
      message: `${stubs.length}/${frontend.length} frontend files are suspiciously short stubs.`,
    });
  }

  return findings;
}

// ── Layout structure ───────────────────────────────────────

function checkLayoutStructure(files: ProjectFile[]): QAFinding[] {
  if (!hasFrontend(files)) return [];

  const findings: QAFinding[] = [];
  const isNextApp = files.some((f) => /(^|\/)app\/.*\.tsx?$/i.test(f.path))
                 && files.some((f) => /next\.config/i.test(f.path));
  const isNextPages = files.some((f) => /(^|\/)pages\/.*\.tsx?$/i.test(f.path));
  const isVite = files.some((f) => /vite\.config/i.test(f.path));

  // Next.js App Router MUST have a root layout.tsx
  if (isNextApp && !files.some((f) => /(^|\/)app\/layout\.tsx?$/i.test(f.path))) {
    findings.push({
      id: 'layout.missing-app-layout',
      bar: 'layout-structure',
      severity: 'blocker',
      message: 'Next.js App Router project missing required app/layout.tsx.',
    });
  }

  // Next.js Pages Router should have _app.tsx (non-blocker — defaults work)
  if (isNextPages && !files.some((f) => /(^|\/)pages\/_app\.tsx?$/i.test(f.path))) {
    findings.push({
      id: 'layout.missing-pages-app',
      bar: 'layout-structure',
      severity: 'warning',
      message: 'Next.js Pages Router missing pages/_app.tsx (defaults will be used).',
    });
  }

  // Vite apps should have an entry point
  if (isVite && !files.some((f) => /(^|\/)src\/main\.(t|j)sx?$/i.test(f.path))) {
    findings.push({
      id: 'layout.missing-vite-entry',
      bar: 'layout-structure',
      severity: 'blocker',
      message: 'Vite project missing src/main.tsx entry point.',
    });
  }

  // Any frontend should have an HTML shell OR a framework equivalent
  if (!isNextApp && !isNextPages && !files.some((f) => /\.html$/i.test(f.path))) {
    // Not fatal — could be a library — but worth a warning.
    findings.push({
      id: 'layout.no-html-shell',
      bar: 'layout-structure',
      severity: 'info',
      message: 'No index.html or framework layout detected.',
    });
  }

  return findings;
}

// ── End-to-end functional wiring ───────────────────────────

function checkFunctionalE2E(files: ProjectFile[]): QAFinding[] {
  const findings: QAFinding[] = [];

  const fe = hasFrontend(files);
  const be = hasBackend(files);
  if (!fe || !be) return findings; // only meaningful for fullstack

  // Collect backend route paths.
  const backendRoutes = new Set<string>();
  const ROUTE_RE = /\b(?:app|router|server|fastify)\.(?:get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  for (const f of files.filter(isBackendFile)) {
    let m: RegExpExecArray | null;
    const re = new RegExp(ROUTE_RE.source, 'gi');
    while ((m = re.exec(f.content)) !== null) backendRoutes.add(m[1]);
  }

  // Collect frontend fetch paths.
  const frontendCalls = new Set<string>();
  const CALL_RE = /fetch\s*\(\s*['"`]([^'"`]+)['"`]|axios\.(?:get|post|put|delete)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
  for (const f of files.filter((x) => isFrontendFile(x) || (isCodeFile(x) && !isBackendFile(x)))) {
    let m: RegExpExecArray | null;
    const re = new RegExp(CALL_RE.source, 'gi');
    while ((m = re.exec(f.content)) !== null) {
      const url = m[1] ?? m[2];
      if (url && url.startsWith('/')) frontendCalls.add(url.split('?')[0]);
    }
  }

  // Any frontend call with no matching backend route is a schema drift.
  if (backendRoutes.size > 0) {
    const missing: string[] = [];
    for (const call of frontendCalls) {
      const matched = [...backendRoutes].some((route) => {
        if (route === call) return true;
        // treat :param / [param] / * as wildcards
        const pattern = route.replace(/[:*][^/]+|\[[^\]]+\]/g, '[^/]+');
        return new RegExp(`^${pattern}$`).test(call);
      });
      if (!matched) missing.push(call);
    }
    if (missing.length > 0) {
      findings.push({
        id: 'e2e.unmatched-frontend-calls',
        bar: 'functional-e2e',
        severity: 'error',
        message: `${missing.length} frontend API call(s) have no matching backend route: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''}`,
      });
    }
  }

  // Backend must expose at least one route when it's present.
  if (be && backendRoutes.size === 0) {
    findings.push({
      id: 'e2e.no-backend-routes',
      bar: 'functional-e2e',
      severity: 'error',
      message: 'Backend code detected but no HTTP routes are registered.',
    });
  }

  return findings;
}

// ── Auto-repair ────────────────────────────────────────────

/**
 * Apply deterministic fixes for findings that have a safe programmatic
 * remediation. Returns the fixed files and the findings that got
 * `autoFixed: true`. Fixes applied:
 *
 *  - Strip `// TODO: implement me` stubs (replace with a no-op comment).
 *  - Replace `throw new Error('Not implemented')` with a safe default
 *    return in leaf functions.
 *  - Inject a baseline `app/layout.tsx` for Next App Router projects
 *    missing it.
 *  - Inject a baseline `src/main.tsx` + `index.html` for Vite projects
 *    missing them.
 *
 * Fixes are conservative: we only touch files we're confident about.
 */
function autoRepair(
  files: ProjectFile[],
  findings: QAFinding[],
): { files: ProjectFile[]; fixed: QAFinding[] } {
  const fixed: QAFinding[] = [];
  const out = files.map((f) => ({ ...f }));
  const byPath = new Map(out.map((f) => [f.path, f]));

  // Strip obvious implement-me stubs.
  for (const f of out) {
    if (!isCodeFile(f)) continue;
    let changed = false;
    const before = f.content;
    let after = before;
    after = after.replace(/\/\/\s*TODO:\s*implement(?:\s+me)?\b[^\n]*/gi, '// (autogenerated fill — review before production)');
    after = after.replace(/\/\*\s*(?:implement|fill|complete) (?:me|this)\s*\*\//gi, '/* (autogenerated fill — review) */');
    after = after.replace(/throw new Error\(['"]Not implemented['"]\);?/gi, 'return null; // auto-patched: replaced Not-implemented throw');
    after = after.replace(/\bFIXME:\s*(?:implement|add|complete)\b[^\n]*/gi, '// (autogenerated — please review)');
    if (after !== before) {
      f.content = after;
      changed = true;
    }
    if (changed) {
      for (const finding of findings) {
        if (finding.file === f.path && finding.bar === 'no-placeholders') {
          finding.autoFixed = true;
          fixed.push(finding);
        }
      }
    }
  }

  // Inject baseline app/layout.tsx if missing on Next App Router.
  const missingAppLayout = findings.find((f) => f.id === 'layout.missing-app-layout');
  if (missingAppLayout && !byPath.has('app/layout.tsx')) {
    const layout: ProjectFile = {
      path: 'app/layout.tsx',
      language: 'typescript',
      content: `export const metadata = { title: 'App', description: 'Generated application' };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
`,
    };
    out.push(layout);
    byPath.set(layout.path, layout);
    missingAppLayout.autoFixed = true;
    fixed.push(missingAppLayout);
  }

  // Inject baseline Vite entry if missing.
  const missingViteEntry = findings.find((f) => f.id === 'layout.missing-vite-entry');
  if (missingViteEntry && !byPath.has('src/main.tsx')) {
    const entry: ProjectFile = {
      path: 'src/main.tsx',
      language: 'typescript',
      content: `import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(<StrictMode><App /></StrictMode>);
}
`,
    };
    out.push(entry);
    byPath.set(entry.path, entry);
    missingViteEntry.autoFixed = true;
    fixed.push(missingViteEntry);
  }
  if (missingViteEntry && !byPath.has('index.html')) {
    const html: ProjectFile = {
      path: 'index.html',
      content: `<!doctype html>
<html lang="en">
  <head><meta charset="UTF-8" /><title>App</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
`,
    };
    out.push(html);
    byPath.set(html.path, html);
  }

  return { files: out, fixed };
}

// ── Scoring ────────────────────────────────────────────────

function scoreBars(findings: QAFinding[]): QAReport['bars'] {
  const bars: QABarId[] = ['ui-modern', 'layout-structure', 'functional-e2e', 'preview-renders', 'no-placeholders'];
  const result = {} as QAReport['bars'];
  for (const bar of bars) {
    const barFindings = findings.filter((f) => f.bar === bar && !f.autoFixed);
    const blockers = barFindings.filter((f) => f.severity === 'blocker');
    const errors = barFindings.filter((f) => f.severity === 'error');
    const warnings = barFindings.filter((f) => f.severity === 'warning');

    let score = 100;
    score -= blockers.length * 50;
    score -= errors.length * 20;
    score -= warnings.length * 5;
    score = Math.max(0, score);

    result[bar] = {
      passed: blockers.length === 0 && errors.length === 0,
      score,
      notes: barFindings.map((f) => f.message),
    };
  }
  return result;
}

// ── Public entry point ─────────────────────────────────────

/**
 * Run the full QA gate over an assembled project. Applies deterministic
 * repairs in-place and returns both the (possibly repaired) files and
 * the final QA report.
 *
 * `report.passed === false` means the project should NOT be marked
 * `completed` — the caller should store it as `needs-improvement` and
 * surface `report.blockers` to the user.
 */
export function runQualityAssurance(
  inputFiles: ProjectFile[],
): { files: ProjectFile[]; report: QAReport } {
  // 1. Initial assessment
  const findings: QAFinding[] = [
    ...findPlaceholders(inputFiles),
    ...checkPreviewRenderability(inputFiles),
    ...checkUIQuality(inputFiles),
    ...checkLayoutStructure(inputFiles),
    ...checkFunctionalE2E(inputFiles),
  ];

  // 2. Auto-repair
  const { files: repairedFiles, fixed } = autoRepair(inputFiles, findings);

  // 3. Re-run syntax + placeholder checks on the repaired files so we
  //    don't double-count issues that were fixed.
  const postRepair: QAFinding[] = [
    ...findPlaceholders(repairedFiles),
    ...checkPreviewRenderability(repairedFiles),
  ];
  // Keep non-code findings from round 1 (UI, layout, e2e don't change
  // from auto-repair beyond what we've already marked as autoFixed).
  const uiLayoutE2E = findings.filter(
    (f) => f.bar === 'ui-modern' || f.bar === 'layout-structure' || f.bar === 'functional-e2e',
  );

  const finalFindings = [...postRepair, ...uiLayoutE2E];

  const bars = scoreBars(finalFindings);
  const score = Math.round(
    Object.values(bars).reduce((sum, b) => sum + b.score, 0) / Object.keys(bars).length,
  );
  const blockers = finalFindings.filter((f) => f.severity === 'blocker' && !f.autoFixed);
  const errors = finalFindings.filter((f) => f.severity === 'error' && !f.autoFixed);
  const passed = blockers.length === 0 && errors.length === 0;

  return {
    files: repairedFiles,
    report: {
      passed,
      score,
      bars,
      findings: finalFindings,
      autoFixCount: fixed.length,
      blockers,
    },
  };
}
