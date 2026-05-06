// ─────────────────────────────────────────────────────────────
// Final Integrity Gate
//
// HARD GATE that runs after qa-gate but BEFORE the project is
// scheduled for execution / runtime validation. Refuses to let a
// project graduate to `status: 'completed'` if its generated code
// has unresolvable imports.
//
// Two checks, both read-only:
//   1. Bare-module imports — every `import x from 'pkg'` (and friends)
//      must have a matching entry in the closest package.json's
//      dependencies / devDependencies / peerDependencies /
//      optionalDependencies. Catches the
//      "Module not found: 'class-variance-authority'" class of bugs
//      that survived past every auto-fix pass.
//   2. Internal relative imports — every `import x from './foo'` /
//      `'@/components/foo'` must resolve to a file we actually
//      emitted. Catches LLM-hallucinated component imports.
//
// On failure the caller marks the project failed via
// `persistProjectFailure` and skips both execution-validation and
// runtime-validation — there's no point booting a preview against a
// codebase that can't even resolve its imports.
// ─────────────────────────────────────────────────────────────

import {
  auditDependencies,
  type DependencyAuditEntry,
} from '../../../../packages/agent-core/src/dependency-validator.js';
import {
  validateImportIntegrity,
  type MissingImport,
} from '../../../../packages/agent-core/src/import-integrity.js';
import type { FileLike } from '../../../../packages/agent-core/src/agent-input-builder.js';

export interface FinalIntegrityReport {
  /** Overall verdict — `pass` only when both checks have zero findings. */
  verdict: 'pass' | 'fail';
  /** ISO timestamp the gate completed. */
  completedAt: string;
  /** Wall-clock duration. */
  durationMs: number;
  /** Bare-module imports that were not declared in package.json. */
  missingPackages: Array<{
    name: string;
    importedFrom: string[];
    packageJson: string | null;
    reason: DependencyAuditEntry['reason'];
  }>;
  /** package.json files that failed to parse — also a hard fail because
   *  we can't prove integrity without reading every host pkg.json. */
  unparseablePackageJsons: string[];
  /** Internal (relative / `@/`) imports that did not resolve to an
   *  emitted file. */
  danglingInternalImports: Array<{
    importer: string;
    specifier: string;
    triedPaths: string[];
  }>;
  /** Summary counts for log scale / dashboard chips. */
  counts: {
    sourceFilesScanned: number;
    bareImportsScanned: number;
    missingPackages: number;
    danglingInternalImports: number;
  };
}

/**
 * Compose a single human-readable failure message from the gate report.
 * Used as the `error` string on the persisted ProjectRecord and as the
 * Error.message handed to `persistProjectFailure`.
 */
export function describeIntegrityFailure(report: FinalIntegrityReport): string {
  if (report.verdict === 'pass') return 'final integrity gate passed';
  const parts: string[] = [];
  if (report.missingPackages.length > 0) {
    const names = report.missingPackages.slice(0, 5).map((m) => m.name).join(', ');
    const suffix = report.missingPackages.length > 5 ? `, +${report.missingPackages.length - 5} more` : '';
    parts.push(`${report.missingPackages.length} unresolved package import(s): ${names}${suffix}`);
  }
  if (report.danglingInternalImports.length > 0) {
    const names = report.danglingInternalImports
      .slice(0, 3)
      .map((d) => `${d.importer} → '${d.specifier}'`)
      .join('; ');
    const suffix = report.danglingInternalImports.length > 3
      ? `, +${report.danglingInternalImports.length - 3} more`
      : '';
    parts.push(`${report.danglingInternalImports.length} dangling internal import(s): ${names}${suffix}`);
  }
  if (report.unparseablePackageJsons.length > 0) {
    parts.push(`${report.unparseablePackageJsons.length} unparseable package.json file(s): ${report.unparseablePackageJsons.join(', ')}`);
  }
  return `Final integrity gate FAILED — ${parts.join(' | ')}`;
}

const SOURCE_EXT = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/i;

/**
 * Run the final integrity gate against the post-finalization file tree.
 * Pure / read-only — does not mutate `files`.
 */
export function runFinalIntegrityGate(files: FileLike[]): FinalIntegrityReport {
  const t0 = Date.now();

  const depAudit = auditDependencies(files);
  const dangling: MissingImport[] = validateImportIntegrity(files);

  const missingPackages = depAudit.missing.map((m) => ({
    name: m.name,
    importedFrom: m.importedFrom,
    packageJson: m.packageJson,
    reason: m.reason,
  }));

  const danglingInternalImports = dangling.map((d) => ({
    importer: d.importer,
    specifier: d.specifier,
    triedPaths: d.triedPaths,
  }));

  const sourceFilesScanned = files.filter((f) => SOURCE_EXT.test(f.path)).length;

  const verdict: 'pass' | 'fail' =
    missingPackages.length === 0 &&
    danglingInternalImports.length === 0 &&
    depAudit.unparseablePackageJsons.length === 0
      ? 'pass'
      : 'fail';

  return {
    verdict,
    completedAt: new Date().toISOString(),
    durationMs: Date.now() - t0,
    missingPackages,
    unparseablePackageJsons: depAudit.unparseablePackageJsons,
    danglingInternalImports,
    counts: {
      sourceFilesScanned,
      bareImportsScanned: depAudit.imports,
      missingPackages: missingPackages.length,
      danglingInternalImports: danglingInternalImports.length,
    },
  };
}
