// ─────────────────────────────────────────────────────────────────────────────
// QA Static Checks — deterministic preflight that runs BEFORE the LLM.
//
// The LLM-driven QA agent is good at semantic review but inconsistent at
// catching mechanical regressions ("did you render an <img> with no src?",
// "does any page wire a sidebar?", "is every <button> interactive?"). This
// module scans the assembled file map with regex / AST-lite checks and
// produces a list of CRITICAL issues. Those issues are:
//   1. Surfaced to the LLM as forced criticals in the prompt.
//   2. Used post-LLM to OVERRIDE the verdict to 'needs-improvement' if any
//      remain unaddressed in the patches/newFiles output.
//
// Categories mirror the user's brief:
//   • UI structure   — sidebar/nav presence, layout consistency.
//   • Assets         — broken/missing images.
//   • Functionality  — non-interactive buttons, unsubmittable forms.
//   • Runtime risk   — undefined identifiers, throw-on-mount patterns.
//
// All checks return a stable id so post-pass deduplication works across
// QA→Builder iterations.
// ─────────────────────────────────────────────────────────────────────────────

export type StaticIssueSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface StaticIssue {
  id: string;
  severity: StaticIssueSeverity;
  category:
    | 'ui-structure'
    | 'broken-asset'
    | 'unwired-interaction'
    | 'unsubmittable-form'
    | 'placeholder-content'
    | 'unstructured-layout'
    | 'runtime-risk';
  file: string;
  line: number | null;
  description: string;
  suggestedFix: string;
}

interface ProjectFile {
  path: string;
  content: string;
  language?: string;
}

const TSX_EXT = /\.(tsx|jsx)$/i;
const PAGE_HINT = /(^|\/)(src\/)?(app|pages)\/.+\.(tsx|jsx)$/i;
const LAYOUT_HINT = /(^|\/)(src\/)?(app|pages)\/(layout|_app)\.(tsx|jsx)$/i;

function lineOf(content: string, index: number): number {
  if (index < 0) return 1;
  let n = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content[i] === '\n') n++;
  }
  return n;
}

// ── 1. UI structure checks ──────────────────────────────────────────────────
//
// The pipeline injects an <AppShell> primitive that provides sidebar + topbar
// + content. For multi-page apps, at least ONE page or layout must use it
// (or roll its own equivalent). A repo with N pages and zero sidebars is
// almost certainly an unstructured wall-of-divs build.
function checkUiStructure(files: ProjectFile[]): StaticIssue[] {
  const issues: StaticIssue[] = [];
  const tsxFiles = files.filter((f) => TSX_EXT.test(f.path));
  const pageFiles = tsxFiles.filter((f) => PAGE_HINT.test(f.path) && !LAYOUT_HINT.test(f.path));

  // Skip the check for trivial single-page builds.
  if (pageFiles.length < 2) return issues;

  const hasShell = tsxFiles.some(
    (f) =>
      /<AppShell\b/.test(f.content) ||
      /<\s*aside\b[\s\S]{0,400}<\s*main\b/i.test(f.content) ||
      /<\s*nav\b[\s\S]{0,400}<\s*main\b/i.test(f.content),
  );
  if (!hasShell) {
    issues.push({
      id: 'qa.static.no-shell',
      severity: 'critical',
      category: 'ui-structure',
      file: '',
      line: null,
      description: `Project has ${pageFiles.length} pages but no page/layout uses <AppShell>, <aside>+<main>, or <nav>+<main>. Result is unstructured wall-of-divs UI.`,
      suggestedFix:
        "Wrap the root layout (src/app/layout.tsx) or each page in <AppShell> from '@/components/ui/AppShell' with a sidebar nav listing every primary route.",
    });
  }

  // Layout file should exist for app-router projects.
  const hasLayout = tsxFiles.some((f) => LAYOUT_HINT.test(f.path));
  const hasAppRouter = tsxFiles.some((f) => /(^|\/)(src\/)?app\/.*\.(tsx|jsx)$/i.test(f.path));
  if (hasAppRouter && !hasLayout) {
    issues.push({
      id: 'qa.static.no-root-layout',
      severity: 'critical',
      category: 'unstructured-layout',
      file: '',
      line: null,
      description:
        'Next.js app-router project has page files but no root layout (src/app/layout.tsx). The app cannot mount.',
      suggestedFix:
        "Add src/app/layout.tsx that imports './globals.css' and renders <html><body>{children}</body></html>.",
    });
  }

  return issues;
}

// ── 2. Broken / missing image assets ────────────────────────────────────────
//
// Common LLM failure modes:
//   <img src="/images/hero.jpg"> — file never generated → broken icon.
//   <img src=""> / <img>          — invalid markup, layout collapses.
//   <Image src="/foo.png" />      — Next/Image, same problem.
//
// We require <img>/<Image> to either:
//   (a) have a non-empty src that is an http(s) URL, OR
//   (b) reference a path that exists in the file map (public/*, assets/*), OR
//   (c) come from a known placeholder service (picsum.photos, placehold.co,
//       images.unsplash.com, ui-avatars.com, dicebear.com).
//
// Anything else gets flagged with a concrete fix: "swap to
// https://picsum.photos/seed/<slug>/<w>/<h>".
const PLACEHOLDER_HOSTS = [
  'picsum.photos',
  'fastly.picsum.photos',
  'placehold.co',
  'placehold.it',
  'placeholder.com',
  'images.unsplash.com',
  'ui-avatars.com',
  'api.dicebear.com',
  'i.pravatar.cc',
  'avatars.githubusercontent.com',
];

const IMG_TAG_RE = /<(?:img|Image)\b([^>]*)\/?>/gi;
const SRC_ATTR_RE = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|\{`([^`]*)`\}|\{['"]([^'"]*)['"]\})/i;

function isHttp(s: string): boolean {
  return /^https?:\/\//i.test(s);
}
function isPlaceholderHost(s: string): boolean {
  if (!isHttp(s)) return false;
  try {
    const u = new URL(s);
    return PLACEHOLDER_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith('.' + h));
  } catch {
    return false;
  }
}
function publicAssetExists(src: string, files: ProjectFile[]): boolean {
  // Strip query/hash and leading slash, then look for any file path that
  // ends with the asset path (covers public/foo.png + apps/web/public/foo.png).
  const clean = src.split(/[?#]/)[0].replace(/^\//, '');
  if (!clean) return false;
  return files.some((f) => f.path.endsWith('/' + clean) || f.path.endsWith(clean));
}

function checkAssets(files: ProjectFile[]): StaticIssue[] {
  const issues: StaticIssue[] = [];
  for (const file of files) {
    if (!TSX_EXT.test(file.path)) continue;
    let m: RegExpExecArray | null;
    IMG_TAG_RE.lastIndex = 0;
    while ((m = IMG_TAG_RE.exec(file.content)) !== null) {
      const attrs = m[1] ?? '';
      const srcMatch = SRC_ATTR_RE.exec(attrs);
      const src = srcMatch ? srcMatch[1] ?? srcMatch[2] ?? srcMatch[3] ?? srcMatch[4] ?? '' : '';
      const line = lineOf(file.content, m.index);

      // Dynamic / prop-driven src — skip (we can't reason statically).
      const isDynamic = /\bsrc\s*=\s*\{[^}]*[\w.[\]?]/.test(attrs) && !srcMatch;
      if (isDynamic) continue;

      if (!srcMatch || !src) {
        issues.push({
          id: `qa.static.img-no-src@${file.path}#${line}`,
          severity: 'critical',
          category: 'broken-asset',
          file: file.path,
          line,
          description: '<img>/<Image> has no src attribute — renders as broken icon.',
          suggestedFix:
            'Set src to a placeholder URL like https://picsum.photos/seed/<slug>/800/600 or remove the element.',
        });
        continue;
      }
      if (isHttp(src)) {
        // Real http URL — only flag if it's an obviously fictional domain.
        if (/\bexample\.(com|org|net)\b/i.test(src) || /\byour-(domain|site|cdn)\b/i.test(src)) {
          issues.push({
            id: `qa.static.img-fictional@${file.path}#${line}`,
            severity: 'high',
            category: 'broken-asset',
            file: file.path,
            line,
            description: `<img> uses fictional domain (${src}). Will not load.`,
            suggestedFix: `Replace src with https://picsum.photos/seed/${slug(file.path, String(line))}/800/600.`,
          });
        }
        continue;
      }
      // Local path — must resolve in the file map.
      if (!publicAssetExists(src, files)) {
        issues.push({
          id: `qa.static.img-missing@${file.path}#${line}`,
          severity: 'critical',
          category: 'broken-asset',
          file: file.path,
          line,
          description: `<img> references local asset "${src}" that is not present in the build (no matching file in public/).`,
          suggestedFix: `Replace src with https://picsum.photos/seed/${slug(src)}/800/600 or generate the asset under public/.`,
        });
      }
    }
  }
  return issues;
}

function slug(...parts: string[]): string {
  return parts
    .join('-')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32) || 'placeholder';
}

// ── 3. Functionality checks — buttons, forms, links ─────────────────────────
//
// A <button> with no onClick / type="submit" / form / asChild link wrapper
// is dead UI. Same for a <form> with no onSubmit + no action. Both are
// extremely common LLM regressions ("forgot to wire the handler").
function checkFunctionality(files: ProjectFile[]): StaticIssue[] {
  const issues: StaticIssue[] = [];
  for (const file of files) {
    if (!TSX_EXT.test(file.path)) continue;

    // ── <button> interactivity ────────────────────────────────────────────
    // Match opening <button …> tags (lowercase only — <Button> is the
    // primitive whose interactivity comes from props, not direct attrs).
    const btnRe = /<button\b([^>]*)>/gi;
    let m: RegExpExecArray | null;
    while ((m = btnRe.exec(file.content)) !== null) {
      const attrs = m[1] ?? '';
      const hasOnClick = /\bonClick\s*=/.test(attrs);
      const hasSubmit = /\btype\s*=\s*["']submit["']/i.test(attrs);
      const hasFormAttr = /\bform\s*=/.test(attrs);
      const isDisabled = /\bdisabled\b/.test(attrs);
      if (hasOnClick || hasSubmit || hasFormAttr || isDisabled) continue;
      const line = lineOf(file.content, m.index);
      issues.push({
        id: `qa.static.dead-button@${file.path}#${line}`,
        severity: 'high',
        category: 'unwired-interaction',
        file: file.path,
        line,
        description: '<button> has no onClick, type="submit", or form binding — clicking does nothing.',
        suggestedFix:
          'Add onClick={...} that calls the relevant action, or set type="submit" inside a <form>.',
      });
    }

    // ── <form> usability ──────────────────────────────────────────────────
    const formRe = /<form\b([^>]*)>/gi;
    while ((m = formRe.exec(file.content)) !== null) {
      const attrs = m[1] ?? '';
      const hasSubmit = /\bonSubmit\s*=/.test(attrs);
      const hasAction = /\baction\s*=/.test(attrs);
      if (hasSubmit || hasAction) continue;
      const line = lineOf(file.content, m.index);
      issues.push({
        id: `qa.static.unsubmittable-form@${file.path}#${line}`,
        severity: 'critical',
        category: 'unsubmittable-form',
        file: file.path,
        line,
        description: '<form> has no onSubmit handler and no action attribute — pressing submit does nothing.',
        suggestedFix:
          'Add onSubmit={async (e) => { e.preventDefault(); await api.<endpoint>(formData); }}.',
      });
    }
  }
  return issues;
}

// ── 4. Placeholder / stub content ───────────────────────────────────────────
//
// "Lorem ipsum", "TODO", "Coming soon", "Placeholder text here" inside
// rendered JSX text mean the page is not really built.
function checkPlaceholderContent(files: ProjectFile[]): StaticIssue[] {
  const issues: StaticIssue[] = [];
  const re = /\b(lorem ipsum|coming soon|todo:|fixme:|placeholder text|under construction|implement (this|me))\b/i;
  for (const file of files) {
    if (!TSX_EXT.test(file.path)) continue;
    const m = re.exec(file.content);
    if (!m) continue;
    const line = lineOf(file.content, m.index);
    issues.push({
      id: `qa.static.placeholder@${file.path}#${line}`,
      severity: 'high',
      category: 'placeholder-content',
      file: file.path,
      line,
      description: `File contains placeholder content ("${m[0]}") instead of real implementation.`,
      suggestedFix:
        'Replace with the real copy / data / component for this page per spec.frontendPages and userFlows.',
    });
  }
  return issues;
}

// ── 5. Runtime-risk patterns ────────────────────────────────────────────────
//
// `throw new Error('not implemented')` on a render path will crash the page.
// `process.exit(...)` in app code likewise.
function checkRuntimeRisks(files: ProjectFile[]): StaticIssue[] {
  const issues: StaticIssue[] = [];
  for (const file of files) {
    if (!TSX_EXT.test(file.path) && !/\.(ts|js)$/i.test(file.path)) continue;
    const re = /throw\s+new\s+Error\s*\(\s*['"`](not implemented|unimplemented|todo)/i;
    const m = re.exec(file.content);
    if (!m) continue;
    const line = lineOf(file.content, m.index);
    issues.push({
      id: `qa.static.unimplemented-throw@${file.path}#${line}`,
      severity: 'critical',
      category: 'runtime-risk',
      file: file.path,
      line,
      description: `Code throws "${m[1]}" — guarantees a runtime crash on the affected path.`,
      suggestedFix: 'Implement the function body fully.',
    });
  }
  return issues;
}

/**
 * Run every static check against the assembled file set. Returns a
 * deduplicated list of issues sorted critical → low.
 */
export function runQaStaticChecks(files: ProjectFile[]): StaticIssue[] {
  const all = [
    ...checkUiStructure(files),
    ...checkAssets(files),
    ...checkFunctionality(files),
    ...checkPlaceholderContent(files),
    ...checkRuntimeRisks(files),
  ];
  // Dedupe by id (later wins, but ids include file+line so dupes are rare).
  const byId = new Map<string, StaticIssue>();
  for (const i of all) byId.set(i.id, i);
  const order: Record<StaticIssueSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return Array.from(byId.values()).sort((a, b) => order[a.severity] - order[b.severity]);
}

/**
 * Format static issues as a markdown block for inclusion in the QA prompt.
 */
export function formatStaticIssuesForPrompt(issues: StaticIssue[]): string {
  if (issues.length === 0) return '';
  const lines: string[] = [];
  lines.push(`## ⛔ STATIC QA FINDINGS (${issues.length} — treat each at the listed severity)`);
  lines.push('');
  lines.push('These are deterministic findings from a mechanical scan of the file map.');
  lines.push('They are NOT predictions. Each one MUST appear in your issues[] output and');
  lines.push('be addressed via patches[] / newFiles[] before the verdict can be "pass".');
  lines.push('');
  for (const i of issues.slice(0, 60)) {
    const loc = i.file ? `${i.file}${i.line ? `:${i.line}` : ''}` : '(codebase-wide)';
    lines.push(`- **${i.severity.toUpperCase()}** [${i.category}] ${loc}`);
    lines.push(`    - ${i.description}`);
    lines.push(`    - FIX: ${i.suggestedFix}`);
  }
  if (issues.length > 60) lines.push(`- … and ${issues.length - 60} more (same patterns).`);
  lines.push('');
  return lines.join('\n');
}
