// ─────────────────────────────────────────────────────────────
// Preview Error Classifier
//
// Real-time classifier that converts a failed preview record into a
// structured verdict the auto-fix loop can act on. The current
// pipeline already detects dev-overlay errors via
// `preview-content-health.detectDevOverlay` (Module-not-found,
// Cannot-resolve, Build-error, …) but historically that detection
// only ever produced a postmortem chip — the boot pipeline simply
// stopped. This module closes the gap:
//
//   PreviewStatus / PreviewRecord
//          │
//          ▼
//   classifyPreviewError(input)
//          │
//          ▼
//   PreviewErrorClassification { kind, missingPackage?, file?, message, autoFixable }
//          │
//          ▼
//   PreviewManager.start() retry loop
//          │
//          ▼
//   applyForcedDependencyFix(...) → docker / local restart
//
// The classifier is pure (no IO) and reads only fields that are
// already present on a failed preview: `error` string, `log` tail,
// and the `overlayDetection` block produced by the content-health
// probe. Adding new categories is cheap — extend the discriminator
// `kind` and update `isAutoFixable`.
//
// Patterns covered:
//   • "Module not found: Can't resolve 'X'"        (Next.js / webpack)
//   • "Cannot find module 'X'"                     (Node require)
//   • "Failed to resolve import 'X' from 'Y'"      (Vite)
//   • "Cannot resolve module 'X'"                  (esbuild / generic)
//
// Each pattern produces `kind: 'missing-package'` with `missingPackage`
// populated. Anything else falls through to `kind: 'unknown'` and is
// treated as non-auto-fixable.
// ─────────────────────────────────────────────────────────────

import type { DevOverlayDetection } from './preview-content-health.js';

// `DevOverlayDetection` is referenced in the documentation block above
// but not in the runtime types — keep the import so editors pick up
// the cross-reference.
export type { DevOverlayDetection };

/** Discrete error categories the auto-fix loop knows how to react to. */
export type PreviewErrorKind = 'missing-package' | 'unknown';

/**
 * Structured verdict produced by `classifyPreviewError`.
 *
 * `autoFixable === true` is the contract the retry loop relies on —
 * if it's false, the preview is left in `failed` and the user is
 * shown the original error verbatim.
 */
export interface PreviewErrorClassification {
  kind: PreviewErrorKind;
  /** Package name extracted from the error (only set for
   *  `kind === 'missing-package'`). Already trimmed of quotes/whitespace. */
  missingPackage?: string;
  /** Importing source file when the underlying overlay/log identified
   *  one. Best-effort — many error formats omit it. */
  file?: string;
  /** Short human-readable summary suitable for the UI's "fix attempt"
   *  log. Capped at ~240 characters. */
  message: string;
  /** True when the auto-fix loop should attempt to patch the project
   *  and retry the preview. False for unknown / runtime / hydration
   *  errors which require user intervention. */
  autoFixable: boolean;
}

/** Input to the classifier. Subset of `PreviewRecord`/`PreviewStatus`
 *  so the classifier doesn't depend on the full type surface. */
export interface PreviewErrorInput {
  /** The composed `record.error` / `previewStatus.error` string. */
  error?: string | null;
  /** The preview's log tail (combined stdout/stderr). */
  log?: string | null;
  /** Overlay block produced by the content-health probe. When
   *  `affectedModule` is set the classifier short-circuits with a
   *  clean missing-package verdict. The `detectedErrorType` slot is
   *  loosened to `string` here (instead of the narrow
   *  `DevOverlayDetection['detectedErrorType']` union) so callers can
   *  feed the persisted preview record's overlay block — which round-
   *  trips through JSON and therefore widens to `string` — without
   *  an upstream cast. */
  overlayDetection?: {
    detectedErrorType: string;
    detectedErrorMessage: string;
    affectedModule?: string;
  } | null;
}

// ─────────────────────────────────────────────────────────────
// Pattern table for log-line scanning.
//
// Order matters. The first match wins. Each pattern captures the
// missing module name in group 1 (and optionally the importing file
// in group 2). We stay case-insensitive on the prefix because Vite,
// Next.js and CRA each capitalise their messages slightly differently
// across versions.
// ─────────────────────────────────────────────────────────────

interface MissingPackagePattern {
  /** Stable id for log diagnostics. */
  id: string;
  /** Regex with `missingPackage` in group 1, optional `file` in group 2. */
  re: RegExp;
  /** Index of the file capture group, or -1 when the pattern doesn't carry one. */
  fileGroup: number;
}

const MISSING_PKG_PATTERNS: ReadonlyArray<MissingPackagePattern> = [
  // Next.js / webpack: "Module not found: Can't resolve 'class-variance-authority'"
  // Optionally followed by " in '/app/components'"
  {
    id: 'webpack-cant-resolve',
    re: /Module not found:?\s*(?:Error:?\s*)?Can'?t resolve\s+['"`]([^'"`]+)['"`](?:\s+in\s+['"`]([^'"`]+)['"`])?/i,
    fileGroup: 2,
  },
  // Vite: "Failed to resolve import 'class-variance-authority' from 'src/Foo.tsx'"
  {
    id: 'vite-failed-resolve',
    re: /Failed to resolve import\s+['"`]([^'"`]+)['"`](?:\s+from\s+['"`]([^'"`]+)['"`])?/i,
    fileGroup: 2,
  },
  // Node / require: "Cannot find module 'class-variance-authority'"
  // Optionally "Require stack: …/Foo.js"
  {
    id: 'node-cannot-find',
    re: /Cannot find module\s+['"`]([^'"`]+)['"`]/i,
    fileGroup: -1,
  },
  // esbuild / generic: "Cannot resolve module 'class-variance-authority'"
  {
    id: 'esbuild-cannot-resolve',
    re: /Cannot resolve\s+(?:module\s+)?['"`]([^'"`]+)['"`]/i,
    fileGroup: -1,
  },
  // Vite alt: "[plugin:vite:import-analysis] Failed to resolve … 'X'"
  {
    id: 'vite-import-analysis',
    re: /vite:import-analysis[^\n]*?['"`]([^'"`]+)['"`]/i,
    fileGroup: -1,
  },
];

// Reject obviously-not-a-package matches. These are all relative or
// alias-style specifiers that the auto-fix loop has no business
// touching with `npm install`.
const RELATIVE_OR_ALIAS = /^(?:\.{1,2}\/|\/|@\/|~\/|node:|file:)/;

/**
 * Best-effort npm package-name validation. Mirrors the rules
 * documented at https://docs.npmjs.com/cli/v10/configuring-npm/package-json#name
 * but is intentionally lenient — we only need to reject specifiers
 * the auto-fix loop should not attempt to install (relative paths,
 * URL schemes, empty strings, characters that would break a shell).
 */
function isInstallablePackageName(spec: string): boolean {
  if (!spec || spec.length === 0 || spec.length > 214) return false;
  if (RELATIVE_OR_ALIAS.test(spec)) return false;
  // Strip any subpath import (e.g. "lodash/fp" → "lodash"; "@radix-ui/react-dialog/foo" → "@radix-ui/react-dialog").
  const name = spec.startsWith('@')
    ? spec.split('/').slice(0, 2).join('/')
    : spec.split('/')[0];
  // Disallow whitespace, uppercase letters at the head (npm names are
  // lowercase), or characters that aren't part of a valid package name.
  if (!/^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*$/.test(name)) return false;
  return true;
}

/** Trim a message line to ≤max chars without breaking a UTF-16 code unit. */
function trimMsg(s: string, max = 240): string {
  if (s.length <= max) return s.trim();
  return `${s.slice(0, max - 1).trim()}…`;
}

/**
 * Classify a failed preview into a structured verdict the auto-fix
 * loop can react to. The function is pure / deterministic — given
 * the same input it always returns the same classification.
 *
 * Resolution order:
 *   1. `overlayDetection` with `affectedModule` is the strongest
 *      signal — content-health already extracted the module name.
 *   2. Otherwise scan `error` then `log` against `MISSING_PKG_PATTERNS`.
 *   3. Fall through to `kind: 'unknown'`.
 */
export function classifyPreviewError(
  input: PreviewErrorInput,
): PreviewErrorClassification {
  const overlay = input.overlayDetection;

  // ── Strongest signal: overlay detection already pulled the module.
  if (overlay?.affectedModule && isInstallablePackageName(overlay.affectedModule)) {
    return {
      kind: 'missing-package',
      missingPackage: overlay.affectedModule,
      message: trimMsg(
        overlay.detectedErrorMessage ||
          `Module not found: ${overlay.affectedModule}`,
      ),
      autoFixable: true,
    };
  }

  // ── Fallback: scan error/log strings.
  const haystacks: string[] = [];
  if (input.error) haystacks.push(input.error);
  if (input.log) haystacks.push(input.log);

  for (const text of haystacks) {
    for (const pat of MISSING_PKG_PATTERNS) {
      const m = text.match(pat.re);
      if (!m) continue;
      const cand = (m[1] ?? '').trim();
      if (!isInstallablePackageName(cand)) continue;
      const file = pat.fileGroup > 0 ? (m[pat.fileGroup] ?? undefined) : undefined;
      return {
        kind: 'missing-package',
        missingPackage: cand,
        file: file && file.length > 0 ? file : undefined,
        message: trimMsg(m[0]),
        autoFixable: true,
      };
    }
  }

  // ── Overlay matched a non-installable category (hydration / runtime /
  //    application-error / chunk-load) — surface it but mark non-fixable.
  if (overlay) {
    return {
      kind: 'unknown',
      message: trimMsg(
        overlay.detectedErrorMessage || `Preview overlay: ${overlay.detectedErrorType}`,
      ),
      autoFixable: false,
    };
  }

  // ── Nothing recognisable.
  return {
    kind: 'unknown',
    message: trimMsg(input.error || 'Preview failed (no recognisable error pattern)'),
    autoFixable: false,
  };
}

/** Convenience wrapper — true iff the classifier marked the error
 *  as auto-fixable AND populated a missing package name. Used by the
 *  retry loop's gate condition. */
export function isAutoFixablePreviewError(
  c: PreviewErrorClassification,
): c is PreviewErrorClassification & { missingPackage: string } {
  return c.autoFixable && c.kind === 'missing-package' && !!c.missingPackage;
}
