/**
 * Production-polish audit — pure, zero-LLM scan run BEFORE the polish
 * agent so the polish prompt can include a targeted fix list for:
 *
 *   1. UNUSED CODE      — unused imports, dead files (no other source
 *                         file imports them), unused exported symbols
 *                         (best-effort across the merged codebase).
 *   2. A11Y BASICS      — icon-only <button> without aria-label, <img>
 *                         without alt attribute, <input> without an
 *                         associated label, pages missing a single <h1>,
 *                         missing <main> landmark, anchor without href.
 *   3. RESPONSIVENESS   — fixed pixel widths > 400px, w-screen on inner
 *                         layouts, missing responsive prefixes on key
 *                         layout files (no md:/lg: anywhere in app shell).
 *
 * The polish agent is the FINAL pass; it runs once at the end, so this
 * audit is the last opportunity to catch these issues without bloating
 * the QA loop.
 */

export interface PolishAuditViolation {
  rule: PolishAuditRule;
  file: string;
  line?: number;
  evidence: string;
  message: string;
}

export type PolishAuditRule =
  | 'unused-import'
  | 'dead-file'
  | 'unused-export'
  | 'a11y-icon-button-no-label'
  | 'a11y-img-no-alt'
  | 'a11y-input-no-label'
  | 'a11y-missing-h1'
  | 'a11y-missing-main'
  | 'a11y-anchor-no-href'
  | 'responsive-fixed-width'
  | 'responsive-w-screen'
  | 'responsive-no-breakpoints';

export interface PolishAuditReport {
  inspected: number;
  violations: PolishAuditViolation[];
  unusedImports: number;
  deadFiles: number;
  unusedExports: number;
  a11yIssues: number;
  responsiveIssues: number;
  failed: boolean;
}

interface FileLike {
  path: string;
  content: string;
  language?: string;
}

const SOURCE_RE = /\.(t|j)sx?$|\.(mts|cts)$/i;
const TSX_RE = /\.(t|j)sx$/i;
const TEST_RE = /(^|\/)(tests?|__tests__|e2e|spec)\/|\.(test|spec)\.[^./]+$/i;
const STORY_RE = /\.stories\.(t|j)sx?$/i;
const PAGE_RE = /\/app\/.+\/page\.(t|j)sx$/i;
const APP_LAYOUT_RE = /\/(layout|app-?shell|sidebar|topbar)\.(t|j)sx$/i;
const ENTRY_RE =
  /(^|\/)(page|layout|loading|error|not-found|template|route|middleware|index|main|server|app)\.[^./]+$/i;

const MAX_VIOLATIONS = 120;

export function runProductionPolishAudit(files: FileLike[]): PolishAuditReport {
  const violations: PolishAuditViolation[] = [];
  let inspected = 0;

  // Build an import graph once so the dead-file + unused-export rules
  // share the same data.
  const sourceFiles = files.filter((f) => SOURCE_RE.test(f.path) && !TEST_RE.test(f.path) && !STORY_RE.test(f.path));
  const importGraph = buildImportGraph(sourceFiles);

  const push = (v: PolishAuditViolation): void => {
    if (violations.length >= MAX_VIOLATIONS) return;
    violations.push(v);
  };

  for (const f of sourceFiles) {
    inspected++;
    const lines = f.content.split('\n');

    // ── Per-file scans ──────────────────────────────────────────────
    scanUnusedImports(f, lines, push);
    if (TSX_RE.test(f.path)) {
      scanA11y(f, lines, push);
      scanResponsive(f, lines, push);
    }
  }

  // ── Cross-file scans ─────────────────────────────────────────────
  scanDeadFiles(sourceFiles, importGraph, push);
  scanUnusedExports(sourceFiles, importGraph, push);

  let unusedImports = 0;
  let deadFiles = 0;
  let unusedExports = 0;
  let a11yIssues = 0;
  let responsiveIssues = 0;
  for (const v of violations) {
    if (v.rule === 'unused-import') unusedImports++;
    else if (v.rule === 'dead-file') deadFiles++;
    else if (v.rule === 'unused-export') unusedExports++;
    else if (v.rule.startsWith('a11y-')) a11yIssues++;
    else if (v.rule.startsWith('responsive-')) responsiveIssues++;
  }

  return {
    inspected,
    violations,
    unusedImports,
    deadFiles,
    unusedExports,
    a11yIssues,
    responsiveIssues,
    failed: violations.length > 0,
  };
}

/** Format the audit into a markdown block injected into the polish prompt. */
export function formatPolishAuditForPrompt(report: PolishAuditReport): string {
  if (!report.failed) return '';
  let out = `## ⚠ PRODUCTION-POLISH AUDIT — ${report.violations.length} issue(s) to fix in this final pass\n\n`;
  out += `Counts: unused-imports=${report.unusedImports}, dead-files=${report.deadFiles}, unused-exports=${report.unusedExports}, a11y=${report.a11yIssues}, responsive=${report.responsiveIssues}\n\n`;

  const groups = new Map<PolishAuditRule, PolishAuditViolation[]>();
  for (const v of report.violations) {
    const list = groups.get(v.rule) ?? [];
    list.push(v);
    groups.set(v.rule, list);
  }

  const order: PolishAuditRule[] = [
    'dead-file',
    'unused-import',
    'unused-export',
    'a11y-icon-button-no-label',
    'a11y-img-no-alt',
    'a11y-input-no-label',
    'a11y-anchor-no-href',
    'a11y-missing-h1',
    'a11y-missing-main',
    'responsive-fixed-width',
    'responsive-w-screen',
    'responsive-no-breakpoints',
  ];
  for (const rule of order) {
    const rows = groups.get(rule);
    if (!rows || rows.length === 0) continue;
    out += `### ${RULE_LABEL[rule]} (${rows.length})\n`;
    for (const r of rows.slice(0, 15)) {
      const where = r.line ? `${r.file}:${r.line}` : r.file;
      out += `  - ${where} — ${r.evidence}\n`;
    }
    if (rows.length > 15) out += `  - … (${rows.length - 15} more)\n`;
    out += '\n';
  }
  out += `Every issue above MUST be addressed in patches[] / newFiles[]. The polish pass runs ONCE at the end of the pipeline — this is the final opportunity to clean up the codebase.\n\n`;
  return out;
}

const RULE_LABEL: Record<PolishAuditRule, string> = {
  'unused-import': 'Unused imports — delete the import statement',
  'dead-file':     'Dead files — file is never imported by any other source file; delete it or wire it in',
  'unused-export': 'Unused exports — exported symbol is never imported; remove the export keyword (or delete the symbol if also unused locally)',
  'a11y-icon-button-no-label': 'Icon-only <button> missing aria-label — add a descriptive aria-label',
  'a11y-img-no-alt':           '<img> missing alt — add a descriptive alt (or alt="" for decorative)',
  'a11y-input-no-label':       '<input> with no associated <label htmlFor=…> or wrapping label — add one',
  'a11y-missing-h1':           'Page missing <h1> — every page must declare exactly one h1',
  'a11y-missing-main':         'Page missing <main> landmark — wrap the primary content in <main>',
  'a11y-anchor-no-href':       '<a> missing href — use <button> for actions, <a href> for navigation',
  'responsive-fixed-width':    'Fixed pixel width > 400px — use Tailwind responsive utilities (max-w-*, w-full + breakpoints)',
  'responsive-w-screen':       'w-screen on inner layout — use w-full inside layout shells (w-screen forces horizontal scroll on mobile)',
  'responsive-no-breakpoints': 'Layout file has no responsive breakpoints (no sm:/md:/lg: classes) — add mobile-first responsive variants',
};

// ─── Per-file scanners ─────────────────────────────────────────────

interface ImportInfo {
  /** module specifier (./foo or 'react'). */
  spec: string;
  /** named imports: { foo, bar as baz } → ['foo', 'baz']. */
  named: string[];
  /** default import name, if any. */
  def?: string;
  /** namespace import name, if any (\* as React). */
  ns?: string;
  line: number;
  /** raw import line, for evidence. */
  raw: string;
}

function parseImports(content: string): ImportInfo[] {
  const out: ImportInfo[] = [];
  const importRe =
    /^import\s+(?:(?:type\s+)?(?:(\w+)\s*,?\s*)?(?:\{([^}]+)\})?(?:\*\s+as\s+(\w+))?\s*from\s*)?['"`]([^'"`]+)['"`];?/gm;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(content)) !== null) {
    const def = m[1];
    const namedRaw = m[2];
    const ns = m[3];
    const spec = m[4];
    const named: string[] = [];
    if (namedRaw) {
      for (const part of namedRaw.split(',')) {
        const t = part.trim();
        if (!t) continue;
        // strip "type " prefix; pick alias after "as".
        const stripped = t.replace(/^type\s+/, '');
        const aliasMatch = stripped.match(/^\S+\s+as\s+(\w+)$/);
        if (aliasMatch) named.push(aliasMatch[1]);
        else {
          const id = stripped.match(/^(\w+)/);
          if (id) named.push(id[1]);
        }
      }
    }
    // Compute line number from the offset.
    const line = content.slice(0, m.index).split('\n').length;
    const raw = (m[0] ?? '').replace(/\s+/g, ' ').trim();
    out.push({ spec, named, def, ns, line, raw });
  }
  return out;
}

function scanUnusedImports(
  f: FileLike,
  lines: string[],
  push: (v: PolishAuditViolation) => void,
): void {
  const imports = parseImports(f.content);
  if (imports.length === 0) return;
  // Body = content with import lines stripped (so we don't match the
  // identifier inside its own import statement).
  const importLineSet = new Set(imports.map((i) => i.line - 1));
  const body = lines.map((l, i) => (importLineSet.has(i) ? '' : l)).join('\n');

  for (const imp of imports) {
    // Side-effect imports (import './foo.css') — skip.
    if (imp.named.length === 0 && !imp.def && !imp.ns) continue;
    const ids = [...imp.named, imp.def, imp.ns].filter(Boolean) as string[];
    const unused = ids.filter((id) => !isIdentifierUsed(body, id));
    if (unused.length === 0) continue;
    if (unused.length === ids.length) {
      push({
        rule: 'unused-import',
        file: f.path,
        line: imp.line,
        evidence: imp.raw.slice(0, 160),
        message: `Entire import from '${imp.spec}' is unused — delete the line.`,
      });
    } else {
      push({
        rule: 'unused-import',
        file: f.path,
        line: imp.line,
        evidence: `unused: ${unused.join(', ')} from '${imp.spec}'`,
        message: `Remove unused names (${unused.join(', ')}) from the import.`,
      });
    }
  }
}

function isIdentifierUsed(body: string, id: string): boolean {
  // Word-boundary search; avoid matching inside string literals is hard
  // without an AST so we accept some false-negatives (extra noise) rather
  // than false-positives (claiming used when not).
  const re = new RegExp(`\\b${escapeRe(id)}\\b`);
  return re.test(body);
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── A11y scans ────────────────────────────────────────────────────

const ICON_LIB_RE = /\b(?:lucide-react|@heroicons|react-icons|@radix-ui\/react-icons|tabler-icons)/;

function scanA11y(
  f: FileLike,
  lines: string[],
  push: (v: PolishAuditViolation) => void,
): void {
  const usesIconLib = ICON_LIB_RE.test(f.content);
  let perFileButton = 0;
  let perFileImg = 0;
  let perFileInput = 0;
  let perFileAnchor = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];

    // Icon-only button: <button …><Icon …/></button> with no aria-label,
    // no title, no children text. Heuristic — opening tag spans up to 3
    // lines, then the body must be only an <Icon …/> expression.
    if (perFileButton < 4) {
      const idx = raw.search(/<button\b/);
      if (idx !== -1) {
        const open = collectOpenTag(lines, i, 4);
        if (open && !/\baria-label\s*=/.test(open.tag) && !/\btitle\s*=/.test(open.tag) && !/\baria-labelledby\s*=/.test(open.tag)) {
          const body = collectTagBody(lines, open.endLine, '</button>', 4);
          if (body !== null && isIconOnly(body, usesIconLib)) {
            push({
              rule: 'a11y-icon-button-no-label',
              file: f.path,
              line: i + 1,
              evidence: open.tag.slice(0, 160),
              message: 'Icon-only button needs an aria-label describing the action.',
            });
            perFileButton++;
          }
        }
      }
    }

    // <img> without alt
    if (perFileImg < 4 && /<img\b/.test(raw)) {
      const open = collectOpenTag(lines, i, 4);
      if (open && !/\balt\s*=/.test(open.tag)) {
        push({
          rule: 'a11y-img-no-alt',
          file: f.path,
          line: i + 1,
          evidence: open.tag.slice(0, 160),
          message: 'Add alt attribute (descriptive, or alt="" if purely decorative).',
        });
        perFileImg++;
      }
    }

    // <input> with no associated label. Heuristic — only flag when the
    // input has no aria-label, no aria-labelledby, no id (which would
    // hint a label exists somewhere), and isn't type=hidden/submit.
    if (perFileInput < 4 && /<input\b/.test(raw)) {
      const open = collectOpenTag(lines, i, 4);
      if (
        open &&
        !/\baria-label\s*=/.test(open.tag) &&
        !/\baria-labelledby\s*=/.test(open.tag) &&
        !/\bid\s*=/.test(open.tag) &&
        !/\btype\s*=\s*["'`](hidden|submit|button|reset)["'`]/.test(open.tag)
      ) {
        push({
          rule: 'a11y-input-no-label',
          file: f.path,
          line: i + 1,
          evidence: open.tag.slice(0, 160),
          message: 'Associate this input with a <label htmlFor> or add aria-label.',
        });
        perFileInput++;
      }
    }

    // <a> without href
    if (perFileAnchor < 4) {
      const idx = raw.search(/<a\b/);
      if (idx !== -1) {
        const open = collectOpenTag(lines, i, 3);
        if (open && !/\bhref\s*=/.test(open.tag) && !/\{\.\.\.[\w$]+\}/.test(open.tag)) {
          push({
            rule: 'a11y-anchor-no-href',
            file: f.path,
            line: i + 1,
            evidence: open.tag.slice(0, 160),
            message: 'Anchor without href is non-navigable. Use <button> for actions or add href.',
          });
          perFileAnchor++;
        }
      }
    }
  }

  // Page-level a11y: missing <h1> / <main> only on page.tsx files.
  if (PAGE_RE.test(f.path)) {
    if (!/<h1[\s>]/.test(f.content) && !/\bas=["'`]?h1["'`]?/.test(f.content)) {
      push({
        rule: 'a11y-missing-h1',
        file: f.path,
        evidence: 'no <h1> tag found in page',
        message: 'Add a single <h1> with the page title (PageHeader primitive recommended).',
      });
    }
    if (!/<main[\s>]/.test(f.content)) {
      push({
        rule: 'a11y-missing-main',
        file: f.path,
        evidence: 'no <main> landmark found',
        message: 'Wrap the primary content in <main> (or rely on the AppShell layout to provide it).',
      });
    }
  }
}

function collectOpenTag(
  lines: string[],
  startIdx: number,
  maxSpan: number,
): { tag: string; endLine: number } | null {
  let acc = '';
  for (let j = startIdx; j < Math.min(startIdx + maxSpan, lines.length); j++) {
    acc += (j === startIdx ? lines[j] : ' ' + lines[j]);
    if (acc.includes('>')) {
      const tag = acc.slice(0, acc.indexOf('>') + 1);
      return { tag, endLine: j };
    }
  }
  return null;
}

function collectTagBody(
  lines: string[],
  startIdx: number,
  closeTag: string,
  maxSpan: number,
): string | null {
  let acc = '';
  for (let j = startIdx; j < Math.min(startIdx + maxSpan, lines.length); j++) {
    acc += '\n' + lines[j];
    const close = acc.indexOf(closeTag);
    if (close !== -1) {
      // Strip everything after the FIRST '>' (end of opening tag).
      const openEnd = acc.indexOf('>');
      return openEnd === -1 ? '' : acc.slice(openEnd + 1, close);
    }
  }
  return null;
}

function isIconOnly(body: string, usesIconLib: boolean): boolean {
  const trimmed = body.trim();
  if (trimmed.length === 0) return false;
  // Only an icon component: <SomeIcon … /> with optional whitespace.
  const iconJsx = /^<\s*[A-Z]\w*Icon\b[^>]*\/?>(\s*<\/[A-Z]\w*Icon>)?$/;
  const anyIconJsx = /^<\s*[A-Z]\w*\b[^>]*\/?>$/;
  if (iconJsx.test(trimmed)) return true;
  if (usesIconLib && anyIconJsx.test(trimmed)) return true;
  return false;
}

// ─── Responsive scans ──────────────────────────────────────────────

const FIXED_WIDTH_RE = /\bw-\[(\d+)px\]/g;
const W_SCREEN_RE = /\bw-screen\b/;
const RESPONSIVE_PREFIX_RE = /\b(sm|md|lg|xl|2xl):/;

function scanResponsive(
  f: FileLike,
  lines: string[],
  push: (v: PolishAuditViolation) => void,
): void {
  let perFileFixed = 0;
  let perFileScreen = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (perFileFixed < 3) {
      let m: RegExpExecArray | null;
      const re = new RegExp(FIXED_WIDTH_RE.source, 'g');
      while ((m = re.exec(raw)) !== null) {
        const px = Number(m[1]);
        if (px > 400) {
          push({
            rule: 'responsive-fixed-width',
            file: f.path,
            line: i + 1,
            evidence: `w-[${px}px]`,
            message: `Fixed width w-[${px}px] breaks on small screens. Use max-w-* + responsive prefixes.`,
          });
          perFileFixed++;
          if (perFileFixed >= 3) break;
        }
      }
    }
    if (perFileScreen < 1 && W_SCREEN_RE.test(raw) && !/min-w-screen|max-w-screen/.test(raw)) {
      push({
        rule: 'responsive-w-screen',
        file: f.path,
        line: i + 1,
        evidence: raw.trim().slice(0, 160),
        message: 'w-screen on inner layouts forces horizontal scroll on mobile. Use w-full.',
      });
      perFileScreen++;
    }
  }

  // Layout files with no responsive prefixes anywhere — likely desktop-only.
  if (APP_LAYOUT_RE.test(f.path) && !RESPONSIVE_PREFIX_RE.test(f.content)) {
    push({
      rule: 'responsive-no-breakpoints',
      file: f.path,
      evidence: 'no sm:/md:/lg: prefix anywhere',
      message: 'Layout file uses no responsive breakpoints. Add mobile-first responsive variants (sidebar collapses < md, drawer on sm).',
    });
  }
}

// ─── Cross-file scans ──────────────────────────────────────────────

interface ImportGraphEntry {
  /** Importer paths that import this file. */
  importedBy: Set<string>;
  /** Map from imported-symbol name → set of importer paths. */
  symbolImportedBy: Map<string, Set<string>>;
}

function buildImportGraph(files: FileLike[]): Map<string, ImportGraphEntry> {
  const g = new Map<string, ImportGraphEntry>();
  const fileSet = new Set(files.map((f) => f.path));
  for (const f of files) g.set(f.path, { importedBy: new Set(), symbolImportedBy: new Map() });

  for (const f of files) {
    const imports = parseImports(f.content);
    for (const imp of imports) {
      if (!imp.spec.startsWith('.') && !imp.spec.startsWith('@/')) continue;
      const resolved = resolveImport(f.path, imp.spec, fileSet);
      if (!resolved) continue;
      const entry = g.get(resolved);
      if (!entry) continue;
      entry.importedBy.add(f.path);
      for (const name of imp.named) {
        const set = entry.symbolImportedBy.get(name) ?? new Set();
        set.add(f.path);
        entry.symbolImportedBy.set(name, set);
      }
      if (imp.def) {
        const set = entry.symbolImportedBy.get('default') ?? new Set();
        set.add(f.path);
        entry.symbolImportedBy.set('default', set);
      }
    }
  }
  return g;
}

function resolveImport(importer: string, spec: string, files: Set<string>): string | null {
  let target: string;
  if (spec.startsWith('@/')) {
    // Conventional Next.js / app alias — try common roots.
    const stripped = spec.slice(2);
    for (const root of ['apps/web/', 'apps/api/src/', 'src/']) {
      const candidate = root + stripped;
      const r = tryExtensions(candidate, files);
      if (r) return r;
    }
    return null;
  }
  if (spec.startsWith('.')) {
    const dir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
    target = normalizePath(dir + '/' + spec);
    return tryExtensions(target, files);
  }
  return null;
}

function tryExtensions(base: string, files: Set<string>): string | null {
  const exts = ['', '.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '/index.ts', '/index.tsx', '/index.js', '/index.jsx'];
  for (const e of exts) {
    const candidate = base + e;
    if (files.has(candidate)) return candidate;
  }
  return null;
}

function normalizePath(p: string): string {
  const parts = p.split('/');
  const out: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') out.pop();
    else out.push(part);
  }
  return out.join('/');
}

function scanDeadFiles(
  files: FileLike[],
  graph: Map<string, ImportGraphEntry>,
  push: (v: PolishAuditViolation) => void,
): void {
  for (const f of files) {
    if (ENTRY_RE.test(f.path)) continue;
    if (TEST_RE.test(f.path)) continue;
    if (STORY_RE.test(f.path)) continue;
    // Type-declaration files and ambient .d.ts files are loaded implicitly.
    if (/\.d\.ts$/.test(f.path)) continue;
    // Tailwind / postcss / config files are loaded by tooling.
    if (/(^|\/)(tailwind|postcss|next|vite|tsup|tsconfig|drizzle|eslint|jest|vitest)\.config\./.test(f.path)) continue;
    // Prisma schema lives in a non-import path.
    if (/prisma\/schema\.prisma$/.test(f.path)) continue;

    const entry = graph.get(f.path);
    if (!entry) continue;
    if (entry.importedBy.size === 0) {
      push({
        rule: 'dead-file',
        file: f.path,
        evidence: 'no source file imports this',
        message: `Either delete ${f.path} or wire it into the app via an import.`,
      });
    }
  }
}

const EXPORT_RE = /^export\s+(?:default\s+(?:async\s+)?(?:function|class)\s+(\w+)|(?:async\s+)?(?:function|class|const|let|var|interface|type|enum)\s+(\w+))/gm;

function scanUnusedExports(
  files: FileLike[],
  graph: Map<string, ImportGraphEntry>,
  push: (v: PolishAuditViolation) => void,
): void {
  for (const f of files) {
    if (ENTRY_RE.test(f.path)) continue;
    if (/\/components\/ui\//.test(f.path)) continue; // primitives library — stable surface.
    if (/\/lib\//.test(f.path)) continue; // helper modules — stable surface.
    const entry = graph.get(f.path);
    if (!entry) continue;
    if (entry.importedBy.size === 0) continue; // already flagged as dead.

    const exports: Array<{ name: string; line: number }> = [];
    let m: RegExpExecArray | null;
    const re = new RegExp(EXPORT_RE.source, 'gm');
    while ((m = re.exec(f.content)) !== null) {
      const name = m[1] ?? m[2];
      if (!name) continue;
      const line = f.content.slice(0, m.index).split('\n').length;
      exports.push({ name, line });
    }
    if (exports.length === 0) continue;

    // Collect all imported symbols from this file across the graph.
    const importedSymbols = new Set(entry.symbolImportedBy.keys());
    // Heuristic: if the file is imported via a wildcard (* as X), we
    // can't know which symbols are used; treat as "all used".
    if (importedSymbols.has('*')) continue;

    for (const ex of exports) {
      if (importedSymbols.has(ex.name)) continue;
      // Skip default export — many entry-points re-export by default.
      if (ex.name === 'default') continue;
      push({
        rule: 'unused-export',
        file: f.path,
        line: ex.line,
        evidence: ex.name,
        message: `Export '${ex.name}' is never imported. Drop the export keyword (or delete the symbol if also unused locally).`,
      });
    }
  }
}
