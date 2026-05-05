// Project Assembler — merges agent artifacts into the final file set.
//
// Order of operations (4-agent pipeline):
//   1. builder.files          ← starting point
//   2. qa.newFiles            ← additions (missing components, etc.)
//   3. qa.patches             ← in-place fixes
//   4. polish.newFiles        ← prod artifacts (Dockerfile, README, …)
//   5. polish.patches         ← UI/perf patches
//   6. ensureDeploymentReadiness  ← baseline Dockerfile/.env if missing
//   7. injectUIFoundation     ← cn.ts, Button, tailwind.config.ts if missing

import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { PipelineState } from '../../../../packages/agent-core/src/orchestrator.js';
import type { TaskSummary } from '../storage/project-store.js';
import type { ProjectFile, Patch, StepSummary } from './generator-types.js';
import { ensureDeploymentReadiness } from './deployment-templates.js';
import { ensureRunnableScaffold } from './runnable-scaffold.js';
import { injectUIFoundation, sanitizeUIFoundation, enforceDesignSystem, enforceImageAssets, ensureNextImageRemotePatterns } from './ui-foundation.js';
import { normalizePolishPaths } from '../../../../packages/agent-core/src/agent-input-builder.js';

export function assembleProject(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  logger: Logger,
): ProjectFile[] {
  const fileMap = new Map<string, ProjectFile>();

  // 1. Builder output is the starting point.
  const builderOut = artifacts.get('builder') as { files?: ProjectFile[] } | undefined;
  for (const file of builderOut?.files ?? []) fileMap.set(file.path, { ...file });

  // 2-3. QA additions and patches. Normalize newFiles to match the builder's
  // chosen layout (standalone vs monorepo) — QA can drift between styles.
  const qaOut = artifacts.get('qa') as { patches?: Patch[]; newFiles?: ProjectFile[] } | undefined;
  const qaNew = normalizePolishPaths(qaOut?.newFiles ?? [], fileMap) as ProjectFile[];
  for (const file of qaNew) {
    if (!fileMap.has(file.path)) fileMap.set(file.path, { ...file });
  }
  if (qaOut?.patches) applyPatches(fileMap, qaOut.patches, 'qa', logger);

  // 4-5. Polish additions and patches. Same normalization — polish often
  // emits apps/web/* even when builder used standalone, producing duplicates.
  const polishOut = artifacts.get('polish') as { patches?: Patch[]; newFiles?: ProjectFile[] } | undefined;
  const polishNew = normalizePolishPaths(polishOut?.newFiles ?? [], fileMap) as ProjectFile[];
  for (const file of polishNew) {
    if (!fileMap.has(file.path)) fileMap.set(file.path, { ...file });
  }
  if (polishOut?.patches) applyPatches(fileMap, polishOut.patches, 'polish', logger);

  // 5b. Consolidate hybrid layouts BEFORE the scaffolders run so the page
  // synthesizer can find real feature components in the unified tree. The
  // builder sometimes mixes standalone (root package.json + src/) with
  // monorepo (apps/web/*) paths, leaving feature components unreachable
  // from the @/ alias.
  consolidateLayout(fileMap, logger);

  // 6-7. Baseline deployment + UI foundation guarantees.
  ensureRunnableScaffold(fileMap);
  ensureDeploymentReadiness(fileMap, artifacts);

  // 7b. Second consolidation pass — the scaffolders may add new apps/web/*
  // files (rare) or the first pass may have skipped early because there was
  // no root package.json yet. Idempotent.
  consolidateLayout(fileMap, logger);

  injectUIFoundation(fileMap, artifacts);
  // 8. Repair broken EXISTING tailwind.config / globals.css / design-tokens
  //    files emitted by qa/polish (injectUIFoundation only fills gaps).
  sanitizeUIFoundation(fileMap);
  // 9. Rewrite invented className tokens (bg-cardBackground, text-textPrimary,
  //    etc.) to canonical semantic equivalents so the rendered UI matches the
  //    injected theme regardless of LLM drift.
  const dsResult = enforceDesignSystem(
    fileMap as unknown as Map<string, { path: string; content: string; language?: string }>,
  );
  if (dsResult.totalReplacements > 0) {
    logger.info(
      `enforceDesignSystem: rewrote ${dsResult.totalReplacements} invented className tokens across ${dsResult.filesChanged} file(s)`,
    );
  }

  // 10. Image enforcement — guarantee no broken image icons. Rewrites every
  //     <img>/<Image> with a missing/empty/fictional/unresolved-local src to
  //     a deterministic picsum.photos / pravatar URL.
  const imgResult = enforceImageAssets(fileMap);
  if (imgResult.rewrites > 0) {
    logger.info(
      `enforceImageAssets: rewrote ${imgResult.rewrites} broken image src(s) across ${imgResult.filesChanged} file(s)`,
    );
  }
  // 11. Whitelist placeholder hosts in next.config so Next/Image renders them.
  const nextImgResult = ensureNextImageRemotePatterns(fileMap);
  if (nextImgResult.changed) {
    logger.info('ensureNextImageRemotePatterns: updated next.config images.remotePatterns');
  }

  // 12. Final sanity: drop any code file whose content is empty/whitespace.
  // The QA "preview-renders" gate fails the whole project on a single 0-byte
  // .tsx file, and an empty file is never useful anyway. Removing it lets
  // injectUIFoundation re-create core primitives on a future pass, and stops
  // import-from-empty crashes at runtime.
  const dropped: string[] = [];
  for (const [path, file] of Array.from(fileMap.entries())) {
    if (!isCodeFilePath(path)) continue;
    if (file.content && file.content.trim()) continue;
    fileMap.delete(path);
    dropped.push(path);
  }
  if (dropped.length > 0) {
    logger.warn(
      `Assembler dropped ${dropped.length} empty code file(s): ${dropped.slice(0, 5).join(', ')}${dropped.length > 5 ? '…' : ''}`,
    );
    // Re-run the UI foundation injector so the standard primitives we just
    // dropped (Button/Card/etc.) get repopulated with working code.
    injectUIFoundation(fileMap, artifacts);
  }

  return Array.from(fileMap.values());
}

export function applyPatches(
  fileMap: Map<string, ProjectFile>,
  patches: Patch[],
  source: string,
  logger: Logger,
): void {
  for (const patch of patches) {
    const file = fileMap.get(patch.file);
    if (!file) {
      logger.warn(`${source} patch target not found: ${patch.file}`);
      continue;
    }
    if (typeof patch.newContent !== 'string') continue;

    // Reject patches that wipe a file to empty/whitespace. The builder
    // sometimes emits a patch with `newContent: ""` (especially for UI
    // primitives during a slice rebuild), which leaves a 0-byte component
    // and breaks the build. Keep the previous content instead.
    if (isCodeFilePath(patch.file) && !patch.newContent.trim()) {
      logger.warn(
        `${source} patch REJECTED for ${patch.file}: empty replacement content`,
      );
      continue;
    }

    const before = file.content;
    let after: string;

    // Allow whole-file replacement when oldContent is empty.
    if (!patch.oldContent) {
      after = patch.newContent;
    } else if (before.includes(patch.oldContent)) {
      after = before.replace(patch.oldContent, patch.newContent);
    } else {
      logger.warn(`${source} patch content mismatch in ${patch.file}`);
      continue;
    }

    // Reject patches that introduce syntactic damage. The QA/polish agents
    // sometimes emit patches whose oldContent matches an opener but whose
    // newContent forgets the original closer, leaving an orphan tail in the
    // file and a permanently broken build. We refuse such patches and keep
    // the previous (working) content.
    if (isCodeFilePath(patch.file)) {
      const beforeOk = isBracketBalanced(before);
      const afterOk = isBracketBalanced(after);
      if (beforeOk && !afterOk) {
        logger.warn(
          `${source} patch REJECTED for ${patch.file}: would unbalance brackets — keeping previous content`,
        );
        continue;
      }
    }

    file.content = after;
  }
}

const CODE_EXT_RE = /\.(tsx|jsx|ts|js|mjs|cjs)$/i;
function isCodeFilePath(p: string): boolean {
  return CODE_EXT_RE.test(p);
}

/**
 * Cheap balance check matching `quality-assurance.ts.checkSyntaxBalance`.
 * Returns true when (), {}, [] balance out and no string/comment is left
 * unterminated. Skips JSX tag pairing — that's checked elsewhere.
 */
function isBracketBalanced(src: string): boolean {
  if (!src.trim()) return true;
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
  return paren === 0 && brace === 0 && bracket === 0 && !inString && !inBlockComment;
}

export function buildTaskSummaries(state: PipelineState): TaskSummary[] {
  return state.tasks.map(t => ({
    id: t.id,
    agentRole: t.agentRole,
    status: t.status,
    durationMs: t.metadata?.latencyMs ?? 0,
    tokensUsed: (t.metadata?.tokensIn ?? 0) + (t.metadata?.tokensOut ?? 0),
    costUsd: t.metadata?.costUsd ?? 0,
    error: t.error?.message,
  }));
}

export function buildStepSummaries(state: PipelineState): StepSummary[] {
  return state.steps.map(s => ({
    stepId: s.stepId,
    name: s.stepId,
    agent: s.agent,
    status: s.status,
    durationMs: s.durationMs,
    error: s.error,
  }));
}

/**
 * Consolidate a hybrid layout into a single coherent shape.
 *
 * Builder slicing sometimes leaves files split between standalone
 * (`src/components/...`, root `package.json`) and monorepo (`apps/web/...`)
 * conventions. The root `tsconfig.json`'s `@/*` alias resolves to one of the
 * two, leaving feature components in the other tree unreachable.
 *
 * Strategy: detect a "single-app" project (root package.json with `next` dep
 * AND no `apps/web/package.json`). When detected, strip the `apps/web/`
 * prefix from every file, merging into root paths. On collision, keep the
 * version with longer non-empty content (heuristic for "the real one").
 * Optionally re-anchor under `src/` if the project uses the src-layout.
 */
function consolidateLayout(fileMap: Map<string, ProjectFile>, logger: Logger): void {
  const has = (p: string): boolean => fileMap.has(p);

  // Probe root package.json. If it parses and declares workspaces, this is
  // a genuine monorepo — leave the layout alone.
  const rootPkgRaw = fileMap.get('package.json')?.content;
  let rootHasWorkspaces = false;
  if (rootPkgRaw) {
    try {
      const rootPkg = JSON.parse(rootPkgRaw) as { workspaces?: unknown };
      rootHasWorkspaces = !!rootPkg.workspaces;
    } catch {
      // Malformed package.json — fall through and treat as single-app.
    }
  }
  if (rootHasWorkspaces) return;

  // If apps/web/package.json exists but root has NO workspaces declaration,
  // the builder produced a confused hybrid (both standalone and monorepo
  // package.json files at once). Treat as single-app: drop the apps/web
  // package/config siblings so consolidation can hoist the rest.
  const APPS_WEB_CONFIG_DUPES = [
    'apps/web/package.json',
    'apps/web/tsconfig.json',
    'apps/web/next.config.js',
    'apps/web/next.config.mjs',
    'apps/web/next.config.ts',
    'apps/web/postcss.config.js',
    'apps/web/postcss.config.mjs',
    'apps/web/tailwind.config.js',
    'apps/web/tailwind.config.ts',
    'apps/web/next-env.d.ts',
  ];
  for (const p of APPS_WEB_CONFIG_DUPES) fileMap.delete(p);

  // Detect a single-app Next.js project via ANY canonical signal. We don't
  // require root package.json because the assembler's scaffold step writes
  // it AFTER the first consolidation pass.
  const isNextProject =
    (!!rootPkgRaw && /['"]next['"]\s*:/.test(rootPkgRaw)) ||
    has('next.config.js') || has('next.config.mjs') || has('next.config.ts') ||
    has('src/app/page.tsx') || has('src/app/layout.tsx') ||
    has('app/page.tsx') || has('app/layout.tsx') ||
    has('pages/index.tsx') || has('pages/_app.tsx') ||
    // Builder may have written ONLY under apps/web/ — still a Next project,
    // we just need to hoist the contents.
    [...fileMap.keys()].some((p) => /^apps\/web\/(src\/)?(app|pages)\/(layout|page)\.[tj]sx?$/.test(p)) ||
    [...fileMap.keys()].some((p) => /^apps\/web\/next\.config\.(js|mjs|ts)$/.test(p));
  if (!isNextProject) return;

  // Decide whether the canonical root layout is `src/` or bare.
  const hasSrcLayout =
    has('src/app/page.tsx') ||
    has('src/app/layout.tsx') ||
    has('src/pages/index.tsx');
  const SRC_LAYOUT_DIRS = ['components/', 'lib/', 'hooks/', 'styles/', 'utils/', 'types/', 'app/', 'pages/'];
  const SKIP_PREFIXES = ['package.json', 'tsconfig.json', 'next.config.', 'tailwind.config.', 'postcss.config.', 'next-env.d.ts'];

  const moved: string[] = [];
  const dropped: string[] = [];

  for (const [path, file] of Array.from(fileMap.entries())) {
    if (!path.startsWith('apps/web/')) continue;
    let target = path.slice('apps/web/'.length);

    // Drop apps/web/* config duplicates — root already has them.
    if (SKIP_PREFIXES.some((pre) => target === pre || target.startsWith(pre))) {
      fileMap.delete(path);
      dropped.push(path);
      continue;
    }

    // src-layout rewrite: bare `components/` etc. → `src/components/`.
    if (hasSrcLayout && !target.startsWith('src/') && SRC_LAYOUT_DIRS.some((d) => target.startsWith(d))) {
      target = `src/${target}`;
    }

    if (target === path) continue;

    const existing = fileMap.get(target);
    if (existing) {
      // Collision: prefer non-empty + longer content.
      const a = existing.content?.trim() ?? '';
      const b = file.content?.trim() ?? '';
      if (b.length > a.length) {
        fileMap.set(target, { ...file, path: target });
      }
      fileMap.delete(path);
      dropped.push(path);
    } else {
      fileMap.set(target, { ...file, path: target });
      fileMap.delete(path);
      moved.push(`${path} → ${target}`);
    }
  }

  if (moved.length > 0 || dropped.length > 0) {
    logger.info(
      `consolidateLayout: moved ${moved.length}, dropped ${dropped.length} hybrid path(s)`,
      { sample: moved.slice(0, 4) },
    );
  }
}
