// ─────────────────────────────────────────────────────────────
// Import-integrity validator — static check that every relative
// import in TS/TSX/JS/JSX files resolves to an emitted file.
//
// LLM builders sometimes hallucinate imports (e.g. `import { TaskList }
// from './components/TaskList'` without ever emitting that file). This
// catches those before the runtime validator wastes a 90-second docker
// boot to discover a 500 from Next.js.
// ─────────────────────────────────────────────────────────────

import type { FileLike } from './agent-input-builder';

export interface MissingImport {
  /** File that contains the bad import. */
  importer: string;
  /** Raw specifier as written in the source. */
  specifier: string;
  /** Resolved candidate paths we tried (relative to project root). */
  triedPaths: string[];
}

export interface ValidateImportIntegrityOptions {
  /** Optional importer-path filter to skip known non-critical files. */
  ignoreImporter?: (importerPath: string) => boolean;
  /** Optional alias roots for "@/..." resolution. */
  aliasRoots?: string[];
}

const SOURCE_EXT = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/i;
const RESOLVE_EXTS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

// Strip line/block comments naively (good enough — false-positives are harmless).
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

function extractImportSpecifiers(src: string): string[] {
  const out: string[] = [];
  const cleaned = stripComments(src);

  // ES imports: `import ... from 'x'` and side-effect `import 'x'`
  for (const m of cleaned.matchAll(/\bimport\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) {
    out.push(m[1]);
  }
  // Re-exports: `export ... from 'x'`
  for (const m of cleaned.matchAll(/\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g)) {
    out.push(m[1]);
  }
  // Dynamic imports: `import('x')`
  for (const m of cleaned.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push(m[1]);
  }
  // CommonJS: `require('x')`
  for (const m of cleaned.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    out.push(m[1]);
  }
  return out;
}

function dirname(p: string): string {
  const i = p.lastIndexOf('/');
  return i < 0 ? '' : p.slice(0, i);
}

function normalize(p: string): string {
  const segs: string[] = [];
  for (const part of p.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') segs.pop();
    else segs.push(part);
  }
  return segs.join('/');
}

function resolveCandidates(importer: string, spec: string): string[] {
  const base = dirname(importer);
  const joined = normalize(`${base}/${spec}`);
  const candidates: string[] = [];
  // Exact
  candidates.push(joined);
  // With extensions
  for (const ext of RESOLVE_EXTS) candidates.push(`${joined}${ext}`);
  // index files
  for (const ext of RESOLVE_EXTS) candidates.push(`${joined}/index${ext}`);
  return candidates;
}

/**
 * Statically validate that every relative import in source files resolves to
 * an emitted file. Bare-module imports (`react`, `next/link`, `@radix-ui/...`)
 * are assumed to be installable npm packages and are not checked here — the
 * runtime build catches those via package.json install.
 *
 * Path-mapped imports starting with `@/` are heuristically resolved against
 * common roots (apps/web, apps/api, src, .) since we don't parse tsconfig
 * paths. False-positives are filtered out by checking ALL candidate roots.
 */
export function validateImportIntegrity(
  files: FileLike[],
  options: ValidateImportIntegrityOptions = {},
): MissingImport[] {
  const fileSet = new Set(files.map((f) => f.path.replace(/\\/g, '/').replace(/^\.\//, '')));
  const missing: MissingImport[] = [];
  const ignoreImporter = options.ignoreImporter;

  // Possible roots for `@/...` aliases — match if any candidate root resolves.
  const aliasRoots = Array.isArray(options.aliasRoots) && options.aliasRoots.length > 0
    ? options.aliasRoots
    : ['apps/web', 'apps/api', 'apps/web/src', 'apps/api/src', 'src', ''];

  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    if (!SOURCE_EXT.test(path)) continue;
    if (ignoreImporter && ignoreImporter(path)) continue;

    const specs = extractImportSpecifiers(f.content);
    for (const spec of specs) {
      // Skip bare specifiers (npm packages).
      if (!spec.startsWith('.') && !spec.startsWith('/') && !spec.startsWith('@/')) continue;
      // Skip CSS / asset imports — Next.js / bundler concern, not a missing-file issue.
      if (/\.(?:css|scss|sass|less|png|jpe?g|gif|svg|webp|ico|json|md|mdx|woff2?|ttf)$/i.test(spec)) continue;

      let candidates: string[];
      if (spec.startsWith('@/')) {
        const tail = spec.slice(2);
        candidates = aliasRoots.flatMap((root) => {
          const joined = root ? `${root}/${tail}` : tail;
          const all = [joined];
          for (const ext of RESOLVE_EXTS) all.push(`${joined}${ext}`);
          for (const ext of RESOLVE_EXTS) all.push(`${joined}/index${ext}`);
          return all;
        });
      } else {
        candidates = resolveCandidates(path, spec);
      }

      const hit = candidates.some((c) => fileSet.has(c));
      if (!hit) {
        missing.push({ importer: path, specifier: spec, triedPaths: candidates.slice(0, 4) });
      }
    }
  }

  return missing;
}

/**
 * Format missing-imports as ValidationIssue-shaped records suitable for
 * appending to a QA report so the existing rebuild loop picks them up.
 */
export function missingImportsAsIssues(missing: MissingImport[]): Array<{
  category: 'missing-import';
  severity: 'high';
  message: string;
  file: string;
}> {
  return missing.map((m) => ({
    category: 'missing-import' as const,
    severity: 'high' as const,
    message: `${m.importer} imports '${m.specifier}' but no matching file was emitted (tried: ${m.triedPaths.join(', ')}).`,
    file: m.importer,
  }));
}
