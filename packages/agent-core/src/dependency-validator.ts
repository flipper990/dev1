// ─────────────────────────────────────────────────────────────
// Dependency Validator — auto-fix package.json so every bare-module
// import in generated source resolves to a declared dependency.
//
// Runs AFTER builder, BEFORE QA. Goals:
//   1. Parse import / require / dynamic-import specifiers from every
//      generated .ts/.tsx/.js/.jsx/.mjs/.cjs file.
//   2. For each source file, find its closest emitted package.json
//      (walking up directory).
//   3. For each bare-module specifier (not relative, not absolute,
//      not `node:` builtin, not the package's OWN name, not a
//      workspace sibling), check if it (or one of its alias forms)
//      is declared in dependencies / devDependencies /
//      peerDependencies / optionalDependencies.
//   4. If missing, add it to `dependencies` with a known-pinned
//      version (or "latest" as a last resort). Preserves the original
//      package.json formatting (indentation, trailing newline).
//   5. Format-agnostic across npm / yarn / pnpm — the package.json
//      schema is identical; only lockfiles differ. We never touch
//      lockfiles. We do honor pnpm `workspace:*` and yarn `portal:`
//      specifiers when they're already present (treat as satisfied).
//
// Returns the patched files plus a structured report so the pipeline
// can log / surface what changed.
// ─────────────────────────────────────────────────────────────

import type { FileLike } from './agent-input-builder.js';
import {
  REACT_18_NEXT_15,
  reconcilePackageJson,
  selectBundle,
  type RuleEffect,
} from './stack-compatibility.js';

export interface DependencyValidationReport {
  /** Total bare-module imports inspected (after dedup per pkg.json). */
  imports: number;
  /** Specifiers that were missing and got added. */
  added: Array<{ packageJson: string; name: string; version: string; importedFrom: string[] }>;
  /** Imports flagged as missing but NOT auto-fixed (e.g. unparsable package.json, no host pkg.json found). */
  unresolved: Array<{ packageJson: string | null; name: string; importedFrom: string[]; reason: string }>;
  /** package.json files we modified. */
  patched: string[];
  /** Detected package manager (informational only). */
  packageManager: 'npm' | 'yarn' | 'pnpm' | 'unknown';
  /** Cross-package peer-compatibility fixes applied by the
   *  stack-compatibility reconciler (e.g. force-pinning react-dom to
   *  match react's major). Empty when the package set was already
   *  coherent. */
  reconciled: Array<{ packageJson: string; bundleId: string; effects: RuleEffect[] }>;
}

export interface DependencyValidationResult {
  files: FileLike[];
  report: DependencyValidationReport;
}

const SOURCE_EXT = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/i;

/** Node.js core modules — never declared in package.json. */
const NODE_BUILTINS = new Set([
  'assert', 'async_hooks', 'buffer', 'child_process', 'cluster', 'console', 'constants',
  'crypto', 'dgram', 'diagnostics_channel', 'dns', 'domain', 'events', 'fs', 'http',
  'http2', 'https', 'inspector', 'module', 'net', 'os', 'path', 'perf_hooks', 'process',
  'punycode', 'querystring', 'readline', 'repl', 'stream', 'string_decoder', 'sys',
  'timers', 'tls', 'trace_events', 'tty', 'url', 'util', 'v8', 'vm', 'wasi',
  'worker_threads', 'zlib',
]);

/**
 * Best-effort version pins for the most common packages a code generator
 * is likely to import. Keeps generated projects reproducible across runs
 * instead of using "latest" everywhere.
 *
 * NOT exhaustive — anything not listed gets "latest", which `npm install`
 * resolves at install time.
 */
const KNOWN_VERSIONS: Record<string, string> = {
  // ── Peer-sensitive packages (react / react-dom / next / vite /
  //    tailwind / postcss / autoprefixer / @types/react* / radix-ui
  //    primitives) are deliberately ABSENT from this table. Their
  //    versions live in REACT_18_NEXT_15.versions (stack-
  //    compatibility.ts) which is the single source of truth.
  //    `pickVersion` consults the bundle FIRST and would shadow any
  //    duplicate here — keeping them out prevents drift between the
  //    flat fallback table and the bundle when one is bumped.
  // Frameworks (non-peer-sensitive)
  'fastify':               '^5.0.0',
  '@fastify/cors':         '^10.0.0',
  '@fastify/helmet':       '^13.0.0',
  '@fastify/static':       '^8.0.0',
  'express':               '^4.21.0',
  // DB / ORM
  '@prisma/client':        '^5.20.0',
  'prisma':                '^5.20.0',
  'drizzle-orm':           '^0.36.0',
  'drizzle-kit':           '^0.28.0',
  'pg':                    '^8.13.0',
  'better-sqlite3':        '^11.5.0',
  'mongoose':              '^8.8.0',
  // State / data
  'zustand':               '^5.0.0',
  '@tanstack/react-query': '^5.59.0',
  'swr':                   '^2.2.5',
  'axios':                 '^1.7.0',
  // Validation
  'zod':                   '^3.23.0',
  'yup':                   '^1.4.0',
  // UI (non-peer-sensitive utilities; tailwindcss / autoprefixer /
  // postcss / class-variance-authority / clsx / tailwind-merge /
  // lucide-react / sonner / vaul / cmdk / radix-ui / etc. are owned
  // by the bundle).
  'lucide-react':          '^0.460.0',
  'cmdk':                  '^1.0.0',
  'sonner':                '^1.7.0',
  'vaul':                  '^1.1.0',
  'react-hook-form':       '^7.53.0',
  '@hookform/resolvers':   '^3.9.0',
  'react-day-picker':      '^9.0.0',
  'recharts':              '^2.12.0',
  'embla-carousel-react':  '^8.3.0',
  'input-otp':             '^1.2.0',
  'react-resizable-panels':'^2.1.0',
  // Radix UI primitives — generated shadcn/ui code commonly imports
  // a subset of these. Versions tracked at v1 LTS line.
  '@radix-ui/react-accordion':       '^1.2.0',
  '@radix-ui/react-alert-dialog':    '^1.1.0',
  '@radix-ui/react-aspect-ratio':    '^1.1.0',
  '@radix-ui/react-avatar':          '^1.1.0',
  '@radix-ui/react-checkbox':        '^1.1.0',
  '@radix-ui/react-collapsible':     '^1.1.0',
  '@radix-ui/react-context-menu':    '^2.2.0',
  '@radix-ui/react-dialog':          '^1.1.0',
  '@radix-ui/react-dropdown-menu':   '^2.1.0',
  '@radix-ui/react-hover-card':      '^1.1.0',
  '@radix-ui/react-label':           '^2.1.0',
  '@radix-ui/react-menubar':         '^1.1.0',
  '@radix-ui/react-navigation-menu': '^1.2.0',
  '@radix-ui/react-popover':         '^1.1.0',
  '@radix-ui/react-progress':        '^1.1.0',
  '@radix-ui/react-radio-group':     '^1.2.0',
  '@radix-ui/react-scroll-area':     '^1.2.0',
  '@radix-ui/react-select':          '^2.1.0',
  '@radix-ui/react-separator':       '^1.1.0',
  '@radix-ui/react-slider':          '^1.2.0',
  '@radix-ui/react-slot':            '^1.1.0',
  '@radix-ui/react-switch':          '^1.1.0',
  '@radix-ui/react-tabs':            '^1.1.0',
  '@radix-ui/react-toast':           '^1.2.0',
  '@radix-ui/react-toggle':          '^1.1.0',
  '@radix-ui/react-toggle-group':    '^1.1.0',
  '@radix-ui/react-tooltip':         '^1.1.0',
  // Auth
  'next-auth':             '^4.24.0',
  '@auth/core':            '^0.37.0',
  'jsonwebtoken':          '^9.0.0',
  'bcryptjs':              '^2.4.3',
  // Misc runtime
  'dotenv':                '^16.4.0',
  'nanoid':                '^5.0.0',
  'uuid':                  '^11.0.0',
  'date-fns':              '^4.1.0',
  'pino':                  '^9.5.0',
  // Test
  'vitest':                '^2.1.0',
  'jest':                  '^29.7.0',
  '@testing-library/react': '^16.0.0',
  // TS toolchain (typescript / tsx versions owned by the bundle).
  // Types (peer-coupled @types/react / @types/react-dom owned by bundle)
  '@types/node':           '^22.0.0',
  '@types/express':        '^5.0.0',
  '@types/jsonwebtoken':   '^9.0.0',
  '@types/bcryptjs':       '^2.4.0',
};

/** dev-only packages get added under devDependencies. */
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
  /^tailwindcss$/,
];

// Same regex set used by import-integrity.ts — kept local so this module
// is self-contained.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractSpecifiers(src: string): string[] {
  const out: string[] = [];
  const cleaned = stripComments(src);
  for (const m of cleaned.matchAll(/\bimport\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of cleaned.matchAll(/\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of cleaned.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  for (const m of cleaned.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

/** Convert `@scope/pkg/sub/path` → `@scope/pkg`, `pkg/sub` → `pkg`. */
function packageNameOf(specifier: string): string | null {
  if (!specifier) return null;
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:') || specifier.startsWith('bun:')) return null;
  // tsconfig-paths style aliases (start with `~` or `@/`) are project-internal.
  if (specifier.startsWith('@/') || specifier.startsWith('~/')) return null;
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  const slash = specifier.indexOf('/');
  const name = slash === -1 ? specifier : specifier.slice(0, slash);
  if (NODE_BUILTINS.has(name)) return null;
  return name || null;
}

interface ParsedPkg {
  path: string;
  raw: string;
  json: Record<string, unknown>;
  /** Indentation string detected from the original file (defaults to "  "). */
  indent: string;
  /** True if original ended in a newline. */
  trailingNewline: boolean;
  /** Names declared anywhere in deps/devDeps/peerDeps/optionalDeps. */
  declared: Set<string>;
  /** This package's own name (so `import 'self'` is treated as satisfied). */
  ownName: string | null;
  /** Workspace package names declared via workspace: protocol. */
  workspaceNames: Set<string>;
}

function detectIndent(raw: string): string {
  const m = raw.match(/^(\s+)"/m);
  return m ? m[1] : '  ';
}

function parsePkg(file: FileLike): ParsedPkg | null {
  let json: Record<string, unknown>;
  try {
    json = JSON.parse(file.content);
  } catch {
    return null;
  }
  const declared = new Set<string>();
  const workspaceNames = new Set<string>();
  for (const key of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'] as const) {
    const block = json[key];
    if (block && typeof block === 'object') {
      for (const [name, ver] of Object.entries(block as Record<string, string>)) {
        declared.add(name);
        if (typeof ver === 'string' && (ver.startsWith('workspace:') || ver.startsWith('portal:') || ver.startsWith('link:') || ver.startsWith('file:'))) {
          workspaceNames.add(name);
        }
      }
    }
  }
  return {
    path: file.path,
    raw: file.content,
    json,
    indent: detectIndent(file.content),
    trailingNewline: file.content.endsWith('\n'),
    declared,
    ownName: typeof json.name === 'string' ? json.name : null,
    workspaceNames,
  };
}

/** Find the closest package.json above a given source path. */
function findHostPkg(sourcePath: string, pkgs: ParsedPkg[]): ParsedPkg | null {
  // Normalize separators.
  const norm = sourcePath.replace(/\\/g, '/');
  const segs = norm.split('/');
  // Walk up the directory tree: for each prefix, look for an exact pkg.json.
  for (let i = segs.length - 1; i >= 0; i--) {
    const dir = segs.slice(0, i).join('/');
    const candidate = dir ? `${dir}/package.json` : 'package.json';
    const found = pkgs.find((p) => p.path.replace(/\\/g, '/') === candidate);
    if (found) return found;
  }
  return null;
}

function detectPackageManager(files: FileLike[], rootPkg: ParsedPkg | null): DependencyValidationReport['packageManager'] {
  for (const f of files) {
    const lower = f.path.toLowerCase().replace(/\\/g, '/');
    if (lower.endsWith('/pnpm-lock.yaml') || lower === 'pnpm-lock.yaml' || lower.endsWith('/pnpm-workspace.yaml') || lower === 'pnpm-workspace.yaml') return 'pnpm';
    if (lower.endsWith('/yarn.lock') || lower === 'yarn.lock') return 'yarn';
    if (lower.endsWith('/package-lock.json') || lower === 'package-lock.json') return 'npm';
  }
  const pm = rootPkg?.json.packageManager;
  if (typeof pm === 'string') {
    if (pm.startsWith('pnpm')) return 'pnpm';
    if (pm.startsWith('yarn')) return 'yarn';
    if (pm.startsWith('npm')) return 'npm';
  }
  return 'unknown';
}

function pickVersion(name: string): string {
  // Bundle pins win over the legacy KNOWN_VERSIONS table when both
  // exist — the bundle is curated for cross-package peer compatibility,
  // KNOWN_VERSIONS is the older flat table kept for packages outside
  // the bundle's scope (db drivers, auth helpers, etc.).
  const bundlePin = REACT_18_NEXT_15.versions[name];
  if (bundlePin) return bundlePin;
  const knownPin = KNOWN_VERSIONS[name];
  if (knownPin) return knownPin;
  // "latest" is intentionally NOT used for peer-sensitive packages —
  // those are all in the bundle. Anything that falls through here is
  // a leaf utility (e.g. `dotenv`, `uuid`) where "latest" is safe.
  return 'latest';
}

/** Public lookup: pinned version for a given npm package name from the
 *  curated `KNOWN_VERSIONS` table, or `'latest'` if no curated pin
 *  exists. Used by the preview-side forced-dependency-fix injector
 *  (preview-dependency-preflight.applyForcedDependencyFix) so a
 *  preview-detected missing module is added with the SAME version
 *  the generator-side validator would have used. */
export function pickKnownVersion(name: string): string {
  return pickVersion(name);
}

function isDevDep(name: string): boolean {
  return DEV_DEP_PATTERNS.some((rx) => rx.test(name));
}

/**
 * Insert `name: version` into the appropriate dependency block of pkg.json
 * while preserving formatting. Returns the new file contents.
 */
function addDependency(pkg: ParsedPkg, name: string, version: string, dev: boolean): string {
  const block = dev ? 'devDependencies' : 'dependencies';
  const json = JSON.parse(pkg.raw) as Record<string, unknown>;
  const existing = (json[block] as Record<string, string> | undefined) ?? {};
  existing[name] = version;
  // Sort alphabetically — matches npm/yarn/pnpm convention.
  const sorted: Record<string, string> = {};
  for (const k of Object.keys(existing).sort((a, b) => a.localeCompare(b))) sorted[k] = existing[k];
  json[block] = sorted;
  let out = JSON.stringify(json, null, pkg.indent);
  if (pkg.trailingNewline) out += '\n';
  return out;
}

/**
 * Validate every generated source file's bare-module imports against the
 * closest package.json and auto-fix any missing entries.
 */
export function validateAndFixDependencies(input: FileLike[]): DependencyValidationResult {
  const files = input.map((f) => ({ ...f }));
  const pkgFiles = files.filter((f) => f.path.replace(/\\/g, '/').endsWith('package.json'));
  const sourceFiles = files.filter((f) => SOURCE_EXT.test(f.path));

  const parsed: ParsedPkg[] = [];
  for (const f of pkgFiles) {
    const p = parsePkg(f);
    if (p) parsed.push(p);
  }

  // Names of all workspace packages (so siblings importing each other don't
  // get flagged as missing).
  const workspacePkgNames = new Set<string>();
  for (const p of parsed) if (p.ownName) workspacePkgNames.add(p.ownName);

  // Collect missing imports per host package.json.
  // Map<pkgPath, Map<depName, Set<importerPath>>>
  const missing = new Map<string, Map<string, Set<string>>>();
  const unresolvedNoHost = new Map<string, Set<string>>();
  let importCount = 0;

  for (const src of sourceFiles) {
    const host = findHostPkg(src.path, parsed);
    const specs = extractSpecifiers(src.content);
    for (const spec of specs) {
      const name = packageNameOf(spec);
      if (!name) continue;
      importCount++;
      // Skip workspace siblings.
      if (workspacePkgNames.has(name)) continue;
      if (!host) {
        if (!unresolvedNoHost.has(name)) unresolvedNoHost.set(name, new Set());
        unresolvedNoHost.get(name)!.add(src.path);
        continue;
      }
      // Skip self-import.
      if (host.ownName === name) continue;
      // Skip workspace-resolved deps.
      if (host.workspaceNames.has(name)) continue;
      if (host.declared.has(name)) continue;

      let perPkg = missing.get(host.path);
      if (!perPkg) { perPkg = new Map(); missing.set(host.path, perPkg); }
      let importers = perPkg.get(name);
      if (!importers) { importers = new Set(); perPkg.set(name, importers); }
      importers.add(src.path);
    }
  }

  // Apply fixes.
  const added: DependencyValidationReport['added'] = [];
  const patched: string[] = [];
  for (const [pkgPath, perPkg] of missing.entries()) {
    const pkg = parsed.find((p) => p.path === pkgPath);
    if (!pkg) continue;
    let currentRaw = pkg.raw;
    // Build a fresh ParsedPkg view so each addDependency call sees prior insertions.
    let view: ParsedPkg = { ...pkg, raw: currentRaw };
    for (const [name, importers] of perPkg.entries()) {
      const version = pickVersion(name);
      currentRaw = addDependency(view, name, version, isDevDep(name));
      view = { ...view, raw: currentRaw };
      added.push({
        packageJson: pkgPath,
        name,
        version,
        importedFrom: Array.from(importers).slice(0, 5), // cap noise
      });
    }
    // Write back into the files array.
    const idx = files.findIndex((f) => f.path === pkgPath);
    if (idx >= 0) files[idx] = { ...files[idx], content: currentRaw };
    patched.push(pkgPath);
  }

  const unresolved: DependencyValidationReport['unresolved'] = [];
  for (const [name, importers] of unresolvedNoHost.entries()) {
    unresolved.push({
      packageJson: null,
      name,
      importedFrom: Array.from(importers).slice(0, 5),
      reason: 'no enclosing package.json found in generated files',
    });
  }
  // Also surface any package.json we couldn't parse.
  for (const f of pkgFiles) {
    if (!parsed.find((p) => p.path === f.path)) {
      unresolved.push({
        packageJson: f.path,
        name: '(any)',
        importedFrom: [],
        reason: 'package.json failed to parse as JSON',
      });
    }
  }

  // ── Cross-package peer-compatibility reconciliation ──────────────
  // After auto-add has filled missing imports, run the stack
  // compatibility reconciler on every host package.json. This catches
  // the version-mismatch class of bugs that import scanning cannot
  // detect: e.g. root declares `react ^18` but imports nothing from
  // `react-dom` (Next.js apps don't), so auto-add never sees the
  // symbol — but `npm install` still pulls react-dom@latest as next's
  // peer and ERESOLVEs against react ^18. The reconciler force-adds
  // `react-dom` with the bundle's matching version.
  const reconciled: DependencyValidationReport['reconciled'] = [];
  for (const pkg of parsed) {
    // Re-read the current (possibly auto-added-to) view of this pkg.json.
    const idx = files.findIndex((f) => f.path === pkg.path);
    if (idx < 0) continue;
    const currentRaw = files[idx].content;
    let parsedJson: Record<string, unknown>;
    try { parsedJson = JSON.parse(currentRaw); } catch { continue; }
    const deps = (parsedJson.dependencies as Record<string, string> | undefined) ?? {};
    const devDeps = (parsedJson.devDependencies as Record<string, string> | undefined) ?? {};
    // Combined view (peerDeps/optionalDeps are not reconciled today).
    const combined = { ...deps, ...devDeps };
    const bundle = selectBundle({ dependencies: deps, devDependencies: devDeps });
    const result = reconcilePackageJson(combined, bundle);
    if (result.effects.length === 0) continue;
    // Apply effects: each affected package goes back into its correct
    // block (devDeps for @types/* etc, deps otherwise) per isDevDep.
    let workingRaw = currentRaw;
    let workingView: ParsedPkg = { ...pkg, raw: workingRaw };
    for (const effect of result.effects) {
      // If the package was already in deps/devDeps, addDependency
      // overwrites the existing pin in place. If it was missing, it
      // appends to the correct block.
      workingRaw = addDependency(workingView, effect.packageName, effect.newVersion, isDevDep(effect.packageName));
      workingView = { ...workingView, raw: workingRaw };
    }
    files[idx] = { ...files[idx], content: workingRaw };
    if (!patched.includes(pkg.path)) patched.push(pkg.path);
    reconciled.push({ packageJson: pkg.path, bundleId: result.bundleId, effects: result.effects });
  }

  // ── Inject the bundle's `overrides` block into the root package.json.
  // npm honours `overrides` for ALL transitive resolution \u2014 including
  // peer-pulled installs (e.g. next \u2192 react-dom). Without this block a
  // root that pins `react: ^18` but omits `react-dom` will silently
  // ERESOLVE when `next@15.5.x` auto-pulls `react-dom@19.x` (whose own
  // `react ^19` peer then conflicts with the root). The reconciler's
  // version rules don't fix this on their own because `react-dom` is
  // never imported directly in a typical Next project (Next imports it
  // for you). We always force the overrides block when the selected
  // bundle declares one and the root package.json does not already
  // pin the same versions. Idempotent: a second pass is a no-op.
  const rootPkgEntry = parsed.find(
    (p) => p.path === 'package.json' || p.path.replace(/\\/g, '/') === 'package.json',
  );
  if (rootPkgEntry) {
    const idx = files.findIndex((f) => f.path === rootPkgEntry.path);
    if (idx >= 0) {
      const currentRaw = files[idx].content;
      let parsedJson: Record<string, unknown> | null = null;
      try { parsedJson = JSON.parse(currentRaw) as Record<string, unknown>; } catch { /* skip */ }
      if (parsedJson) {
        const bundle = selectBundle({
          dependencies: parsedJson.dependencies as Record<string, string> | undefined,
          devDependencies: parsedJson.devDependencies as Record<string, string> | undefined,
        });
        const desiredOverrides = bundle.overrides;
        const existing = (parsedJson.overrides as Record<string, string> | undefined) ?? {};
        let mutated = false;
        const merged: Record<string, string> = { ...existing };
        const overrideEffects: RuleEffect[] = [];
        for (const [name, pin] of Object.entries(desiredOverrides)) {
          if (merged[name] !== pin) {
            overrideEffects.push({
              packageName: name,
              previousVersion: merged[name] ?? null,
              newVersion: pin,
              reason:
                `[bundle-overrides] forced npm override for ${name} \u2014 ` +
                `pins transitive resolution to bundle ${bundle.id} ` +
                `(prevents sub-deps from auto-pulling an incompatible major).`,
            });
            merged[name] = pin;
            mutated = true;
          }
        }
        if (mutated) {
          parsedJson.overrides = merged;
          let out = JSON.stringify(parsedJson, null, rootPkgEntry.indent);
          if (rootPkgEntry.trailingNewline) out += '\n';
          files[idx] = { ...files[idx], content: out };
          if (!patched.includes(rootPkgEntry.path)) patched.push(rootPkgEntry.path);
          // Merge override effects into the existing reconcile entry
          // for the root package.json so the audit log is single-source.
          const existingReconcile = reconciled.find((r) => r.packageJson === rootPkgEntry.path);
          if (existingReconcile) {
            existingReconcile.effects.push(...overrideEffects);
          } else {
            reconciled.push({
              packageJson: rootPkgEntry.path,
              bundleId: bundle.id,
              effects: overrideEffects,
            });
          }
        }
      }
    }
  }

  const rootPkg = parsed.find((p) => p.path === 'package.json' || p.path.replace(/\\/g, '/') === 'package.json') ?? null;
  const report: DependencyValidationReport = {
    imports: importCount,
    added,
    unresolved,
    patched,
    packageManager: detectPackageManager(files, rootPkg),
    reconciled,
  };

  return { files, report };
}

// ─────────────────────────────────────────────────────────────
// Audit-only variant — does NOT mutate any package.json.
//
// Used by the final-integrity gate to verify that every bare-module
// import in the generated source is already declared. Distinct from
// validateAndFixDependencies because:
//   • The gate runs AFTER all auto-fix passes; if anything is still
//     missing here, it's a genuine integrity bug and we want to fail
//     the project rather than silently add-and-pretend.
//   • The gate must be a pure function — no file mutation, no
//     side-effects on the caller's array. Returns ONLY a report.
// ─────────────────────────────────────────────────────────────

export interface DependencyAuditEntry {
  /** Package name as it would appear in dependencies. */
  name: string;
  /** Source files that import the package (capped to 5 for log noise). */
  importedFrom: string[];
  /** Path of the host package.json this entry was attributed to.
   *  `null` when no enclosing package.json could be located. */
  packageJson: string | null;
  /** Why the package was flagged. */
  reason:
    | 'imported-not-declared'
    | 'no-host-package-json'
    | 'package-json-parse-failed';
}

export interface DependencyAuditReport {
  /** Total bare-module imports inspected. */
  imports: number;
  /** Bare-module imports that have no matching declaration in their
   *  host package.json. Populated when an import statement references
   *  a package that was never added to dependencies / devDependencies /
   *  peerDependencies / optionalDependencies. */
  missing: DependencyAuditEntry[];
  /** package.json files we tried to read but couldn't parse — these
   *  are gate failures because we cannot prove integrity without
   *  successfully reading every host pkg.json. */
  unparseablePackageJsons: string[];
}

/**
 * Read-only audit. Returns the set of bare-module imports that are not
 * declared in the closest package.json. Empty `missing` + empty
 * `unparseablePackageJsons` ⇒ codebase is dependency-complete.
 */
export function auditDependencies(input: FileLike[]): DependencyAuditReport {
  const pkgFiles = input.filter((f) => f.path.replace(/\\/g, '/').endsWith('package.json'));
  const sourceFiles = input.filter((f) => SOURCE_EXT.test(f.path));

  const parsed: ParsedPkg[] = [];
  const unparseable: string[] = [];
  for (const f of pkgFiles) {
    const p = parsePkg(f);
    if (p) parsed.push(p);
    else unparseable.push(f.path);
  }

  const workspacePkgNames = new Set<string>();
  for (const p of parsed) if (p.ownName) workspacePkgNames.add(p.ownName);

  // Map<key, entry>. Key = `${pkgPath}::${name}` so the same package
  // missing from two host pkg.jsons reports as two distinct entries.
  const missingMap = new Map<string, DependencyAuditEntry>();
  let imports = 0;

  for (const src of sourceFiles) {
    const host = findHostPkg(src.path, parsed);
    const specs = extractSpecifiers(src.content);
    for (const spec of specs) {
      const name = packageNameOf(spec);
      if (!name) continue;
      imports++;
      if (workspacePkgNames.has(name)) continue;
      if (!host) {
        const key = `null::${name}`;
        const cur = missingMap.get(key);
        if (cur) {
          if (!cur.importedFrom.includes(src.path) && cur.importedFrom.length < 5) {
            cur.importedFrom.push(src.path);
          }
        } else {
          missingMap.set(key, {
            name,
            importedFrom: [src.path],
            packageJson: null,
            reason: 'no-host-package-json',
          });
        }
        continue;
      }
      if (host.ownName === name) continue;
      if (host.workspaceNames.has(name)) continue;
      if (host.declared.has(name)) continue;

      const key = `${host.path}::${name}`;
      const cur = missingMap.get(key);
      if (cur) {
        if (!cur.importedFrom.includes(src.path) && cur.importedFrom.length < 5) {
          cur.importedFrom.push(src.path);
        }
      } else {
        missingMap.set(key, {
          name,
          importedFrom: [src.path],
          packageJson: host.path,
          reason: 'imported-not-declared',
        });
      }
    }
  }

  return {
    imports,
    missing: Array.from(missingMap.values()),
    unparseablePackageJsons: unparseable,
  };
}

