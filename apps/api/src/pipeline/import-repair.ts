import { validateImportIntegrity, type MissingImport } from '../../../../packages/agent-core/src/import-integrity.js';
import { isTier1TestArtifactPath, normalizeArtifactPath } from './test-artifact-policy.js';

export interface ImportRepairFile {
  path: string;
  content: string;
  language?: string;
}

export interface ImportRepairedRecord {
  importer: string;
  from: string;
  to: string;
  strategy: 'rewrite';
}

export interface ImportRemovedRecord {
  importer: string;
  specifier: string;
  removedBindings: string[];
  strategy: 'remove-unused';
}

export interface ImportCreatedFileRecord {
  path: string;
  createdFor: { importer: string; specifier: string };
  strategy: 'create-stub' | 'create-barrel';
}

export interface ImportUnrecoverableRecord {
  importer: string;
  specifier: string;
  reason: string;
  triedPaths: string[];
}

export interface ImportIgnoredTestArtifactRecord {
  importer: string;
  specifier: string;
  reason: 'test-artifact-excluded';
}

export interface RuntimeImportViolationRecord {
  importer: string;
  specifier: string;
  reason: string;
  triedPaths: string[];
  phase: 'pre-repair' | 'post-repair';
}

export interface ImportRepairDiagnostics {
  importsRepaired: ImportRepairedRecord[];
  importsRemoved: ImportRemovedRecord[];
  filesCreatedForImports: ImportCreatedFileRecord[];
  unrecoverableImports: ImportUnrecoverableRecord[];
  testImportsIgnored: ImportIgnoredTestArtifactRecord[];
  testArtifactPathsMatched: string[];
  runtimeImportViolations: RuntimeImportViolationRecord[];
}

export interface ImportRepairResult {
  files: ImportRepairFile[];
  changed: boolean;
  diagnostics: ImportRepairDiagnostics;
}

export function runDeterministicImportRepair(files: ImportRepairFile[]): ImportRepairResult {
  const byPath = new Map(files.map((f) => [normalize(f.path), { ...f, path: normalize(f.path) }]));
  const diagnostics: ImportRepairDiagnostics = {
    importsRepaired: [],
    importsRemoved: [],
    filesCreatedForImports: [],
    unrecoverableImports: [],
    testImportsIgnored: [],
    testArtifactPathsMatched: [],
    runtimeImportViolations: [],
  };

  const bindingFixes = repairImportBindingMismatches(byPath);
  if (bindingFixes.changed) {
    for (const fix of bindingFixes.fixes) diagnostics.importsRepaired.push(fix);
  }

  const missing = validateImportIntegrity(Array.from(byPath.values()));
  if (missing.length === 0) {
    return { files: Array.from(byPath.values()), changed: bindingFixes.changed, diagnostics };
  }

  let changed = bindingFixes.changed;
  for (const item of missing) {
    const importerPath = normalize(item.importer);
    if (isGeneratedTestArtifact(importerPath)) {
      if (!diagnostics.testArtifactPathsMatched.includes(importerPath)) {
        diagnostics.testArtifactPathsMatched.push(importerPath);
      }
      diagnostics.testImportsIgnored.push({
        importer: importerPath,
        specifier: item.specifier,
        reason: 'test-artifact-excluded',
      });
      continue;
    }
    diagnostics.runtimeImportViolations.push({
      importer: importerPath,
      specifier: item.specifier,
      reason: 'missing-local-import-pre-repair',
      triedPaths: item.triedPaths,
      phase: 'pre-repair',
    });
    const importer = byPath.get(importerPath);
    if (!importer) {
      diagnostics.unrecoverableImports.push({
        importer: importerPath,
        specifier: item.specifier,
        reason: 'importer-missing',
        triedPaths: item.triedPaths,
      });
      continue;
    }
    if (!isLocalSpecifier(item.specifier)) {
      diagnostics.unrecoverableImports.push({
        importer: importerPath,
        specifier: item.specifier,
        reason: 'non-local-import',
        triedPaths: item.triedPaths,
      });
      continue;
    }

    const bindingInfo = inspectImportBindings(importer.content, item.specifier);
    const unusedRemoval = bindingInfo ? removeIfUnused(importer.content, item.specifier, bindingInfo.bindings) : null;
    if (unusedRemoval?.changed) {
      importer.content = unusedRemoval.content;
      byPath.set(importerPath, importer);
      diagnostics.importsRemoved.push({
        importer: importerPath,
        specifier: item.specifier,
        removedBindings: unusedRemoval.removedBindings,
        strategy: 'remove-unused',
      });
      changed = true;
      continue;
    }

    const rewrite = tryRewriteToCanonicalExistingPath(item, byPath);
    if (rewrite) {
      importer.content = rewrite.content;
      byPath.set(importerPath, importer);
      diagnostics.importsRepaired.push({
        importer: importerPath,
        from: item.specifier,
        to: rewrite.rewrittenSpecifier,
        strategy: 'rewrite',
      });
      changed = true;
      continue;
    }

    const createTarget = chooseSafeTarget(item, byPath);
    if (!createTarget) {
      diagnostics.unrecoverableImports.push({
        importer: importerPath,
        specifier: item.specifier,
        reason: 'unsafe-or-unresolvable-target',
        triedPaths: item.triedPaths,
      });
      continue;
    }
    if (!byPath.has(createTarget)) {
      const stub = buildStubModule(createTarget, bindingInfo?.bindings ?? []);
      byPath.set(createTarget, {
        path: createTarget,
        content: stub,
        language: createTarget.endsWith('.tsx') ? 'typescriptreact' : 'typescript',
      });
      diagnostics.filesCreatedForImports.push({
        path: createTarget,
        createdFor: { importer: importerPath, specifier: item.specifier },
        strategy: createTarget.endsWith('/index.ts') || createTarget.endsWith('/index.tsx') ? 'create-barrel' : 'create-stub',
      });
      changed = true;
    }
  }

  const remaining = validateImportIntegrity(Array.from(byPath.values()));
  for (const item of remaining) {
    if (isGeneratedTestArtifact(item.importer)) {
      const importerPath = normalize(item.importer);
      if (!diagnostics.testArtifactPathsMatched.includes(importerPath)) {
        diagnostics.testArtifactPathsMatched.push(importerPath);
      }
      if (!diagnostics.testImportsIgnored.some((x) => x.importer === item.importer && x.specifier === item.specifier)) {
        diagnostics.testImportsIgnored.push({
          importer: item.importer,
          specifier: item.specifier,
          reason: 'test-artifact-excluded',
        });
      }
      continue;
    }
    if (diagnostics.unrecoverableImports.some((x) => x.importer === item.importer && x.specifier === item.specifier)) continue;
    diagnostics.unrecoverableImports.push({
      importer: item.importer,
      specifier: item.specifier,
      reason: 'unresolved-after-repair',
      triedPaths: item.triedPaths,
    });
    diagnostics.runtimeImportViolations.push({
      importer: item.importer,
      specifier: item.specifier,
      reason: 'unresolved-after-repair',
      triedPaths: item.triedPaths,
      phase: 'post-repair',
    });
  }

  diagnostics.testArtifactPathsMatched.sort();

  return { files: Array.from(byPath.values()), changed, diagnostics };
}

function normalize(path: string): string {
  return normalizeArtifactPath(path);
}

function isGeneratedTestArtifact(path: string): boolean {
  return isTier1TestArtifactPath(path);
}

function isLocalSpecifier(specifier: string): boolean {
  return specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/');
}

function inspectImportBindings(
  source: string,
  specifier: string,
): { bindings: string[] } | null {
  const statement = findImportStatementForSpecifier(source, specifier);
  if (!statement) return null;
  const escaped = escapeRegExp(specifier);
  const re = new RegExp(`^\\s*import\\s+([\\s\\S]*?)\\s+from\\s+['"]${escaped}['"]\\s*;?\\s*$`);
  const match = re.exec(statement.trim());
  if (!match) return null;
  const head = match[1].trim();
  if (!head) return { bindings: [] };

  const bindings: string[] = [];
  const namespace = head.match(/^\*\s+as\s+([A-Za-z_$][\w$]*)$/);
  if (namespace) {
    bindings.push(namespace[1]);
    return { bindings };
  }
  const split = head.split(',').map((x) => x.trim()).filter(Boolean);
  if (split.length > 0 && !split[0].startsWith('{')) bindings.push(split[0]);
  const namedBlock = head.match(/\{([^}]+)\}/);
  if (namedBlock) {
    const raw = namedBlock[1].split(',').map((s) => s.trim()).filter(Boolean);
    for (const token of raw) {
      const alias = token.match(/^(.*?)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (alias) bindings.push(alias[2]);
      else bindings.push(token);
    }
  }
  return { bindings: bindings.filter(Boolean) };
}

function findImportStatementForSpecifier(source: string, specifier: string): string | null {
  const lines = source.split(/\r?\n/);
  const quotedA = `'${specifier}'`;
  const quotedB = `"${specifier}"`;
  let acc: string[] = [];
  let collecting = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!collecting) {
      if (!trimmed.startsWith('import ')) continue;
      collecting = true;
      acc = [line];
    } else {
      acc.push(line);
    }

    const chunk = acc.join('\n');
    const mentionsTarget =
      chunk.includes(`from ${quotedA}`)
      || chunk.includes(`from ${quotedB}`)
      || chunk.includes(`from${quotedA}`)
      || chunk.includes(`from${quotedB}`);
    const looksComplete = /;\s*$/.test(trimmed) || mentionsTarget;
    if (!looksComplete) continue;
    if (mentionsTarget) return chunk;
    collecting = false;
    acc = [];
  }

  return null;
}

function removeIfUnused(
  source: string,
  specifier: string,
  bindings: string[],
): { changed: boolean; content: string; removedBindings: string[] } | null {
  if (bindings.length === 0) return null;
  const escaped = escapeRegExp(specifier);
  const importRe = new RegExp(`^\\s*import\\s+[\\s\\S]*?\\s+from\\s+['"]${escaped}['"];?\\s*$`, 'gm');
  const withoutImport = source.replace(importRe, '');
  const allUnused = bindings.every((binding) => {
    const used = new RegExp(`\\b${escapeRegExp(binding)}\\b`, 'g').test(withoutImport);
    return !used;
  });
  if (!allUnused) return null;
  const replaced = source.replace(importRe, '').replace(/\n{3,}/g, '\n\n');
  if (replaced === source) return null;
  return {
    changed: true,
    content: replaced,
    removedBindings: bindings,
  };
}

function tryRewriteToCanonicalExistingPath(
  item: MissingImport,
  byPath: Map<string, ImportRepairFile>,
): { rewrittenSpecifier: string; content: string } | null {
  const importer = normalize(item.importer);
  const importerDir = importer.includes('/') ? importer.slice(0, importer.lastIndexOf('/')) : '';
  const importerRooted = importer.startsWith('src/');
  const srcImporter = importerRooted ? importer : importer.startsWith('app/') ? `src/${importer}` : importer;
  if (!srcImporter.startsWith('src/')) return null;
  const srcDir = srcImporter.slice(0, srcImporter.lastIndexOf('/'));

  const pathCandidates = item.triedPaths
    .map((p) => normalize(p))
    .filter(Boolean)
    .map((p) => (p.startsWith('src/') ? p : `src/${p}`));
  const existing = pathCandidates.find((p) => byPath.has(p));
  if (!existing) return null;

  const rel = toRelativeSpecifier(srcDir, existing);
  if (!rel) return null;

  const importerFile = byPath.get(importer);
  if (!importerFile) return null;
  const escaped = escapeRegExp(item.specifier);
  const rewritten = importerFile.content.replace(
    new RegExp(`(['"])${escaped}\\1`, 'g'),
    `'${rel}'`,
  );
  if (rewritten === importerFile.content) return null;
  return { rewrittenSpecifier: rel, content: rewritten };
}

function chooseSafeTarget(
  item: MissingImport,
  byPath: Map<string, ImportRepairFile>,
): string | null {
  const normalized = item.triedPaths.map((p) => normalize(p)).filter(Boolean);
  const augmented = [...normalized];
  if (item.specifier.startsWith('@/')) {
    const tail = normalize(item.specifier.slice(2));
    for (const root of ['src', 'apps/web/src']) {
      augmented.push(`${root}/${tail}`);
      augmented.push(`${root}/${tail}.ts`);
      augmented.push(`${root}/${tail}.tsx`);
      augmented.push(`${root}/${tail}.js`);
    }
  }
  const deduped = Array.from(new Set(augmented));
  const preferredExt = ['.tsx', '.ts', '.jsx', '.js'];
  for (const ext of preferredExt) {
    for (const path of deduped) {
      if (!path.endsWith(ext)) continue;
      if (isSafeCreatePath(path, byPath)) return path;
    }
  }
  const fallback = deduped[0] ?? null;
  if (!fallback) return null;
  const withExt = /\.[A-Za-z0-9]+$/.test(fallback) ? fallback : `${fallback}.ts`;
  return isSafeCreatePath(withExt, byPath) ? withExt : null;
}

function isSafeCreatePath(path: string, byPath: Map<string, ImportRepairFile>): boolean {
  if (path.includes('node_modules/') || path.includes('..')) return false;
  if (!/\.(tsx?|jsx?)$/.test(path)) return false;
  if (path.startsWith('src/components/') || path.startsWith('src/app/') || path.startsWith('src/lib/')) return true;
  if (path.startsWith('apps/api/src/routes/')) return false;
  return false;
}

function buildStubModule(path: string, bindings: string[]): string {
  const named = bindings.filter((b) => b !== 'default');
  const isJsx = path.endsWith('.tsx') || path.endsWith('.jsx');
  const lines: string[] = [
    '// Deterministic import-repair stub.',
    '// Safe placeholder emitted to satisfy recoverable local imports.',
  ];
  if (isJsx) {
    lines.push("import type { ReactNode } from 'react';");
  }
  if (named.length === 0) {
    lines.push('const stub: any = {};');
    lines.push('export default stub;');
    return `${lines.join('\n')}\n`;
  }
  for (const name of named) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) continue;
    if (/^[A-Z]/.test(name) && isJsx) {
      lines.push(`export function ${name}({ children }: { children?: ReactNode } = {}): ReactNode {`);
      lines.push('  return children ?? null;');
      lines.push('}');
      continue;
    }
    lines.push(`export const ${name}: any = undefined;`);
  }
  lines.push('const stub: any = {};');
  lines.push('export default stub;');
  return `${lines.join('\n')}\n`;
}

function toRelativeSpecifier(fromDir: string, toPath: string): string | null {
  const from = fromDir.split('/').filter(Boolean);
  const to = toPath.split('/').filter(Boolean);
  while (from.length > 0 && to.length > 0 && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  const up = from.map(() => '..');
  const out = [...up, ...to].join('/');
  if (!out) return null;
  return out.startsWith('.') ? out : `./${out}`;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function repairImportBindingMismatches(byPath: Map<string, ImportRepairFile>): {
  changed: boolean;
  fixes: ImportRepairedRecord[];
} {
  const exportCache = new Map<string, { hasDefault: boolean; named: Set<string> }>();
  const fixes: ImportRepairedRecord[] = [];
  let changed = false;

  for (const [path, file] of byPath.entries()) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    const repaired = rewriteBindingMismatchesInSource(path, file.content, byPath, exportCache);
    if (!repaired.changed) continue;
    file.content = repaired.content;
    byPath.set(path, file);
    fixes.push(...repaired.fixes);
    changed = true;
  }

  return { changed, fixes };
}

function rewriteBindingMismatchesInSource(
  importerPath: string,
  source: string,
  byPath: Map<string, ImportRepairFile>,
  exportCache: Map<string, { hasDefault: boolean; named: Set<string> }>,
): { changed: boolean; content: string; fixes: ImportRepairedRecord[] } {
  const fixes: ImportRepairedRecord[] = [];
  let changed = false;
  const importerDir = importerPath.includes('/') ? importerPath.slice(0, importerPath.lastIndexOf('/')) : '';

  const replaced = source.replace(
    /(^\s*import\s+)([\s\S]*?)(\s+from\s+)(['"])([^'"]+)\4(\s*;?)/gm,
    (full, lead: string, clause: string, fromPart: string, quote: string, specifier: string, suffix: string) => {
      if (!isLocalSpecifier(specifier)) return full;
      if (clause.includes('* as')) return full;
      if (clause.trim().startsWith('type ')) return full;

      const target = resolveExistingImportTarget(importerDir, specifier, byPath);
      if (!target) return full;
      const exports = readModuleExports(target, byPath, exportCache);

      const namedOnly = clause.match(/^\s*\{([^}]+)\}\s*$/);
      if (namedOnly) {
        const tokens = namedOnly[1].split(',').map((t) => t.trim()).filter(Boolean);
        if (tokens.length !== 1) return full;
        const parsed = parseNamedToken(tokens[0] ?? '');
        if (!parsed) return full;
        if (exports.named.has(parsed.imported)) return full;
        if (!exports.hasDefault) return full;
        const nextClause = parsed.local;
        changed = true;
        fixes.push({
          importer: importerPath,
          from: `${specifier}::{${parsed.imported}}`,
          to: `${specifier}::default(${parsed.local})`,
          strategy: 'rewrite',
        });
        return `${lead}${nextClause}${fromPart}${quote}${specifier}${quote}${suffix}`;
      }

      const defaultOnly = clause.match(/^\s*([A-Za-z_$][\w$]*)\s*$/);
      if (defaultOnly) {
        const local = defaultOnly[1];
        if (exports.hasDefault) return full;
        if (!exports.named.has(local)) return full;
        const nextClause = `{ ${local} }`;
        changed = true;
        fixes.push({
          importer: importerPath,
          from: `${specifier}::default(${local})`,
          to: `${specifier}::{${local}}`,
          strategy: 'rewrite',
        });
        return `${lead}${nextClause}${fromPart}${quote}${specifier}${quote}${suffix}`;
      }

      return full;
    },
  );

  return { changed, content: replaced, fixes };
}

function parseNamedToken(token: string): { imported: string; local: string } | null {
  const alias = token.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
  if (alias) {
    return { imported: alias[1], local: alias[2] };
  }
  const direct = token.match(/^([A-Za-z_$][\w$]*)$/);
  if (!direct) return null;
  return { imported: direct[1], local: direct[1] };
}

function resolveExistingImportTarget(
  importerDir: string,
  specifier: string,
  byPath: Map<string, ImportRepairFile>,
): string | null {
  const candidates = resolveLocalSpecifierCandidates(importerDir, specifier);
  for (const candidate of candidates) {
    if (byPath.has(candidate)) return candidate;
  }
  return null;
}

function resolveLocalSpecifierCandidates(importerDir: string, specifier: string): string[] {
  const bases: string[] = [];
  if (specifier.startsWith('@/')) {
    const tail = normalize(specifier.slice(2));
    bases.push(joinPosix('src', tail));
    bases.push(joinPosix('apps/web/src', tail));
  } else {
    bases.push(resolvePosix(importerDir, specifier));
  }

  const out: string[] = [];
  for (const base of bases) {
    out.push(base);
    out.push(`${base}.ts`);
    out.push(`${base}.tsx`);
    out.push(`${base}.js`);
    out.push(`${base}.jsx`);
    out.push(joinPosix(base, 'index.ts'));
    out.push(joinPosix(base, 'index.tsx'));
    out.push(joinPosix(base, 'index.js'));
    out.push(joinPosix(base, 'index.jsx'));
  }
  return Array.from(new Set(out.map((p) => normalize(p)).filter(Boolean)));
}

function resolvePosix(fromDir: string, relative: string): string {
  const from = fromDir.split('/').filter(Boolean);
  const rel = relative.split('/').filter(Boolean);
  const stack = [...from];
  for (const part of rel) {
    if (part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

function joinPosix(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  return `${a.replace(/\/+$/, '')}/${b.replace(/^\/+/, '')}`;
}

function readModuleExports(
  targetPath: string,
  byPath: Map<string, ImportRepairFile>,
  exportCache: Map<string, { hasDefault: boolean; named: Set<string> }>,
): { hasDefault: boolean; named: Set<string> } {
  const cached = exportCache.get(targetPath);
  if (cached) return cached;
  const file = byPath.get(targetPath);
  const content = file?.content ?? '';
  const hasDefault = /\bexport\s+default\b/.test(content);
  const named = new Set<string>();

  for (const match of content.matchAll(/\bexport\s+(?:const|function|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/g)) {
    named.add(match[1]);
  }
  for (const match of content.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    const members = match[1].split(',').map((m) => m.trim()).filter(Boolean);
    for (const member of members) {
      const aliased = member.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
      if (aliased) {
        named.add(aliased[2]);
        continue;
      }
      const direct = member.match(/^([A-Za-z_$][\w$]*)$/);
      if (direct) named.add(direct[1]);
    }
  }

  const result = { hasDefault, named };
  exportCache.set(targetPath, result);
  return result;
}
