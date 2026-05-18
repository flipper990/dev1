import * as ts from 'typescript';
import type { PromptTierClassification } from './prompt-tier-classifier.js';
import { isAllowedPathForTier } from './tier-policy.js';
import { normalizeArtifactPath } from './test-artifact-policy.js';

export interface TierSliceManifest {
  path: string;
  content: string;
  imports: string[];
  exports: string[];
  dependencies: string[];
  purpose: string;
}

export interface TierValidationIssue {
  code:
    | 'forbidden_path'
    | 'empty_content'
    | 'ts_parse'
    | 'css_syntax'
    | 'unresolved_import'
    | 'missing_named_export';
  message: string;
}

function checkCssSyntax(content: string): boolean {
  let open = 0;
  for (const ch of content) {
    if (ch === '{') open += 1;
    if (ch === '}') open -= 1;
    if (open < 0) return false;
  }
  return open === 0;
}

function tryParseTs(path: string, content: string): boolean {
  const isTsx = path.endsWith('.tsx');
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  };
  if (isTsx) compilerOptions.jsx = ts.JsxEmit.Preserve;
  const transpiled = ts.transpileModule(content, {
    fileName: path,
    reportDiagnostics: true,
    compilerOptions,
  });
  const diagnostics = transpiled.diagnostics ?? [];
  return !diagnostics.some((d: ts.Diagnostic) => d.category === ts.DiagnosticCategory.Error);
}

function resolveInternalImport(importPath: string, fromPath: string): string {
  if (importPath.startsWith('@/')) return `src/${importPath.slice(2)}`;
  if (importPath.startsWith('./') || importPath.startsWith('../')) {
    const from = normalizeArtifactPath(fromPath).split('/');
    from.pop();
    for (const part of importPath.split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') from.pop();
      else from.push(part);
    }
    return from.join('/');
  }
  return importPath;
}

function possibleCandidates(basePath: string): string[] {
  const out = new Set<string>();
  out.add(basePath);
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) out.add(`${basePath}${ext}`);
  for (const ext of ['.ts', '.tsx', '.js', '.jsx']) out.add(`${basePath}/index${ext}`);
  return [...out];
}

function parseImportedSymbols(importPath: string, content: string): string[] {
  const escaped = importPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`import\\s+([^;]+?)\\s+from\\s+['\"]${escaped}['\"]`, 'g');
  const out: string[] = [];
  for (const m of content.matchAll(re)) {
    const clause = String(m[1] ?? '').trim();
    const namedMatch = clause.match(/\{([^}]+)\}/);
    if (namedMatch) {
      const parts = namedMatch[1]
        .split(',')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => x.split(/\s+as\s+/i)[0] ?? x)
        .map((x) => x.trim())
        .filter(Boolean);
      out.push(...parts);
    }
  }
  return out;
}

export function validateSliceManifest(
  tier: PromptTierClassification,
  manifest: TierSliceManifest,
  acceptedSlices: TierSliceManifest[],
): TierValidationIssue[] {
  const issues: TierValidationIssue[] = [];
  const path = normalizeArtifactPath(manifest.path);

  if (!isAllowedPathForTier(tier, path)) {
    issues.push({ code: 'forbidden_path', message: `${path} not allowed for ${tier}` });
  }
  if (!manifest.content.trim()) {
    issues.push({ code: 'empty_content', message: `${path} content is empty` });
    return issues;
  }

  if (/\.(ts|tsx)$/.test(path) && !tryParseTs(path, manifest.content)) {
    issues.push({ code: 'ts_parse', message: `${path} has TypeScript parse errors` });
  }
  if (/\.css$/.test(path) && !checkCssSyntax(manifest.content)) {
    issues.push({ code: 'css_syntax', message: `${path} has unbalanced CSS braces` });
  }

  const known = new Map<string, TierSliceManifest>();
  for (const item of acceptedSlices) known.set(normalizeArtifactPath(item.path), item);
  known.set(path, manifest);

  for (const dep of manifest.imports) {
    if (!(dep.startsWith('./') || dep.startsWith('../') || dep.startsWith('@/'))) continue;
    const resolved = resolveInternalImport(dep, path);
    const targetPath = possibleCandidates(resolved).find((candidate) => known.has(normalizeArtifactPath(candidate)));
    if (!targetPath) {
      issues.push({ code: 'unresolved_import', message: `${path} unresolved import: ${dep}` });
      continue;
    }

    const target = known.get(normalizeArtifactPath(targetPath));
    if (!target) continue;
    const importedNames = parseImportedSymbols(dep, manifest.content);
    for (const name of importedNames) {
      if (!target.exports.includes(name)) {
        issues.push({ code: 'missing_named_export', message: `${path} imports ${name} from ${dep}, but export is missing` });
      }
    }
  }

  return issues;
}
