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
    | 'missing_named_export'
    | 'react_hook_wrong_source'
    | 'component_prop_mismatch';
  message: string;
}

const API_CLIENT_IMPORT_SPECIFIER = '@/lib/api-client';
const SUPPORTED_API_CLIENT_EXPORTS = new Set([
  'apiFetch',
  'request',
  'getJson',
  'postJson',
  'fetcher',
  'apiClient',
]);
const REACT_HOOK_IMPORTS = new Set([
  'useEffect',
  'useState',
  'useMemo',
  'useCallback',
  'useRef',
  'useReducer',
  'useContext',
  'useTransition',
  'useDeferredValue',
  'useId',
]);

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

  const parsedImports = parseImportClauses(manifest.content);
  for (const parsedImport of parsedImports) {
    for (const symbol of parsedImport.named) {
      if (REACT_HOOK_IMPORTS.has(symbol) && parsedImport.specifier !== 'react') {
        issues.push({
          code: 'react_hook_wrong_source',
          message: `${path} imports React hook ${symbol} from ${parsedImport.specifier}; expected source is react`,
        });
      }
    }

    if (parsedImport.specifier === API_CLIENT_IMPORT_SPECIFIER) {
      for (const symbol of parsedImport.named) {
        if (!SUPPORTED_API_CLIENT_EXPORTS.has(symbol)) {
          issues.push({
            code: 'missing_named_export',
            message: `${path} imports ${symbol} from ${API_CLIENT_IMPORT_SPECIFIER}, but export is missing from canonical api-client contract`,
          });
        }
      }
    }
  }

  const componentPropIssues = detectComponentPropMismatches(path, manifest.content, known);
  issues.push(...componentPropIssues);

  return issues;
}

function parseImportClauses(content: string): Array<{ specifier: string; named: string[]; bindings: Array<{ localName: string; importedName: string }> }> {
  const out: Array<{ specifier: string; named: string[]; bindings: Array<{ localName: string; importedName: string }> }> = [];
  const importRe = /import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?/g;
  for (const match of content.matchAll(importRe)) {
    const clause = String(match[1] ?? '').trim();
    const specifier = String(match[2] ?? '').trim();
    if (!specifier) continue;
    const namedBlock = clause.match(/\{([\s\S]*?)\}/);
    const named = (namedBlock?.[1] ?? '')
      .split(',')
      .map((token) => token.trim())
      .filter(Boolean)
      .map((token) => token.replace(/^type\s+/, '').trim())
      .map((token) => {
        const alias = token.match(/^([A-Za-z_$][\w$]*)\s+as\s+[A-Za-z_$][\w$]*$/);
        return alias ? alias[1] : token;
      })
      .filter((token) => /^[A-Za-z_$][\w$]*$/.test(token));
    const bindings = parseComponentBindings(clause);
    out.push({ specifier, named, bindings });
  }
  return out;
}

function parseComponentBindings(clause: string): Array<{ localName: string; importedName: string }> {
  const out: Array<{ localName: string; importedName: string }> = [];
  const withoutNamed = clause.replace(/\{[\s\S]*?\}/, '').trim();
  const defaultPart = withoutNamed
    .split(',')
    .map((token) => token.trim())
    .find((token) => token && token !== 'type');
  if (defaultPart && /^[A-Za-z_$][\w$]*$/.test(defaultPart)) {
    out.push({ localName: defaultPart, importedName: 'default' });
  }

  const namedBlock = clause.match(/\{([\s\S]*?)\}/)?.[1] ?? '';
  for (const token of namedBlock.split(',').map((item) => item.trim()).filter(Boolean)) {
    const normalized = token.replace(/^type\s+/, '').trim();
    const alias = normalized.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
    if (alias) {
      out.push({ localName: alias[2], importedName: alias[1] });
      continue;
    }
    if (/^[A-Za-z_$][\w$]*$/.test(normalized)) {
      out.push({ localName: normalized, importedName: normalized });
    }
  }
  return out;
}

function detectComponentPropMismatches(
  failedFile: string,
  source: string,
  known: Map<string, TierSliceManifest>,
): TierValidationIssue[] {
  const out: TierValidationIssue[] = [];
  const imports = parseImportClauses(source)
    .filter((item) => item.specifier.startsWith('./') || item.specifier.startsWith('../') || item.specifier.startsWith('@/'));

  for (const item of imports) {
    const resolved = resolveInternalImport(item.specifier, failedFile);
    const targetPath = possibleCandidates(resolved).find((candidate) => known.has(normalizeArtifactPath(candidate)));
    if (!targetPath) continue;
    const target = known.get(normalizeArtifactPath(targetPath));
    if (!target) continue;

    for (const binding of item.bindings) {
      if (!/^[A-Z]/.test(binding.localName)) continue;
      const requiredProps = extractRequiredComponentProps(target.content, binding.importedName);
      if (requiredProps.length === 0) continue;

      for (const usage of findJsxUsages(source, binding.localName, failedFile)) {
        for (const prop of requiredProps) {
          if (new RegExp(`\\b${escapeRegExp(prop.name)}(?:\\s*=|\\s|$)`).test(usage.attributes)) continue;
          out.push({
            code: 'component_prop_mismatch',
            message:
              `${failedFile} renders <${binding.localName}> without required prop ${prop.name}; `
              + `[failedFile=${failedFile} componentName=${binding.localName} missingProp=${prop.name} propType=${prop.type} usageLocation=${usage.location} repairAttempted=false repairResult=failed]`,
          });
        }
      }
    }
  }

  return out;
}

function extractRequiredComponentProps(content: string, importedName: string): Array<{ name: string; type: string }> {
  if (importedName === 'default') return [];
  const escaped = escapeRegExp(importedName);
  const functionMatch = content.match(
    new RegExp(`(?:export\\s+)?function\\s+${escaped}\\s*\\(\\s*[\\s\\S]*?:\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, 'm'),
  );
  const constMatch = content.match(
    new RegExp(`(?:export\\s+)?const\\s+${escaped}\\s*=\\s*\\(\\s*[\\s\\S]*?:\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*=>`, 'm'),
  );
  const propsTypeName = functionMatch?.[1] ?? constMatch?.[1];
  if (!propsTypeName) return [];

  const body = extractTypeBody(content, propsTypeName);
  if (!body) return [];
  const required: Array<{ name: string; type: string }> = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    const propMatch = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*:\s*([^;]+);?$/);
    if (!propMatch || propMatch[2] === '?') continue;
    required.push({ name: propMatch[1], type: propMatch[3].trim() });
  }
  return required;
}

function extractTypeBody(content: string, typeName: string): string | null {
  const escaped = escapeRegExp(typeName);
  const interfaceMatch = content.match(new RegExp(`interface\\s+${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  if (interfaceMatch?.[1]) return interfaceMatch[1];
  const typeMatch = content.match(new RegExp(`type\\s+${escaped}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  return typeMatch?.[1] ?? null;
}

function findJsxUsages(source: string, componentName: string, failedFile: string): Array<{ attributes: string; location: string }> {
  const escaped = escapeRegExp(componentName);
  const usageRe = new RegExp(`<${escaped}\\b([^>]*)\\/?>`, 'g');
  const out: Array<{ attributes: string; location: string }> = [];
  for (const match of source.matchAll(usageRe)) {
    const idx = match.index ?? 0;
    const before = source.slice(0, idx);
    const line = before.split('\n').length;
    const col = idx - before.lastIndexOf('\n');
    out.push({ attributes: String(match[1] ?? ''), location: `${failedFile}:${line}:${col}` });
  }
  return out;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
