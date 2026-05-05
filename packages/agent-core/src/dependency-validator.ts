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
  // Frameworks
  'next':                  '^15.0.0',
  'react':                 '^18.3.0',
  'react-dom':             '^18.3.0',
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
  // UI
  'tailwindcss':           '^3.4.0',
  'autoprefixer':          '^10.4.20',
  'postcss':               '^8.4.0',
  'lucide-react':          '^0.460.0',
  'clsx':                  '^2.1.0',
  'class-variance-authority': '^0.7.0',
  'tailwind-merge':        '^2.5.0',
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
  // TS
  'typescript':            '^5.6.0',
  'tsx':                   '^4.19.0',
  // Types
  '@types/node':           '^22.0.0',
  '@types/react':          '^18.3.0',
  '@types/react-dom':      '^18.3.0',
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
  return KNOWN_VERSIONS[name] ?? 'latest';
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

  const rootPkg = parsed.find((p) => p.path === 'package.json' || p.path.replace(/\\/g, '/') === 'package.json') ?? null;
  const report: DependencyValidationReport = {
    imports: importCount,
    added,
    unresolved,
    patched,
    packageManager: detectPackageManager(files, rootPkg),
  };

  return { files, report };
}
