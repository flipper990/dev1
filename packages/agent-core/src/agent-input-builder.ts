// ─────────────────────────────────────────────────────────────
// Agent Input Builder — constructs per-agent inputs from session
// state and upstream pipeline artifacts.
//
// 4-agent pipeline:
//   spec    → raw user prompts + saved preferences
//   builder → spec  (+ qaFeedback + existingFiles on iteration ≥ 2)
//   qa      → spec  + builder.files merged with qa.patches/newFiles from prior round
//   polish  → spec  + qa-approved files
// ─────────────────────────────────────────────────────────────

import type { AgentRole, Session } from './types';

// ── Shared types ────────────────────────────────────────────

export interface FileLike { path: string; content: string; language?: string }
export interface PatchLike { file: string; oldContent: string; newContent: string }

// ── Merged-File Helper ──────────────────────────────────────

/**
 * Returns the most-current view of the codebase by merging:
 *   builder.files
 *   ← qa.patches applied where oldContent matches
 *   ← qa.newFiles appended (when path not already present)
 *   ← (when applyPolish=true) polish.patches + polish.newFiles
 */
export function getMergedFiles(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  applyPolish = false,
): FileLike[] {
  const base = (artifacts.get('builder') as { files?: FileLike[] } | undefined)?.files ?? [];
  const fileMap = new Map<string, FileLike>(base.map(f => [f.path, { ...f }]));

  const applyPatches = (patches: PatchLike[]) => {
    for (const p of patches) {
      const file = fileMap.get(p.file);
      if (file && (p.oldContent === '' || file.content === p.oldContent)) {
        file.content = p.newContent;
      }
    }
  };

  const applyNew = (newFiles: FileLike[]) => {
    for (const nf of newFiles) {
      if (nf && typeof nf.path === 'string' && typeof nf.content === 'string' && !fileMap.has(nf.path)) {
        fileMap.set(nf.path, { path: nf.path, content: nf.content, language: nf.language });
      }
    }
  };

  const qa = artifacts.get('qa') as { patches?: PatchLike[]; newFiles?: FileLike[] } | undefined;
  applyPatches(qa?.patches ?? []);
  // Apply normalizer to QA new files too — QA can also drift between layouts.
  applyNew(normalizePolishPaths(qa?.newFiles ?? [], fileMap));

  if (applyPolish) {
    const polish = artifacts.get('polish') as { patches?: PatchLike[]; newFiles?: FileLike[] } | undefined;
    applyPatches(polish?.patches ?? []);
    applyNew(normalizePolishPaths(polish?.newFiles ?? [], fileMap));
  }

  return Array.from(fileMap.values());
}

/**
 * Defense-in-depth: align polish-emitted file paths to whatever layout the
 * builder produced. The polish prompt happens to mention `apps/web/`, but the
 * builder may emit either:
 *
 *   1. Monorepo layout — files under `apps/web/...` and/or `apps/api/...`.
 *   2. Standalone layout — root `package.json`, root `src/app/...` or root
 *      `app/...` (a typical single-app Next.js project).
 *
 * If polish emits the wrong shape we either redirect (root → apps/web) or
 * strip (apps/web → root) so the merged tree is internally consistent. Drops
 * the file entirely if the corrected target already exists in the builder
 * output (builder is authoritative for layout/page roots).
 */
export function normalizePolishPaths(
  newFiles: FileLike[],
  existing: Map<string, FileLike>,
): FileLike[] {
  const keys = Array.from(existing.keys());

  // Strong "this is a standalone Next.js app" signal: a canonical Next.js
  // entry at the repo root (src/app, src/pages, app, or pages). We don't
  // also require a root package.json because the builder is incremental
  // per-slice and may not have emitted package.json yet at this point.
  const hasRootEntry = keys.some((p) =>
    /^(src\/app|src\/pages|app|pages)\/(layout|page)\.[tj]sx?$/.test(p),
  );

  // Monorepo signal: a Next.js entry actually under apps/web/.
  const hasMonorepoEntry = keys.some((p) =>
    /^apps\/web\/(src\/)?(app|pages)\/(layout|page)\.[tj]sx?$/.test(p),
  );

  // Heuristic when `existing` doesn't include entry files (e.g. a rebuild
  // slice emitted only component files): look for any standalone-style
  // path (`src/...`, `app/...`, root `package.json`) and prefer standalone.
  // Most generated apps are standalone, and our prompts target standalone.
  const hasAnyStandaloneSignal = keys.some((p) =>
    /^(src\/|app\/|pages\/|package\.json$|tsconfig\.json$|next\.config\.)/.test(p),
  );
  const hasAnyMonorepoSignal = keys.some((p) => /^apps\/web\//.test(p));

  // Standalone wins if entry exists; else if any standalone signal exists
  // and no monorepo signal; else fall back to "default standalone" so
  // apps/web/ stragglers from qa/polish get stripped instead of leaking.
  const hasStandaloneWeb =
    hasRootEntry ||
    (hasAnyStandaloneSignal && !hasAnyMonorepoSignal) ||
    (!hasMonorepoEntry && !hasAnyMonorepoSignal); // empty/ambiguous → standalone

  // Sub-flavor of standalone: does the canonical entry live under src/ ?
  // (vs app/ or pages/ at the bare root). When src-layout, polish/qa
  // emitting bare `components/`, `lib/`, `hooks/`, `styles/` at the root
  // creates a hybrid (root duplicates of files that should be under src/).
  const hasSrcLayout =
    keys.some((p) => /^src\/(app|pages)\/(layout|page)\.[tj]sx?$/.test(p)) ||
    // Fallback: any src/ path is a strong hint of src-layout standalone.
    (hasStandaloneWeb && keys.some((p) => /^src\//.test(p)));

  // Bare root dirs that belong under src/ in a src-layout standalone app.
  const SRC_LAYOUT_DIRS = ['components/', 'lib/', 'hooks/', 'styles/', 'utils/', 'types/', 'app/', 'pages/'];

  // Only treat as monorepo if a real apps/web/ entry exists AND there is
  // no standalone signal at all. Standalone is the default.
  const isMonorepoWeb = hasMonorepoEntry && !hasRootEntry && !hasAnyStandaloneSignal;

  // Root-level frontend dirs that "belong" under apps/web/ in a monorepo.
  const FRONTEND_ROOTS = ['app/', 'src/', 'components/', 'lib/', 'hooks/', 'pages/', 'public/', 'styles/'];
  // Root-level frontend single config files that "belong" under apps/web/ in a monorepo.
  const FRONTEND_ROOT_FILES = new Set([
    'next.config.ts', 'next.config.js', 'next.config.mjs',
    'postcss.config.js', 'postcss.config.cjs', 'postcss.config.mjs',
    'tailwind.config.ts', 'tailwind.config.js',
  ]);

  const out: FileLike[] = [];
  const seen = new Set<string>();
  for (const f of newFiles) {
    if (!f || typeof f.path !== 'string') continue;
    let target = f.path.replace(/^\.\//, '').replace(/\\/g, '/');

    if (isMonorepoWeb) {
      // Monorepo wins. Redirect any root-level frontend file to apps/web/.
      const hitsDir = FRONTEND_ROOTS.some((d) => target.startsWith(d));
      const hitsFile = FRONTEND_ROOT_FILES.has(target);
      if (hitsDir || hitsFile) target = `apps/web/${target}`;
    } else if (hasStandaloneWeb && target.startsWith('apps/web/')) {
      // Standalone wins. Strip apps/web/ prefix from new files.
      target = target.slice('apps/web/'.length);
    }

    // Standalone with src-layout: rewrite bare `components/foo.tsx` etc.
    // to `src/components/foo.tsx` so it doesn't collide with the canonical
    // src-layout copy. Runs AFTER apps/web/ stripping above.
    if (hasStandaloneWeb && hasSrcLayout && !target.startsWith('src/')) {
      if (SRC_LAYOUT_DIRS.some((d) => target.startsWith(d))) {
        target = `src/${target}`;
      }
    }

    if (target.length === 0) continue;
    // Drop duplicates — builder's version is authoritative for layout/page roots.
    if (target !== f.path && existing.has(target)) continue;
    // Dedupe within polish-newFiles itself (prefer first occurrence).
    if (seen.has(target)) continue;
    seen.add(target);

    out.push({ ...f, path: target });
  }
  return out;
}

// ── Optional-Skip Logic ─────────────────────────────────────

/**
 * Returns a skip reason string if the step should be bypassed,
 * or null if it should execute normally.
 */
export function shouldSkipStep(
  role: AgentRole,
  artifacts: Map<AgentRole, Record<string, unknown>>,
): string | null {
  if (role === 'qa' || role === 'polish') {
    const files = (artifacts.get('builder') as { files?: unknown[] } | undefined)?.files ?? [];
    if (!Array.isArray(files) || files.length === 0) {
      return `No builder files available; skipping ${role}`;
    }
  }
  return null;
}

// ── Input Builder ───────────────────────────────────────────

/**
 * Constructs the input object for a given agent role from the
 * current session and all upstream artifact outputs.
 */
export function buildAgentInput(
  session: Session,
  role: AgentRole,
  artifacts: Map<AgentRole, Record<string, unknown>>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};
  const spec = artifacts.get('spec') ?? {};

  switch (role) {
    case 'spec':
      input.prompts = session.prompts;
      input.userPreferences = session.artifacts.get('userPreferences') ?? {};
      input.globalMemoryHints = session.artifacts.get('globalMemoryHints') ?? [];
      break;

    case 'builder': {
      input.spec = spec;
      // QA feedback loop: if a previous QA round flagged issues, the orchestrator stashes
      // the qa report + the merged file set under session.artifacts before re-running.
      const qaFeedback = session.artifacts.get('qaFeedback') as Record<string, unknown> | undefined;
      const existingFiles = session.artifacts.get('previousFiles') as FileLike[] | undefined;
      const iteration = (session.artifacts.get('builderIteration') as number | undefined) ?? 1;

      if (qaFeedback) input.qaFeedback = qaFeedback;
      if (existingFiles && existingFiles.length > 0) input.existingFiles = existingFiles;
      input.iteration = iteration;

      // Feature-slice context: when the project-generator is iterating through
      // featureSlices, currentSlice / sliceIndex / totalSlices tell BUILDER to
      // implement only the active slice and preserve all other existingFiles.
      const currentSlice = session.artifacts.get('currentSlice');
      const sliceIndex = session.artifacts.get('sliceIndex');
      const totalSlices = session.artifacts.get('totalSlices');
      if (currentSlice) input.currentSlice = currentSlice;
      if (typeof sliceIndex === 'number') input.sliceIndex = sliceIndex;
      if (typeof totalSlices === 'number') input.totalSlices = totalSlices;
      break;
    }

    case 'qa':
      input.spec = spec;
      {
        const builderFiles = (artifacts.get('builder') as { files?: FileLike[] } | undefined)?.files ?? [];
        const previousFiles = session.artifacts.get('previousFiles') as FileLike[] | undefined;
        // Slice mode: when iterating slices, BUILDER emits incremental files
        // for the active slice; QA must review the cumulative codebase
        // (previous slices + this slice) so it can detect regressions.
        if (Array.isArray(previousFiles) && previousFiles.length > 0) {
          const merged = new Map<string, FileLike>();
          for (const f of previousFiles) merged.set(f.path, f);
          for (const f of builderFiles) merged.set(f.path, f);
          input.files = Array.from(merged.values());
        } else {
          input.files = builderFiles;
        }
        const runtimeFeedback = session.artifacts.get('runtimeFeedback') as Record<string, unknown> | undefined;
        if (runtimeFeedback) input.runtimeFeedback = runtimeFeedback;
        const currentSlice = session.artifacts.get('currentSlice');
        const sliceIndex = session.artifacts.get('sliceIndex');
        const totalSlices = session.artifacts.get('totalSlices');
        if (currentSlice) input.currentSlice = currentSlice;
        if (typeof sliceIndex === 'number') input.sliceIndex = sliceIndex;
        if (typeof totalSlices === 'number') input.totalSlices = totalSlices;
      }
      break;

    case 'polish': {
      input.spec = spec;
      // Polish receives the cumulative QA-merged codebase. In slice mode,
      // overlay onto previousFiles so polish sees ALL slices, not just the
      // one BUILDER emitted incrementally this pass.
      const merged = getMergedFiles(artifacts, /* applyPolish */ false);
      const previousFiles = session.artifacts.get('previousFiles') as FileLike[] | undefined;
      let polishFiles: FileLike[];
      if (Array.isArray(previousFiles) && previousFiles.length > 0) {
        const overlay = new Map<string, FileLike>();
        for (const f of previousFiles) overlay.set(f.path, f);
        for (const f of merged) overlay.set(f.path, f);
        polishFiles = Array.from(overlay.values());
      } else {
        polishFiles = merged;
      }
      input.files = polishFiles;
      // Pre-scan for concrete design-system violations so polish gets a
      // targeted fix list (not just "go improve UI"). This surfaces the
      // exact files + line shapes that need refactoring.
      input.designAudit = scanDesignViolations(polishFiles);
      break;
    }
  }

  return input;
}

interface DesignAudit {
  rawHtmlButtons: Array<{ file: string; count: number }>;
  rawHtmlInputs:  Array<{ file: string; count: number }>;
  inlineHexColors: Array<{ file: string; count: number; samples: string[] }>;
  defaultTailwindBlue: Array<{ file: string; count: number }>;
  inlineStyles: Array<{ file: string; count: number }>;
  magicSpacing: Array<{ file: string; count: number; samples: string[] }>;
  useEffectFetches: Array<{ file: string; count: number }>;
  missingPrimitives: string[];
  missingAppShell: boolean;
  missingDesignTokens: boolean;
  missingTailwindConfig: boolean;
  totalViolations: number;
}

function scanDesignViolations(files: FileLike[]): DesignAudit {
  const out: DesignAudit = {
    rawHtmlButtons: [], rawHtmlInputs: [], inlineHexColors: [],
    defaultTailwindBlue: [], inlineStyles: [], magicSpacing: [],
    useEffectFetches: [],
    missingPrimitives: [], missingAppShell: false,
    missingDesignTokens: false, missingTailwindConfig: false,
    totalViolations: 0,
  };
  const required = ['Button', 'Input', 'Card', 'Dialog', 'Toast', 'Badge'];
  const have = new Set<string>();
  let hasShell = false;
  let hasTokens = false;
  let hasTailwindCfg = false;

  for (const f of files) {
    const path = f.path;
    const content = f.content;
    const isView = /\.(tsx|jsx)$/.test(path);
    const isWebFile = /(^|\/)apps\/web\//.test(path) || /(^|\/)web\//.test(path) || /(^|\/)src\//.test(path);
    if (!isWebFile) continue;

    // Track presence of the design system itself.
    if (/components\/(ui|primitives)\/(Button|Input|Card|Dialog|Toast|Badge|Avatar|Tabs|Tooltip|Skeleton)/.test(path)) {
      const m = path.match(/(Button|Input|Card|Dialog|Toast|Badge|Avatar|Tabs|Tooltip|Skeleton)/);
      if (m) have.add(m[1]);
    }
    if (/components\/layout\/(AppShell|Sidebar|Topbar)/.test(path)) hasShell = true;
    if (/lib\/design-tokens\.(ts|tsx|js)$/.test(path) || /\/tokens\.(ts|js)$/.test(path)) hasTokens = true;
    if (/tailwind\.config\.(ts|js|cjs|mjs)$/.test(path)) {
      hasTailwindCfg = true;
      if (!/extend\s*:\s*\{[\s\S]*colors[\s\S]*\}/m.test(content)) {
        // Tailwind config exists but doesn't extend colors — flag as missing token wiring.
        hasTokens = hasTokens && false;
      }
    }

    if (!isView) {
      // Still count useEffect fetches in hooks / non-jsx ts files.
      const efm = (content.match(/useEffect\s*\([\s\S]{0,500}?fetch\s*\(/g) ?? []).length;
      if (efm > 0) out.useEffectFetches.push({ file: path, count: efm });
      continue;
    }

    // Skip the primitives library files themselves; they're allowed to use
    // raw <button>/<input> as their internal implementation.
    const isPrimitive = /components\/(ui|primitives)\//.test(path);

    if (!isPrimitive) {
      const btn = (content.match(/<button[\s>]/g) ?? []).length;
      if (btn > 0) out.rawHtmlButtons.push({ file: path, count: btn });
      const inp = (content.match(/<input[\s>]/g) ?? []).length;
      if (inp > 0) out.rawHtmlInputs.push({ file: path, count: inp });
    }

    const hexMatches = [...content.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]).filter((h) => !/^#[fF]{3,8}$/.test(h) && !/^#0{3,8}$/.test(h));
    if (hexMatches.length > 0) {
      out.inlineHexColors.push({ file: path, count: hexMatches.length, samples: hexMatches.slice(0, 5) });
    }
    const blueMatches = (content.match(/\b(?:bg|text|border|ring)-(?:blue|indigo|sky|cyan)-\d{2,3}\b/g) ?? []).length;
    if (blueMatches > 0) out.defaultTailwindBlue.push({ file: path, count: blueMatches });

    const inlineStyle = (content.match(/style\s*=\s*\{\{/g) ?? []).length;
    if (inlineStyle > 0) out.inlineStyles.push({ file: path, count: inlineStyle });

    const magic = [...content.matchAll(/\b(?:p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|gap|space-[xy])-(\d+)\b/g)]
      .map((m) => ({ raw: m[0], n: Number(m[1]) }))
      .filter(({ n }) => ![0,1,2,3,4,5,6,8,10,12,14,16,20,24,32,40,48,56,64,72,80,96].includes(n))
      .map((x) => x.raw);
    if (magic.length > 0) out.magicSpacing.push({ file: path, count: magic.length, samples: Array.from(new Set(magic)).slice(0, 5) });

    const efm = (content.match(/useEffect\s*\([\s\S]{0,500}?fetch\s*\(/g) ?? []).length;
    if (efm > 0) out.useEffectFetches.push({ file: path, count: efm });
  }

  out.missingPrimitives = required.filter((r) => !have.has(r));
  out.missingAppShell = !hasShell;
  out.missingDesignTokens = !hasTokens;
  out.missingTailwindConfig = !hasTailwindCfg;

  out.totalViolations =
    sumCount(out.rawHtmlButtons) + sumCount(out.rawHtmlInputs) +
    sumCount(out.inlineHexColors) + sumCount(out.defaultTailwindBlue) +
    sumCount(out.inlineStyles) + sumCount(out.magicSpacing) +
    sumCount(out.useEffectFetches) +
    out.missingPrimitives.length +
    (out.missingAppShell ? 1 : 0) +
    (out.missingDesignTokens ? 1 : 0) +
    (out.missingTailwindConfig ? 1 : 0);

  return out;
}

function sumCount(rows: Array<{ count: number }>): number {
  return rows.reduce((acc, r) => acc + r.count, 0);
}
