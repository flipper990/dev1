// ─────────────────────────────────────────────────────────────
// Preview Dependency Preflight
//
// Last-line-of-defence guard that runs immediately before the
// preview backend stages files / runs `npm install`. Even though the
// generation pipeline already calls validateAndFixDependencies after
// every slice + at final-assembly, generated code can still slip
// through with imports that were never declared in package.json:
//
//   • A QA fix loop adds a new import after the last validator pass.
//   • A slice merge re-introduces a previously stripped import.
//   • A polish step rewrites a component to use a new shadcn/ui
//     primitive (e.g. class-variance-authority) without touching
//     package.json.
//
// Symptom: `npm install` succeeds, dev server boots with HTTP 200, but
// the rendered HTML carries Next.js's "Module not found: Can't resolve
// 'class-variance-authority'" overlay — and the content-health probe
// rightly fails the readiness gate.
//
// This preflight closes the loop:
//   1. Re-scan EVERY .ts/.tsx/.js/.jsx/.mjs/.cjs file in the persisted
//      project for bare-module imports.
//   2. Diff against the closest package.json's deps/devDeps/peerDeps.
//   3. Auto-add anything missing, pinned via the generator's curated
//      KNOWN_VERSIONS table (covers class-variance-authority, clsx,
//      tailwind-merge, lucide-react, @radix-ui/*, react-hook-form,
//      zod, etc.). Falls back to "latest" for unknown packages.
//   4. Persist the patched files back to disk via
//      ProjectStore.save() — this re-flushes output/ so both the
//      docker contextDir AND the local-runner stagingDir see the
//      updated package.json on the next read.
//   5. Return a structured DependencyFix[] so the caller can:
//        • record it on PreviewRecord.dependencyFixes
//        • mirror it onto ProjectRecord.preview.dependencyFixes
//        • surface it in the diagnostic log + dashboard postmortem.
//
// Idempotent: a clean codebase produces zero fixes and zero writes.
// ─────────────────────────────────────────────────────────────

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { validateAndFixDependencies, pickKnownVersion } from '../../../../packages/agent-core/src/dependency-validator.js';
import {
  validatePackageJson,
  type PackageJsonViolation,
} from '../../../../packages/agent-core/src/package-json-validator.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { ProjectStore } from '../storage/project-store.js';

/** Error thrown by the preflight when the package.json fails the
 *  static peer-conflict gate. Carries the structured payload that the
 *  preview manager surfaces as `previewError` and persists alongside
 *  the project for the dashboard postmortem.
 *
 *  The shape mirrors `last-npm-eresolve.json` so engineers diagnosing
 *  install failures can read the same fields whether the failure was
 *  caught pre-install (this gate) or post-install (npm ERESOLVE). */
export class DependencyPreflightError extends Error {
  readonly code = 'DEPENDENCY_PREFLIGHT_FAILED';
  readonly projectId: string;
  readonly headline: string;
  readonly violations: PackageJsonViolation[];
  readonly bundleId: string | null;
  readonly dumpPath: string | null;
  constructor(args: {
    projectId: string;
    headline: string;
    violations: PackageJsonViolation[];
    bundleId: string | null;
    dumpPath: string | null;
  }) {
    super(args.headline);
    this.name = 'DependencyPreflightError';
    this.projectId = args.projectId;
    this.headline = args.headline;
    this.violations = args.violations;
    this.bundleId = args.bundleId;
    this.dumpPath = args.dumpPath;
  }
}

export interface DependencyFix {
  /** npm package name as it appears in package.json (e.g. `@radix-ui/react-dialog`). */
  packageName: string;
  /** SemVer range we pinned. `latest` if no curated pin exists. */
  version: string;
  /** Why this package was added — distinguishes a missing-import fix
   *  from any future heuristic (e.g. peerDep transitive). */
  reason: 'imported-not-declared';
  /** Source files that import the package. Capped to the first 5 to
   *  bound the persisted record size. */
  requiredBy: string[];
  /** Path of the package.json the entry was added to (relative). */
  packageJson: string;
  /** Block the entry was inserted into. */
  block: 'dependencies' | 'devDependencies';
  /** ISO timestamp the fix was applied. */
  fixedAt: string;
}

export interface DependencyPreflightResult {
  /** Fixes applied to package.json files. Empty when the codebase was
   *  already self-consistent. */
  fixes: DependencyFix[];
  /** Imports that referenced something no host package.json could be
   *  found for (very rare — usually means the project is missing its
   *  root package.json entirely). Surfaced so the caller can decide
   *  whether to bail or proceed. */
  unresolved: Array<{ packageName: string; requiredBy: string[]; reason: string }>;
  /** Whether files were rewritten and persisted. */
  filesPersisted: boolean;
  /** The post-fix file tree. Identical to the input when no fixes were
   *  applied. Returned so callers holding an in-memory `project.files`
   *  reference (e.g. local-runner staging) can swap to the patched
   *  view without re-reading from disk. */
  patchedFiles: Array<{ path: string; content: string; language?: string }>;
  /** Total bare-module imports scanned (for log scale). */
  importsScanned: number;
  /** Static peer-conflict violations detected on the *post-reconcile*
   *  package.json. Empty array means the package set should install
   *  cleanly without `--legacy-peer-deps`. A non-empty `severity:
   *  'error'` entry means npm install WILL ERESOLVE — the caller
   *  should fail-fast rather than waste time on `npm install`. */
  packageJsonViolations: PackageJsonViolation[];
  /** True when at least one violation has severity `error`. The
   *  preview manager uses this to short-circuit before spawning npm. */
  hasBlockingViolation: boolean;
  /** Single-line headline derived from the first blocking violation,
   *  ready to use as `previewError`. `null` when no blocking error. */
  blockingHeadline: string | null;
}

interface PreflightArgs {
  projectId: string;
  projectStore: ProjectStore;
  logger: Logger;
}

const DEV_DEP_PATTERNS = [
  /^@types\//,
  /^eslint(-|$)/,
  /^prettier$/,
  /^typescript$/,
  /^tsx$/,
  /^vitest$/,
  /^jest$/,
  /^@testing-library\//,
  /^prisma$/,
  /^drizzle-kit$/,
  /^autoprefixer$/,
  /^postcss$/,
  /^tailwindcss(?:-animate)?$/,
];

function classifyBlock(name: string): 'dependencies' | 'devDependencies' {
  return DEV_DEP_PATTERNS.some((rx) => rx.test(name)) ? 'devDependencies' : 'dependencies';
}

/**
 * Run the dependency preflight against the persisted project. When fixes
 * are needed, the patched files are written back through the project
 * store so subsequent reads (docker contextDir, local-runner stagingDir)
 * see the updated package.json.
 */
export async function runPreviewDependencyPreflight(
  args: PreflightArgs,
): Promise<DependencyPreflightResult> {
  const { projectId, projectStore, logger } = args;
  const project = await projectStore.get(projectId);
  if (!project || !Array.isArray(project.files) || project.files.length === 0) {
    // No files at all — almost always means the generator never wrote
    // its output. Fail-fast with a structured error so the dashboard
    // shows "no project files" rather than "npm install failed".
    const headline = 'Preflight failed: project has no files on disk (generation may have aborted).';
    const violation: PackageJsonViolation = {
      ruleId: 'project-files-missing',
      severity: 'error',
      message: headline,
      detail: { packages: [], foundVersions: {} },
    };
    const dumpPath = await persistPreflightFailureDump({
      projectId,
      headline,
      violations: [violation],
      bundleId: null,
      packageJson: null,
      logger,
      projectStore,
    });
    throw new DependencyPreflightError({
      projectId,
      headline,
      violations: [violation],
      bundleId: null,
      dumpPath,
    });
  }

  // Hard prerequisite: a root package.json must exist. Without one
  // there is nothing to validate and `npm install` would fail with an
  // opaque "ENOENT: package.json" anyway.
  const rootPkgFileEarly = project.files.find(
    (f) => f.path === 'package.json' || f.path === './package.json',
  );
  if (!rootPkgFileEarly) {
    const headline = 'Preflight failed: root package.json is missing from the generated project.';
    const violation: PackageJsonViolation = {
      ruleId: 'package-json-missing',
      severity: 'error',
      message: headline,
      detail: { packages: ['package.json'], foundVersions: {} },
    };
    const dumpPath = await persistPreflightFailureDump({
      projectId,
      headline,
      violations: [violation],
      bundleId: null,
      packageJson: null,
      logger,
      projectStore,
    });
    throw new DependencyPreflightError({
      projectId,
      headline,
      violations: [violation],
      bundleId: null,
      dumpPath,
    });
  }

  const { files: patchedFiles, report } = validateAndFixDependencies(project.files);
  const fixedAt = new Date().toISOString();

  const fixes: DependencyFix[] = report.added.map((entry) => ({
    packageName: entry.name,
    version: entry.version,
    reason: 'imported-not-declared',
    requiredBy: entry.importedFrom,
    packageJson: entry.packageJson,
    block: classifyBlock(entry.name),
    fixedAt,
  }));

  const unresolved = report.unresolved.map((u) => ({
    packageName: u.name,
    requiredBy: u.importedFrom,
    reason: u.reason,
  }));

  // Static peer-compatibility validator. Runs on the *post-reconcile*
  // file tree (i.e. after validateAndFixDependencies has applied any
  // bundle rules) so violations here mean either:
  //   1. The reconciler missed something (bundle scope was too narrow), OR
  //   2. The package.json has a problem the bundle can't fix
  //      automatically (e.g. user-edited file with a hand-pinned
  //      "react-dom": "*" that no rule whitelists for replacement).
  // Either way, we want to fail-fast with a precise message rather
  // than waste 30s on `npm install` only to surface ERESOLVE.
  const rootPkgFile = (patchedFiles.length ? patchedFiles : project.files).find(
    (f) => f.path === 'package.json' || f.path === './package.json',
  );
  let packageJsonViolations: PackageJsonViolation[] = [];
  let hasBlockingViolation = false;
  let blockingHeadline: string | null = null;
  let validationBundleId: string | null = null;
  let parsedPackageJson: Record<string, unknown> | null = null;
  if (rootPkgFile) {
    try {
      const parsed = JSON.parse(rootPkgFile.content) as Record<string, unknown>;
      parsedPackageJson = parsed;
      const validation = validatePackageJson({
        dependencies: parsed.dependencies as Record<string, string> | undefined,
        devDependencies: parsed.devDependencies as Record<string, string> | undefined,
        peerDependencies: parsed.peerDependencies as Record<string, string> | undefined,
        optionalDependencies: parsed.optionalDependencies as Record<string, string> | undefined,
        overrides: parsed.overrides as Record<string, string> | undefined,
      });
      packageJsonViolations = validation.violations;
      hasBlockingViolation = validation.hasBlockingError;
      blockingHeadline = validation.headline;
      validationBundleId = validation.bundleId;
      if (validation.violations.length > 0) {
        logger.warn('preview dep preflight: package.json validation flagged issues', {
          event: 'preview:dep-preflight-violations',
          projectId,
          bundleId: validation.bundleId,
          blockingCount: validation.violations.filter((v) => v.severity === 'error').length,
          warningCount: validation.violations.filter((v) => v.severity === 'warning').length,
          violations: validation.violations.slice(0, 8).map((v) => ({
            ruleId: v.ruleId,
            severity: v.severity,
            message: v.message,
          })),
        });
      }
    } catch (err) {
      logger.warn('preview dep preflight: root package.json parse failed', {
        projectId,
        error: (err as Error).message,
      });
      hasBlockingViolation = true;
      blockingHeadline = `package.json parse failed: ${(err as Error).message}`;
      packageJsonViolations = [
        {
          ruleId: 'package-json-parse-error',
          severity: 'error',
          message: blockingHeadline,
          detail: { packages: ['package.json'], foundVersions: {} },
        },
      ];
    }
  }

  // Hard stop: blocking violations mean `npm install` would ERESOLVE.
  // Persist a structured dump (mirrors last-npm-eresolve.json) and
  // throw a typed error the preview manager maps onto
  // previewStatus=failed + previewError=<headline>.
  if (hasBlockingViolation && blockingHeadline) {
    const dumpPath = await persistPreflightFailureDump({
      projectId,
      headline: blockingHeadline,
      violations: packageJsonViolations,
      bundleId: validationBundleId,
      packageJson: parsedPackageJson,
      logger,
      projectStore,
    });
    throw new DependencyPreflightError({
      projectId,
      headline: blockingHeadline,
      violations: packageJsonViolations,
      bundleId: validationBundleId,
      dumpPath,
    });
  }

  // Did the reconciler rewrite any versions? Even when no fixes
  // (import-add) were needed, R1–R6 may have rewritten "latest"
  // pins or fixed major mismatches; we MUST persist those rewrites
  // so the staged tree the runner installs reflects them.
  const reconcilerTouched = report.reconciled.some((r) => r.effects.length > 0);

  // No-op fast path — clean codebase AND no reconciler effects.
  if (fixes.length === 0 && !reconcilerTouched) {
    return {
      fixes: [],
      unresolved,
      filesPersisted: false,
      patchedFiles: project.files,
      importsScanned: report.imports,
      packageJsonViolations,
      hasBlockingViolation,
      blockingHeadline,
    };
  }

  // Persist the patched files. Use update() rather than save() so we
  // re-read the latest project.json INSIDE the per-project lock and
  // only mutate `files` — critical because the preview path runs
  // AFTER `project.status` has flipped to 'completed' and a stale
  // save() of the in-memory record (loaded earlier as 'generating')
  // would silently regress generation status. The mutator only
  // touches `files`; everything else (status, completedAt,
  // metrics, preview block) is preserved verbatim from disk.
  try {
    await projectStore.update(projectId, (current) => {
      current.files = patchedFiles;
      return current;
    }, {
      phase: 'preview-dep-preflight',
      persistFiles: true,
      caller: 'preview-dep-preflight',
      reason: 'auto-add missing dependencies before npm install',
      previewWriter: true,
    });
  } catch (err) {
    logger.error('preview dep preflight: failed to persist patched files', {
      projectId,
      error: (err as Error).message,
      fixCount: fixes.length,
    });
    // Surface an actionable error rather than letting `npm install`
    // proceed against the un-patched (still-broken) tree.
    throw new Error(
      `Dependency preflight added ${fixes.length} package(s) but could not persist ` +
      `package.json updates: ${(err as Error).message}`,
    );
  }

  logger.info('preview dep preflight: auto-added missing dependencies', {
    event: 'preview:dep-preflight',
    projectId,
    fixCount: fixes.length,
    reconcilerEffects: report.reconciled.reduce((n, r) => n + r.effects.length, 0),
    importsScanned: report.imports,
    packageManager: report.packageManager,
    sample: fixes.slice(0, 8).map((f) => ({
      name: f.packageName,
      version: f.version,
      block: f.block,
      requiredBy: f.requiredBy.slice(0, 2),
    })),
  });

  return {
    fixes,
    unresolved,
    filesPersisted: true,
    patchedFiles,
    importsScanned: report.imports,
    packageJsonViolations,
    hasBlockingViolation,
    blockingHeadline,
  };
}

// ─────────────────────────────────────────────────────────────
// Forced-fix injector
//
// Used by the preview-side auto-fix retry loop. When the dev-server
// overlay or a build log surfaces "Module not found: 'X'" but the
// regular preflight scanner missed it (X was added by a runtime
// codepath the static scanner doesn't visit, OR the import lives in
// a string-literal config block, OR the overlay is reporting a
// transitive peer-dep), the retry loop calls this helper with the
// exact module name extracted by the classifier. We add `X` to the
// root package.json's deps/devDeps with the same pinned version
// `validateAndFixDependencies` would have used (or `latest` for an
// unknown name) and persist the file tree.
// ─────────────────────────────────────────────────────────────

/** Result of `applyForcedDependencyFix`. `applied: false` means the
 *  package was already declared OR no host package.json could be
 *  found — either way, no write happened. */
export interface ForcedDependencyFixResult {
  applied: boolean;
  packageName: string;
  /** Pinned version that was added (only set when `applied: true`). */
  version?: string;
  /** Block the entry was inserted into (only set when `applied: true`). */
  block?: 'dependencies' | 'devDependencies';
  /** Path of the package.json that was patched (only set when `applied: true`). */
  packageJson?: string;
  /** ISO timestamp of the patch (only set when `applied: true`). */
  appliedAt?: string;
  /** Reason the call was a no-op when `applied: false`. */
  skipReason?:
    | 'already-declared'
    | 'no-package-json'
    | 'invalid-package-name'
    | 'package-json-parse-failed';
}

interface ForcedFixArgs {
  projectId: string;
  /** Bare-module package name (e.g. `class-variance-authority`,
   *  `@radix-ui/react-dialog`). Subpath imports must be stripped by
   *  the caller — the injector adds whatever string it receives. */
  packageName: string;
  /** Source files that triggered the missing-module error. Capped to
   *  5 entries for log noise. Recorded on the persisted PreviewRecord
   *  so the dashboard postmortem can show "we added X because Y
   *  imported it". */
  requiredBy?: string[];
  projectStore: ProjectStore;
  logger: Logger;
}

/** Strip a subpath import (`lodash/fp` → `lodash`,
 *  `@radix-ui/react-dialog/foo` → `@radix-ui/react-dialog`) so the
 *  injector always works with installable npm names. */
function stripSubpath(spec: string): string {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

/**
 * Inject a single missing dependency into the project's root
 * package.json and persist the patched tree. Idempotent — calling
 * twice for the same name is a no-op on the second call.
 *
 * Uses the curated `pickKnownVersion` table so the version pin is
 * the same one the generator-side validator would have applied.
 * Unknown packages fall through to `latest`.
 */
export async function applyForcedDependencyFix(
  args: ForcedFixArgs,
): Promise<ForcedDependencyFixResult> {
  const { projectId, projectStore, logger } = args;
  const rawName = (args.packageName || '').trim();
  const name = stripSubpath(rawName);
  if (!name || !/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)) {
    return { applied: false, packageName: rawName, skipReason: 'invalid-package-name' };
  }

  const project = await projectStore.get(projectId);
  if (!project || !Array.isArray(project.files) || project.files.length === 0) {
    return { applied: false, packageName: name, skipReason: 'no-package-json' };
  }

  // Find the root package.json. We deliberately scope to the SHALLOWEST
  // package.json in the project — a workspace's nested `apps/web/package.json`
  // is the wrong place to inject when the import lives at the root.
  const pkgs = project.files
    .filter((f) => f.path.replace(/\\/g, '/').endsWith('package.json'))
    .sort((a, b) => a.path.split(/[\\/]/).length - b.path.split(/[\\/]/).length);
  const pkgEntry = pkgs[0];
  if (!pkgEntry || typeof pkgEntry.content !== 'string') {
    return { applied: false, packageName: name, skipReason: 'no-package-json' };
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(pkgEntry.content) as Record<string, unknown>;
  } catch {
    return { applied: false, packageName: name, skipReason: 'package-json-parse-failed' };
  }

  const declaredIn = (
    ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const
  ).find((k) => {
    const block = parsed[k] as Record<string, unknown> | undefined;
    return block && typeof block === 'object' && name in block;
  });
  if (declaredIn) {
    return { applied: false, packageName: name, skipReason: 'already-declared' };
  }

  const version = pickKnownVersion(name);
  const block: 'dependencies' | 'devDependencies' = classifyBlock(name);

  // Insert preserving alphabetical order within the block — keeps
  // diffs against the persisted package.json minimal.
  const existing = (parsed[block] as Record<string, string> | undefined) ?? {};
  const merged: Record<string, string> = { ...existing, [name]: version };
  const sorted = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)),
  );
  parsed[block] = sorted;

  // Detect leading whitespace style (tabs vs 2-space) so the rewrite
  // matches the existing file.
  const indentMatch = pkgEntry.content.match(/\n(\s+)"/);
  const indent = indentMatch ? indentMatch[1].length : 2;
  const trailingNewline = pkgEntry.content.endsWith('\n') ? '\n' : '';
  const newContent = `${JSON.stringify(parsed, null, indent)}${trailingNewline}`;

  const patchedFiles = project.files.map((f) =>
    f.path === pkgEntry.path ? { ...f, content: newContent } : f,
  );

  try {
    // See note in the main preflight path above — update() preserves
    // status/completedAt/metrics that a stale save() would clobber.
    await projectStore.update(projectId, (current) => {
      current.files = patchedFiles;
      return current;
    }, {
      phase: 'preview-forced-fix',
      persistFiles: true,
      caller: 'preview-forced-fix',
      reason: `forced-add ${name} after dev-server overlay surfaced it`,
      previewWriter: true,
    });
  } catch (err) {
    logger.error('preview forced-fix: failed to persist package.json patch', {
      event: 'preview:forced-fix:persist-failed',
      projectId,
      packageName: name,
      error: (err as Error).message,
    });
    throw new Error(
      `Forced dependency fix added ${name} but could not persist package.json: ${(err as Error).message}`,
    );
  }

  const appliedAt = new Date().toISOString();
  logger.info('preview forced-fix: injected missing dependency', {
    event: 'preview:forced-fix:injected',
    projectId,
    packageName: name,
    version,
    block,
    packageJson: pkgEntry.path,
    requiredBy: (args.requiredBy ?? []).slice(0, 5),
  });

  return {
    applied: true,
    packageName: name,
    version,
    block,
    packageJson: pkgEntry.path,
    appliedAt,
  };
}

// ─────────────────────────────────────────────────────────────
// Structured failure dump
//
// Mirrors the shape of `last-npm-eresolve.json` so the dashboard's
// postmortem renderer (and engineers tailing the testing/ folder)
// can read pre-install vs post-install failures with the same parser.
//
// Always written to apps/api/src/testing/last-preflight-failure.json
// so the most-recent failure is trivially inspectable. Best-effort —
// a write failure is logged but never blocks the throw above (the
// thrown DependencyPreflightError carries the same payload in memory).
// ─────────────────────────────────────────────────────────────

interface PersistFailureArgs {
  projectId: string;
  headline: string;
  violations: PackageJsonViolation[];
  bundleId: string | null;
  packageJson: Record<string, unknown> | null;
  logger: Logger;
  /** Optional store reference so the dump can include both
   *  `projectStatus` and `previewStatus` from the persisted record —
   *  this is the "final diagnostics show both clearly" requirement.
   *  Best-effort: a read failure is silently ignored. */
  projectStore?: ProjectStore;
}

async function persistPreflightFailureDump(args: PersistFailureArgs): Promise<string | null> {
  const { projectId, headline, violations, bundleId, packageJson, logger, projectStore } = args;

  // Strip everything from the package.json except the dep blocks —
  // scripts/engines/etc. are noise for a peer-conflict postmortem.
  let depsBlocks: Record<string, Record<string, string>> | null = null;
  if (packageJson && typeof packageJson === 'object') {
    depsBlocks = {};
    for (const k of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
      const v = packageJson[k];
      if (v && typeof v === 'object') {
        depsBlocks[k] = v as Record<string, string>;
      }
    }
  }

  // Build the structured "packageA / packageB / peer requirement /
  // suggested fix" rows the dashboard expects. One row per violation.
  const conflicts = violations.map((v) => {
    const packages = v.detail.packages;
    const found = v.detail.foundVersions ?? {};
    const expected = v.detail.expectedVersions ?? {};
    const packageA = packages[0] ?? null;
    const packageB = packages[1] ?? null;
    return {
      ruleId: v.ruleId,
      severity: v.severity,
      message: v.message,
      packageA: packageA
        ? { name: packageA, version: found[packageA] ?? null }
        : null,
      packageB: packageB
        ? { name: packageB, version: found[packageB] ?? null }
        : null,
      peerRequirement: v.message,
      suggestedFix: Object.entries(expected).map(([name, version]) => ({ name, version })),
    };
  });

  // Status snapshot: read both `project.status` and
  // `project.preview.previewStatus` from disk so the dump shows the
  // separation between generation outcome and preview outcome. This
  // is the "final diagnostics show both clearly" rule.
  let projectStatusSnapshot: string | null = null;
  let previewStatusSnapshot: string | null = null;
  if (projectStore) {
    try {
      const rec = await projectStore.get(projectId);
      if (rec) {
        projectStatusSnapshot = rec.status ?? null;
        previewStatusSnapshot = rec.preview?.previewStatus ?? null;
      }
    } catch {
      /* best-effort */
    }
  }

  const dump = {
    timestamp: new Date().toISOString(),
    projectId,
    code: 'DEPENDENCY_PREFLIGHT_FAILED',
    headline,
    bundleId,
    // Status separation: the gate fails preview but never touches
    // generation status. Surface both fields explicitly so the
    // postmortem makes the separation visible. `projectStatus` is
    // the persisted ProjectRecord.status; `previewStatus` is the
    // current ProjectRecord.preview.previewStatus (whatever the
    // PreviewManager last wrote). Read AT dump time, best-effort.
    projectStatus: projectStatusSnapshot,
    previewStatus: previewStatusSnapshot,
    packageJson: depsBlocks,
    conflicts,
    violations,
  };

  const dumpPath = join(process.cwd(), 'apps/api/src/testing/last-preflight-failure.json');
  try {
    await mkdir(dirname(dumpPath), { recursive: true });
    await writeFile(dumpPath, JSON.stringify(dump, null, 2), 'utf8');
    logger.info('preview dep preflight: failure dump persisted', {
      event: 'preview:dep-preflight:dump',
      projectId,
      dumpPath,
      violationCount: violations.length,
    });
    return dumpPath;
  } catch (err) {
    logger.warn('preview dep preflight: failed to write failure dump', {
      projectId,
      dumpPath,
      error: (err as Error).message,
    });
    return null;
  }
}

