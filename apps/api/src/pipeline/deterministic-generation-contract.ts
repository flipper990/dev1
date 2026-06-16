import { validateImportIntegrity } from '../../../../packages/agent-core/src/import-integrity.js';
import { validatePackageJsonString } from '../../../../packages/agent-core/src/package-json-validator.js';
import { buildCanonicalPackageManifest } from './canonical-package-manifest.js';
import {
  classifyTier1RuntimeExclusion,
  isTier1BackendArtifactPath,
  isTier1TestArtifactPath,
  normalizeArtifactPath,
} from './test-artifact-policy.js';

export interface ContractFile {
  path: string;
  content: string;
  language?: string;
}

export interface GenerationManifestFile {
  path: string;
  bytes: number;
  kind: 'source' | 'config' | 'asset' | 'doc' | 'other';
}

export interface GenerationManifest {
  files: GenerationManifestFile[];
  routes: string[];
  components: string[];
  dependencies: string[];
}

export interface DeterministicContractResult {
  files: ContractFile[];
  addedPaths: string[];
  patchedPaths: string[];
  warnings: string[];
  blockingViolations: string[];
  testFilesDropped: string[];
  testFilesIgnored: string[];
  testImportViolations: Array<{ importer: string; specifier: string }>;
  testArtifactPathsMatched: string[];
  backendFilesDropped: string[];
  backendFilesIgnored: string[];
  backendImportViolations: Array<{ importer: string; specifier: string }>;
  backendArtifactPathsMatched: string[];
  runtimeImportViolations: Array<{ importer: string; specifier: string; triedPaths: string[] }>;
  importSourceViolations: Array<{
    failedFile: string;
    invalidImportName: string;
    importedFrom: string;
    expectedSource: string;
    repairAttempted: boolean;
    repairResult: 'repaired' | 'failed';
  }>;
  componentPropViolations: Array<{
    failedFile: string;
    componentName: string;
    missingProp: string;
    propType: string;
    usageLocation: string;
    repairAttempted: boolean;
    repairResult: 'repaired' | 'failed';
  }>;
  testArtifactPolicyReason: string;
  backendArtifactPolicyReason: string;
  manifest: GenerationManifest;
}

export interface DeterministicContractOptions {
  allowBackendRuntimeArtifacts?: boolean;
}

const FORBIDDEN_PLACEHOLDER_RE = /\b(TODO|FIXME|coming soon|being prepared|placeholder)\b/i;
const MAX_ALLOWED_FILE_BYTES = 300_000;
const SRC_CANONICAL_ROOTS = ['app/', 'components/', 'lib/', 'styles/', 'hooks/', 'types/', 'utils/'] as const;
const TEST_ARTIFACT_POLICY_REASON = 'tier1-runtime-excludes-generated-tests';
const BACKEND_ARTIFACT_POLICY_REASON = 'tier1-runtime-excludes-backend-artifacts';
const API_CLIENT_IMPORT_SPECIFIER = '@/lib/api-client';
const REACT_IMPORT_SPECIFIER = 'react';
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
const SUPPORTED_API_CLIENT_EXPORTS = new Set([
  'apiFetch',
  'request',
  'getJson',
  'postJson',
  'fetcher',
  'apiClient',
]);
const SAFE_OPTIONAL_CALLBACK_PROP_RE = /^(\(\s*.*\)\s*=>\s*void|(?:\w+\s*:\s*[^,]+)\s*=>\s*void|React\.[A-Za-z]+EventHandler<[^>]+>)$/;

export function enforceDeterministicGenerationContract(
  inputFiles: ContractFile[],
  options: DeterministicContractOptions = {},
): DeterministicContractResult {
  const allowBackendRuntimeArtifacts = options.allowBackendRuntimeArtifacts === true;
  const map = new Map<string, ContractFile>();
  for (const file of inputFiles) {
    const p = normalizePath(file.path);
    if (!p) continue;
    map.set(p, { ...file, path: p });
  }

  const addedPaths: string[] = [];
  const patchedPaths: string[] = [];
  const warnings: string[] = [];
  const blockingViolations: string[] = [];
  const testFilesDropped: string[] = [];
  const testFilesIgnored: string[] = [];
  const backendFilesDropped: string[] = [];
  const backendFilesIgnored: string[] = [];
  const testArtifactPathsMatched = new Set<string>();
  const backendArtifactPathsMatched = new Set<string>();
  const importSourceViolations: Array<{
    failedFile: string;
    invalidImportName: string;
    importedFrom: string;
    expectedSource: string;
    repairAttempted: boolean;
    repairResult: 'repaired' | 'failed';
  }> = [];
  const componentPropViolations: Array<{
    failedFile: string;
    componentName: string;
    missingProp: string;
    propType: string;
    usageLocation: string;
    repairAttempted: boolean;
    repairResult: 'repaired' | 'failed';
  }> = [];

  migrateToSrcLayout(map, patchedPaths, warnings);
  enforceReactHookImportSourceContract(map, patchedPaths, warnings, importSourceViolations);
  enforceApiClientImportExportContract(map, addedPaths, patchedPaths, warnings, blockingViolations);
  enforceComponentPropContract(map, patchedPaths, warnings, blockingViolations, componentPropViolations);
  const allMissingImports = validateImportIntegrity(Array.from(map.values()));
  const testImportViolations = allMissingImports
    .filter((miss) => isGeneratedTestArtifact(miss.importer))
    .map((miss) => {
      testArtifactPathsMatched.add(normalizePath(miss.importer));
      return { importer: miss.importer, specifier: miss.specifier };
    });
  const backendImportViolations = allMissingImports
    .filter((miss) => !allowBackendRuntimeArtifacts && isTier1BackendArtifact(miss.importer))
    .map((miss) => {
      backendArtifactPathsMatched.add(normalizePath(miss.importer));
      return { importer: miss.importer, specifier: miss.specifier };
    });
  const runtimeImportViolations = allMissingImports
    .filter((miss) => isRuntimeValidationPath(miss.importer, allowBackendRuntimeArtifacts))
    .map((miss) => ({ importer: miss.importer, specifier: miss.specifier, triedPaths: miss.triedPaths }));
  dropGeneratedTestArtifacts(map, warnings, testFilesDropped);
  testFilesIgnored.push(...testFilesDropped);
  for (const path of testFilesDropped) testArtifactPathsMatched.add(normalizePath(path));
  if (!allowBackendRuntimeArtifacts) {
    dropTier1BackendArtifacts(map, warnings, backendFilesDropped);
    backendFilesIgnored.push(...backendFilesDropped);
    for (const path of backendFilesDropped) backendArtifactPathsMatched.add(normalizePath(path));
  }
  dedupeRepeatedSingleLineImports(map, patchedPaths, warnings);
  enforceClientDirectiveForHookFiles(map, patchedPaths, warnings);
  ensureRootConfig(map, addedPaths, patchedPaths, warnings);

  for (const [path, file] of map.entries()) {
    if (path.includes('..') || path.startsWith('/')) {
      blockingViolations.push(`forbidden path: ${path}`);
    }
    const bytes = Buffer.byteLength(file.content ?? '', 'utf8');
    if (bytes > MAX_ALLOWED_FILE_BYTES) {
      blockingViolations.push(`max-file-size exceeded: ${path} (${bytes} bytes)`);
    }
  }

  const missingImports = validateImportIntegrity(
    Array.from(map.values()).filter((f) => isRuntimeValidationPath(f.path, allowBackendRuntimeArtifacts)),
  );
  for (const miss of missingImports) {
    blockingViolations.push(`dangling internal import: ${miss.importer} -> '${miss.specifier}'`);
  }

  const criticalEntry = map.get('src/app/page.tsx');
  if (criticalEntry && FORBIDDEN_PLACEHOLDER_RE.test(criticalEntry.content)) {
    blockingViolations.push('placeholder content in src/app/page.tsx');
  }
  if (map.has('app/page.tsx') && map.has('src/app/page.tsx')) {
    warnings.push('mixed-layout: both app/page.tsx and src/app/page.tsx exist; src/app is canonical.');
  }

  const pkgContent = map.get('package.json')?.content;
  if (pkgContent) {
    const pkgValidation = validatePackageJsonString(pkgContent);
    if (!pkgValidation.ok) {
      for (const v of pkgValidation.violations) {
        if (v.severity === 'error') blockingViolations.push(`package.json violation: ${v.ruleId}: ${v.message}`);
        else warnings.push(`package.json warning: ${v.ruleId}: ${v.message}`);
      }
    }
  }

  const manifest = buildManifest(Array.from(map.values()));
  const manifestErr = validateManifest(manifest);
  if (manifestErr) blockingViolations.push(`manifest-schema: ${manifestErr}`);

  return {
    files: Array.from(map.values()),
    addedPaths,
    patchedPaths,
    warnings,
    blockingViolations,
    testFilesDropped,
    testFilesIgnored,
    testImportViolations,
    testArtifactPathsMatched: Array.from(testArtifactPathsMatched).sort(),
    backendFilesDropped,
    backendFilesIgnored,
    backendImportViolations,
    backendArtifactPathsMatched: Array.from(backendArtifactPathsMatched).sort(),
    runtimeImportViolations,
    importSourceViolations,
    componentPropViolations,
    testArtifactPolicyReason: TEST_ARTIFACT_POLICY_REASON,
    backendArtifactPolicyReason: BACKEND_ARTIFACT_POLICY_REASON,
    manifest,
  };
}

function isRuntimeValidationPath(path: string, allowBackendRuntimeArtifacts: boolean): boolean {
  const exclusion = classifyTier1RuntimeExclusion(path);
  if (exclusion == null) return true;
  if (allowBackendRuntimeArtifacts && exclusion === 'backend-runtime-artifact') return true;
  return false;
}

function enforceApiClientImportExportContract(
  map: Map<string, ContractFile>,
  addedPaths: string[],
  patchedPaths: string[],
  warnings: string[],
  blockingViolations: string[],
): void {
  const importDemand = new Map<string, Set<string>>();
  for (const [path, file] of map.entries()) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) continue;
    const names = extractNamedImportsForSpecifier(file.content ?? '', API_CLIENT_IMPORT_SPECIFIER);
    if (names.size === 0) continue;
    importDemand.set(path, names);
  }
  if (importDemand.size === 0) return;

  const requested = new Set<string>();
  for (const symbols of importDemand.values()) {
    for (const symbol of symbols) requested.add(symbol);
  }

  const unsupported = Array.from(requested).filter((name) => !SUPPORTED_API_CLIENT_EXPORTS.has(name));
  if (unsupported.length > 0) {
    for (const [importer, symbols] of importDemand.entries()) {
      const importerUnsupported = Array.from(symbols).filter((name) => unsupported.includes(name));
      if (importerUnsupported.length === 0) continue;
      for (const invalidImportName of importerUnsupported) {
        blockingViolations.push(
          `import/export mismatch: ${importer} imports {${invalidImportName}} from '${API_CLIENT_IMPORT_SPECIFIER}' but deterministic contract cannot synthesize these exports. `
          + `[failedFile=${importer} invalidImportName=${invalidImportName} importedFrom=${API_CLIENT_IMPORT_SPECIFIER} expectedSource=${API_CLIENT_IMPORT_SPECIFIER} repairAttempted=true repairResult=failed]`,
        );
      }
    }
  }

  const candidatePaths = [
    'src/lib/api-client.ts',
    'src/lib/api-client.tsx',
    'src/lib/api-client.js',
    'lib/api-client.ts',
    'lib/api-client.tsx',
    'lib/api-client.js',
  ];
  const hasSrcLayout = Array.from(map.keys()).some((path) => path.startsWith('src/'));
  const canonicalPath =
    candidatePaths.find((path) => map.has(path))
    ?? (hasSrcLayout ? 'src/lib/api-client.ts' : 'lib/api-client.ts');

  const existing = map.get(canonicalPath);
  if (!existing) {
    map.set(canonicalPath, {
      path: canonicalPath,
      content: canonicalApiClientModule(),
      language: canonicalPath.endsWith('.js') ? 'javascript' : 'typescript',
    });
    addedPaths.push(canonicalPath);
    warnings.push(`added canonical api-client module: ${canonicalPath}`);
    return;
  }

  const patch = buildApiClientPatch(existing.content ?? '');
  if (!patch.changed) return;
  map.set(canonicalPath, { ...existing, content: patch.content });
  patchedPaths.push(canonicalPath);
  warnings.push(`patched api-client contract exports: ${canonicalPath} (${patch.added.join(', ')})`);
}

function extractNamedImportsForSpecifier(source: string, specifier: string): Set<string> {
  const out = new Set<string>();
  const declarations = collectImportDeclarations(source).filter((decl) => decl.specifier === specifier);
  for (const decl of declarations) {
    for (const token of splitNamedImportTokens(decl.clause)) {
      const parsed = parseNamedToken(token);
      if (!parsed || parsed.isTypeOnly) continue;
      out.add(parsed.importedName);
    }
  }
  return out;
}

function enforceReactHookImportSourceContract(
  map: Map<string, ContractFile>,
  patchedPaths: string[],
  warnings: string[],
  importSourceViolations: Array<{
    failedFile: string;
    invalidImportName: string;
    importedFrom: string;
    expectedSource: string;
    repairAttempted: boolean;
    repairResult: 'repaired' | 'failed';
  }>,
): void {
  for (const [path, file] of Array.from(map.entries())) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) continue;
    const repaired = repairReactHookImportSources(file.content ?? '', path, importSourceViolations);
    if (!repaired.changed) continue;
    map.set(path, { ...file, content: repaired.content });
    patchedPaths.push(path);
    warnings.push(`repaired react hook import sources to '${REACT_IMPORT_SPECIFIER}': ${path}`);
  }
}

function repairReactHookImportSources(
  source: string,
  failedFile: string,
  importSourceViolations: Array<{
    failedFile: string;
    invalidImportName: string;
    importedFrom: string;
    expectedSource: string;
    repairAttempted: boolean;
    repairResult: 'repaired' | 'failed';
  }>,
): { content: string; changed: boolean } {
  let changed = false;
  const movedReactHooks = new Set<string>();
  const out = source.replace(
    /(^\s*import\s+)([\s\S]*?)(\s+from\s+)(['"])([^'"]+)\4(\s*;?)/gm,
    (full, lead: string, clause: string, fromPart: string, quote: string, specifier: string, suffix: string) => {
      if (specifier === REACT_IMPORT_SPECIFIER) return full;
      if (!(specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('@/'))) return full;

      const namedTokens = splitNamedImportTokens(clause);
      if (namedTokens.length === 0) return full;

      const keptNamed: string[] = [];
      const movedNamed: string[] = [];
      for (const token of namedTokens) {
        const parsed = parseNamedToken(token);
        if (!parsed) {
          keptNamed.push(token);
          continue;
        }
        if (parsed.isTypeOnly || !REACT_HOOK_IMPORTS.has(parsed.importedName)) {
          keptNamed.push(token);
          continue;
        }
        movedNamed.push(parsed.asReactImportToken);
        importSourceViolations.push({
          failedFile,
          invalidImportName: parsed.importedName,
          importedFrom: specifier,
          expectedSource: REACT_IMPORT_SPECIFIER,
          repairAttempted: true,
          repairResult: 'repaired',
        });
      }

      if (movedNamed.length === 0) return full;
      for (const token of movedNamed) movedReactHooks.add(token);

      const withoutNamed = clause.replace(/\{[\s\S]*?\}/, '').replace(/,\s*$/, '').trim();
      const nextParts: string[] = [];
      if (withoutNamed) nextParts.push(withoutNamed);
      if (keptNamed.length > 0) nextParts.push(`{ ${keptNamed.join(', ')} }`);
      changed = true;
      if (nextParts.length === 0) return '';
      return `${lead}${nextParts.join(', ')}${fromPart}${quote}${specifier}${quote}${suffix || ';'}`;
    },
  );

  if (movedReactHooks.size === 0) {
    return { content: out, changed };
  }
  const merged = ensureReactNamedImports(out, Array.from(movedReactHooks));
  return { content: merged.content, changed: changed || merged.changed };
}

function ensureReactNamedImports(
  source: string,
  reactNamedImports: string[],
): { content: string; changed: boolean } {
  if (reactNamedImports.length === 0) return { content: source, changed: false };
  const reactImportRe = /(^\s*import\s+)([\s\S]*?)(\s+from\s+)(['"])react\4(\s*;?)/m;
  const match = reactImportRe.exec(source);
  if (match) {
    const clause = String(match[2] ?? '');
    const existingNamed = splitNamedImportTokens(clause);
    const mergedNamed = dedupeNamedImportTokens([...existingNamed, ...reactNamedImports]);
    const withoutNamed = clause.replace(/\{[\s\S]*?\}/, '').replace(/,\s*$/, '').trim();
    const nextParts: string[] = [];
    if (withoutNamed) nextParts.push(withoutNamed);
    if (mergedNamed.length > 0) nextParts.push(`{ ${mergedNamed.join(', ')} }`);
    const rewritten = `${match[1]}${nextParts.join(', ')}${match[3]}${match[4]}react${match[4]}${match[5] || ';'}`;
    if (rewritten === match[0]) return { content: source, changed: false };
    return {
      content: source.slice(0, match.index) + rewritten + source.slice(match.index + match[0].length),
      changed: true,
    };
  }

  const injected = `import { ${dedupeNamedImportTokens(reactNamedImports).join(', ')} } from 'react';\n`;
  const directive = source.match(/^(['"]use (?:client|server)['"];\s*\r?\n+)/);
  if (directive) {
    const at = directive[0].length;
    return { content: `${source.slice(0, at)}${injected}${source.slice(at)}`, changed: true };
  }
  return { content: `${injected}${source}`, changed: true };
}

function enforceComponentPropContract(
  map: Map<string, ContractFile>,
  patchedPaths: string[],
  warnings: string[],
  blockingViolations: string[],
  componentPropViolations: Array<{
    failedFile: string;
    componentName: string;
    missingProp: string;
    propType: string;
    usageLocation: string;
    repairAttempted: boolean;
    repairResult: 'repaired' | 'failed';
  }>,
): void {
  const repairedKeys = new Set<string>();
  const seenBlocking = new Set<string>();

  for (const [importerPath, importerFile] of Array.from(map.entries())) {
    if (!/\.(tsx?|jsx?)$/.test(importerPath)) continue;
    const importerSource = importerFile.content ?? '';
    const imports = parseLocalComponentImports(importerSource);
    if (imports.length === 0) continue;

    for (const item of imports) {
      const resolved = resolveLocalSpecifier(importerPath, item.specifier);
      const targetPath = resolveExistingSourcePath(map, resolved);
      if (!targetPath) continue;
      const targetFile = map.get(targetPath);
      if (!targetFile) continue;

      const componentName = item.importedName;
      if (!/^[A-Z]/.test(componentName)) continue;
      const contract = extractComponentContract(targetFile.content ?? '', componentName);
      if (!contract) continue;

      const usages = findComponentUsages(importerSource, item.localName, importerPath);
      if (usages.length === 0) continue;

      for (const usage of usages) {
        for (const requiredProp of contract.requiredProps) {
          if (hasJsxProp(usage.attributes, requiredProp.name)) continue;
          const violationBase = {
            failedFile: importerPath,
            componentName: item.localName,
            missingProp: requiredProp.name,
            propType: requiredProp.type,
            usageLocation: usage.location,
          };
          const repairKey = `${targetPath}::${componentName}::${requiredProp.name}`;

          if (requiredProp.isSafeCallback && !repairedKeys.has(repairKey)) {
            const repaired = makeComponentCallbackPropOptional(
              targetFile.content ?? '',
              componentName,
              contract.propsTypeName,
              requiredProp,
            );
            if (repaired.repaired) {
              map.set(targetPath, { ...targetFile, content: repaired.content });
              patchedPaths.push(targetPath);
              warnings.push(
                `repaired component callback prop contract: ${targetPath} ${requiredProp.name} -> optional preview-safe callback`,
              );
              repairedKeys.add(repairKey);
              componentPropViolations.push({
                ...violationBase,
                repairAttempted: true,
                repairResult: 'repaired',
              });
              continue;
            }
          }

          const blockingKey = `${violationBase.failedFile}::${violationBase.componentName}::${violationBase.missingProp}::${violationBase.usageLocation}`;
          if (!seenBlocking.has(blockingKey)) {
            seenBlocking.add(blockingKey);
            const repairAttempted = requiredProp.isSafeCallback;
            const repairResult = repairAttempted ? 'failed' : 'failed';
            blockingViolations.push(
              `generated_component_prop_mismatch: ${importerPath} renders <${item.localName}> without required prop '${requiredProp.name}'. `
              + `[failedFile=${importerPath} componentName=${item.localName} missingProp=${requiredProp.name} propType=${requiredProp.type} usageLocation=${usage.location} repairAttempted=${repairAttempted} repairResult=${repairResult}]`,
            );
            componentPropViolations.push({
              ...violationBase,
              repairAttempted,
              repairResult: 'failed',
            });
          }
        }
      }
    }
  }
}

interface LocalComponentImport {
  localName: string;
  importedName: string;
  specifier: string;
}

interface RequiredComponentProp {
  name: string;
  type: string;
  isSafeCallback: boolean;
}

interface ComponentContract {
  componentName: string;
  propsTypeName: string;
  requiredProps: RequiredComponentProp[];
}

interface ComponentUsage {
  attributes: string;
  location: string;
}

function parseLocalComponentImports(source: string): LocalComponentImport[] {
  const out: LocalComponentImport[] = [];
  const declarations = collectImportDeclarations(source);
  for (const decl of declarations) {
    if (!(decl.specifier.startsWith('./') || decl.specifier.startsWith('../') || decl.specifier.startsWith('@/'))) continue;
    const clause = decl.clause.trim();
    if (!clause) continue;

    const withoutNamed = clause.replace(/\{[\s\S]*?\}/, '').trim();
    const defaultPart = withoutNamed
      .split(',')
      .map((token) => token.trim())
      .find((token) => token && token !== 'type');
    if (defaultPart && /^[A-Za-z_$][\w$]*$/.test(defaultPart)) {
      out.push({
        localName: defaultPart,
        importedName: 'default',
        specifier: decl.specifier,
      });
    }

    for (const token of splitNamedImportTokens(clause)) {
      const parsed = parseNamedToken(token);
      if (!parsed || parsed.isTypeOnly) continue;
      out.push({
        localName: parsed.localName,
        importedName: parsed.importedName,
        specifier: decl.specifier,
      });
    }
  }
  return out;
}

function resolveLocalSpecifier(importerPath: string, specifier: string): string {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
  if (!(specifier.startsWith('./') || specifier.startsWith('../'))) return specifier;
  const parts = normalizePath(importerPath).split('/');
  parts.pop();
  for (const part of specifier.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

function resolveExistingSourcePath(map: Map<string, ContractFile>, basePath: string): string | null {
  const candidates = [
    basePath,
    `${basePath}.ts`,
    `${basePath}.tsx`,
    `${basePath}.js`,
    `${basePath}.jsx`,
    `${basePath}/index.ts`,
    `${basePath}/index.tsx`,
    `${basePath}/index.js`,
    `${basePath}/index.jsx`,
  ];
  for (const candidate of candidates) {
    const normalized = normalizePath(candidate);
    if (map.has(normalized)) return normalized;
  }
  return null;
}

function extractComponentContract(source: string, componentName: string): ComponentContract | null {
  const escaped = escapeRegExp(componentName);
  const functionMatch = source.match(
    new RegExp(`(?:export\\s+)?function\\s+${escaped}\\s*\\(\\s*[\\s\\S]*?:\\s*([A-Za-z_$][\\w$]*)\\s*\\)`, 'm'),
  );
  const constMatch = source.match(
    new RegExp(`(?:export\\s+)?const\\s+${escaped}\\s*=\\s*\\(\\s*[\\s\\S]*?:\\s*([A-Za-z_$][\\w$]*)\\s*\\)\\s*=>`, 'm'),
  );
  const propsTypeName = functionMatch?.[1] ?? constMatch?.[1];
  if (!propsTypeName) return null;

  const requiredProps = extractRequiredPropsFromType(source, propsTypeName);
  if (requiredProps.length === 0) return null;
  return { componentName, propsTypeName, requiredProps };
}

function extractRequiredPropsFromType(source: string, propsTypeName: string): RequiredComponentProp[] {
  const escaped = escapeRegExp(propsTypeName);
  const interfaceMatch = source.match(new RegExp(`interface\\s+${escaped}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  const typeMatch = source.match(new RegExp(`type\\s+${escaped}\\s*=\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  const body = interfaceMatch?.[1] ?? typeMatch?.[1];
  if (!body) return [];

  const requiredProps: RequiredComponentProp[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('//')) continue;
    const propMatch = line.match(/^(?:readonly\s+)?([A-Za-z_$][\w$]*)(\??)\s*:\s*([^;]+);?$/);
    if (!propMatch) continue;
    if (propMatch[2] === '?') continue;
    const propType = propMatch[3].trim();
    requiredProps.push({
      name: propMatch[1],
      type: propType,
      isSafeCallback: /^on[A-Z]/.test(propMatch[1]) && SAFE_OPTIONAL_CALLBACK_PROP_RE.test(propType),
    });
  }
  return requiredProps;
}

function findComponentUsages(source: string, componentName: string, failedFile: string): ComponentUsage[] {
  const escaped = escapeRegExp(componentName);
  const usageRe = new RegExp(`<${escaped}\\b([^>]*)\\/?>`, 'g');
  const out: ComponentUsage[] = [];
  for (const match of source.matchAll(usageRe)) {
    const index = match.index ?? 0;
    const before = source.slice(0, index);
    const line = before.split('\n').length;
    const column = index - before.lastIndexOf('\n');
    out.push({
      attributes: String(match[1] ?? ''),
      location: `${failedFile}:${line}:${column}`,
    });
  }
  return out;
}

function hasJsxProp(attributeText: string, propName: string): boolean {
  const escaped = escapeRegExp(propName);
  return new RegExp(`\\b${escaped}(?:\\s*=|\\s|$)`).test(attributeText);
}

function makeComponentCallbackPropOptional(
  source: string,
  componentName: string,
  propsTypeName: string,
  prop: RequiredComponentProp,
): { content: string; repaired: boolean } {
  let content = source;
  let changed = false;
  const escapedProp = escapeRegExp(prop.name);
  const escapedType = escapeRegExp(propsTypeName);
  const lineRe = new RegExp(
    `((?:^|\\n)\\s*(?:readonly\\s+)?${escapedProp})\\s*:\\s*([^;\\n]+);`,
    'm',
  );
  const scopedInterfaceRe = new RegExp(`(interface\\s+${escapedType}\\s*\\{[\\s\\S]*?)${lineRe.source}`, 'm');
  if (scopedInterfaceRe.test(content)) {
    content = content.replace(scopedInterfaceRe, (_full, prefix: string, _linePrefix: string, propType: string) => {
      changed = true;
      return `${prefix}\n  ${prop.name}?: ${propType.trim()};`;
    });
  } else {
    const scopedTypeRe = new RegExp(`(type\\s+${escapedType}\\s*=\\s*\\{[\\s\\S]*?)${lineRe.source}`, 'm');
    if (scopedTypeRe.test(content)) {
      content = content.replace(scopedTypeRe, (_full, prefix: string, _linePrefix: string, propType: string) => {
        changed = true;
        return `${prefix}\n  ${prop.name}?: ${propType.trim()};`;
      });
    }
  }
  if (!changed) return { content: source, repaired: false };

  const escapedComponent = escapeRegExp(componentName);
  const defaultExpr = `${prop.name} = () => {}`;
  const functionParamRe = new RegExp(
    `((?:export\\s+)?function\\s+${escapedComponent}\\s*\\(\\s*\\{[\\s\\S]*?)\\b${escapedProp}\\b(?!\\s*=)([\\s\\S]*?\\}\\s*:\\s*${escapedType}\\s*\\))`,
    'm',
  );
  const constParamRe = new RegExp(
    `((?:export\\s+)?const\\s+${escapedComponent}\\s*=\\s*\\(\\s*\\{[\\s\\S]*?)\\b${escapedProp}\\b(?!\\s*=)([\\s\\S]*?\\}\\s*:\\s*${escapedType}\\s*\\)\\s*=>)`,
    'm',
  );
  if (functionParamRe.test(content)) {
    content = content.replace(functionParamRe, `$1${defaultExpr}$2`);
  } else if (constParamRe.test(content)) {
    content = content.replace(constParamRe, `$1${defaultExpr}$2`);
  }

  return { content, repaired: true };
}

function collectImportDeclarations(source: string): Array<{ clause: string; specifier: string }> {
  const out: Array<{ clause: string; specifier: string }> = [];
  const lines = source.split(/\r?\n/);
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
    const complete = /;\s*$/.test(trimmed) || /\bfrom\s+['"][^'"]+['"]\s*$/.test(trimmed);
    if (!complete) continue;

    const parsed = chunk.match(/^\s*import\s+([\s\S]*?)\s+from\s+['"]([^'"]+)['"]\s*;?\s*$/m);
    if (parsed) {
      out.push({ clause: parsed[1]?.trim() ?? '', specifier: parsed[2] ?? '' });
    }
    collecting = false;
    acc = [];
  }

  return out;
}

function splitNamedImportTokens(clause: string): string[] {
  const match = clause.match(/\{([\s\S]*?)\}/);
  if (!match) return [];
  return (match[1] ?? '')
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseNamedToken(token: string): {
  importedName: string;
  localName: string;
  isTypeOnly: boolean;
  asReactImportToken: string;
} | null {
  const typeOnly = /^type\s+/.test(token);
  const normalized = token.replace(/^type\s+/, '').trim();
  const alias = normalized.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
  if (alias) {
    return {
      importedName: alias[1],
      localName: alias[2],
      isTypeOnly: typeOnly,
      asReactImportToken: `${alias[1]} as ${alias[2]}`,
    };
  }
  const direct = normalized.match(/^([A-Za-z_$][\w$]*)$/);
  if (!direct) return null;
  return {
    importedName: direct[1],
    localName: direct[1],
    isTypeOnly: typeOnly,
    asReactImportToken: direct[1],
  };
}

function dedupeNamedImportTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of tokens) {
    const key = token.replace(/\s+/g, ' ').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
  }
  return out;
}

function hasExportSymbol(source: string, symbol: string): boolean {
  const escaped = escapeRegExp(symbol);
  return (
    new RegExp(`export\\s+(?:async\\s+)?function\\s+${escaped}\\b`).test(source)
    || new RegExp(`export\\s+const\\s+${escaped}\\b`).test(source)
    || new RegExp(`export\\s+\\{[^}]*\\b${escaped}\\b[^}]*\\}`).test(source)
  );
}

function buildApiClientPatch(original: string): { changed: boolean; content: string; added: string[] } {
  const added: string[] = [];
  const chunks: string[] = [];
  const source = original;

  const hasApiFetch = hasExportSymbol(source, 'apiFetch');
  const hasRequest = hasExportSymbol(source, 'request');
  const hasGetJson = hasExportSymbol(source, 'getJson');
  const hasPostJson = hasExportSymbol(source, 'postJson');
  const hasFetcher = hasExportSymbol(source, 'fetcher');
  const hasApiClient = hasExportSymbol(source, 'apiClient');
  const hasDefault = /\bexport\s+default\b/.test(source);

  if (!hasApiFetch) {
    chunks.push(
      [
        "const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';",
        '',
        'export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {',
        "  const target = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;",
        '  const res = await fetch(target, {',
        "    ...init,",
        "    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },",
        "    cache: 'no-store',",
        '  });',
        '  if (!res.ok) {',
        '    const text = await res.text();',
        "    throw new Error(`API ${res.status}: ${text}`);",
        '  }',
        '  return (await res.json()) as T;',
        '}',
      ].join('\n'),
    );
    added.push('apiFetch');
  }
  if (!hasRequest) {
    chunks.push(
      [
        "export async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {",
        '  return apiFetch<T>(path, init);',
        '}',
      ].join('\n'),
    );
    added.push('request');
  }
  if (!hasGetJson) {
    chunks.push(
      [
        "export async function getJson<T = unknown>(path: string): Promise<T> {",
        "  return request<T>(path, { method: 'GET' });",
        '}',
      ].join('\n'),
    );
    added.push('getJson');
  }
  if (!hasPostJson) {
    chunks.push(
      [
        'export async function postJson<T = unknown>(path: string, body?: unknown): Promise<T> {',
        "  return request<T>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) });",
        '}',
      ].join('\n'),
    );
    added.push('postJson');
  }
  if (!hasFetcher) {
    chunks.push(
      [
        'export async function fetcher<T = unknown>(path: string): Promise<T> {',
        '  return getJson<T>(path);',
        '}',
      ].join('\n'),
    );
    added.push('fetcher');
  }
  if (!hasApiClient) {
    chunks.push("export const apiClient = { apiFetch, request, getJson, postJson, fetcher };");
    added.push('apiClient');
  }
  if (!hasDefault) {
    chunks.push('export default apiClient;');
    added.push('default');
  }

  if (chunks.length === 0) return { changed: false, content: original, added };
  const separator = original.endsWith('\n') ? '' : '\n';
  const content = `${original}${separator}\n${chunks.join('\n\n')}\n`;
  return { changed: true, content, added };
}

function canonicalApiClientModule(): string {
  return [
    "const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';",
    '',
    'export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {',
    "  const target = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;",
    '  const res = await fetch(target, {',
    '    ...init,',
    "    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },",
    "    cache: 'no-store',",
    '  });',
    '  if (!res.ok) {',
    '    const text = await res.text();',
    "    throw new Error(`API ${res.status}: ${text}`);",
    '  }',
    '  return (await res.json()) as T;',
    '}',
    '',
    "export async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {",
    '  return apiFetch<T>(path, init);',
    '}',
    '',
    "export async function getJson<T = unknown>(path: string): Promise<T> {",
    "  return request<T>(path, { method: 'GET' });",
    '}',
    '',
    'export async function postJson<T = unknown>(path: string, body?: unknown): Promise<T> {',
    "  return request<T>(path, { method: 'POST', body: body == null ? undefined : JSON.stringify(body) });",
    '}',
    '',
    'export async function fetcher<T = unknown>(path: string): Promise<T> {',
    '  return getJson<T>(path);',
    '}',
    '',
    'export const apiClient = { apiFetch, request, getJson, postJson, fetcher };',
    'export default apiClient;',
    '',
  ].join('\n');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePath(path: string): string {
  return normalizeArtifactPath(path);
}

function upsert(
  map: Map<string, ContractFile>,
  path: string,
  content: string,
  language: string | undefined,
  addedPaths: string[],
  patchedPaths: string[],
): void {
  const existing = map.get(path);
  if (!existing) {
    map.set(path, { path, content, language });
    addedPaths.push(path);
    return;
  }
  if (existing.content !== content) {
    map.set(path, { ...existing, content, language: existing.language ?? language });
    patchedPaths.push(path);
  }
}

function migrateToSrcLayout(
  map: Map<string, ContractFile>,
  patchedPaths: string[],
  warnings: string[],
): void {
  const hasSrc = Array.from(map.keys()).some((p) => p.startsWith('src/'));
  if (!hasSrc) return;

  const roots = SRC_CANONICAL_ROOTS;
  for (const [path, file] of Array.from(map.entries())) {
    const root = roots.find((r) => path.startsWith(r));
    if (!root) continue;
    const target = `src/${path}`;
    if (!map.has(target)) map.set(target, { ...file, path: target });
    patchedPaths.push(target);
    map.delete(path);
    warnings.push(`canonicalized root file to src/: ${path} -> ${target}`);
  }
}

function isGeneratedTestArtifact(path: string): boolean {
  return isTier1TestArtifactPath(path);
}

function isTier1BackendArtifact(path: string): boolean {
  return isTier1BackendArtifactPath(path);
}

function dropGeneratedTestArtifacts(
  map: Map<string, ContractFile>,
  warnings: string[],
  dropped: string[],
): void {
  for (const path of Array.from(map.keys())) {
    if (!isGeneratedTestArtifact(path)) continue;
    map.delete(path);
    dropped.push(path);
    warnings.push(`dropped generated test artifact: ${path}`);
  }
}

function dropTier1BackendArtifacts(
  map: Map<string, ContractFile>,
  warnings: string[],
  dropped: string[],
): void {
  for (const path of Array.from(map.keys())) {
    if (!isTier1BackendArtifact(path)) continue;
    map.delete(path);
    dropped.push(path);
    warnings.push(`dropped tier1 backend runtime artifact: ${path}`);
  }
}

function dedupeRepeatedSingleLineImports(
  map: Map<string, ContractFile>,
  patchedPaths: string[],
  warnings: string[],
): void {
  for (const [path, file] of Array.from(map.entries())) {
    if (!/\.(tsx?|jsx?|mjs|cjs)$/.test(path)) continue;

    const lines = (file.content ?? '').split(/\r?\n/);
    const seen = new Set<string>();
    const kept: string[] = [];
    let removed = 0;

    for (const line of lines) {
      const normalizedImport = normalizeSingleLineImport(line);
      if (!normalizedImport) {
        kept.push(line);
        continue;
      }
      if (seen.has(normalizedImport)) {
        removed++;
        continue;
      }
      seen.add(normalizedImport);
      kept.push(line);
    }

    if (removed === 0) continue;
    map.set(path, { ...file, content: kept.join('\n') });
    patchedPaths.push(path);
    warnings.push(`removed ${removed} duplicate import declaration(s): ${path}`);
  }
}

function normalizeSingleLineImport(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('import ')) return null;
  if (!trimmed.includes(';')) return null;
  if (!/\bfrom\s+['"][^'"]+['"]\s*;?$/.test(trimmed) && !/^import\s+['"][^'"]+['"]\s*;?$/.test(trimmed)) {
    return null;
  }
  return trimmed.replace(/\s+/g, ' ');
}

function enforceClientDirectiveForHookFiles(
  map: Map<string, ContractFile>,
  patchedPaths: string[],
  warnings: string[],
): void {
  const HOOK_RE =
    /\b(?:React\.)?(?:useState|useEffect|useContext|useReducer|useRef|useLayoutEffect|useMemo|useCallback|useId)\s*\(/;
  for (const [path, file] of Array.from(map.entries())) {
    if (!/\.(tsx?|jsx?)$/.test(path)) continue;
    if (!path.startsWith('src/')) continue;
    const content = file.content ?? '';
    if (!HOOK_RE.test(content)) continue;
    const trimmed = content.trimStart();
    if (trimmed.startsWith("'use client'") || trimmed.startsWith('"use client"')) continue;
    const next = `'use client';\n\n${content}`;
    map.set(path, { ...file, content: next });
    patchedPaths.push(path);
    warnings.push(`added use client directive for hook-based component: ${path}`);
  }
}

function ensureRootConfig(
  map: Map<string, ContractFile>,
  addedPaths: string[],
  patchedPaths: string[],
  warnings: string[],
): void {
  ensurePackageJson(map, addedPaths, patchedPaths, warnings);
  upsert(map, 'tsconfig.json', baseTsConfig(), 'json', addedPaths, patchedPaths);
  upsert(map, 'next.config.mjs', nextConfig(), 'javascript', addedPaths, patchedPaths);
  upsert(map, 'postcss.config.js', postcssConfig(), 'javascript', addedPaths, patchedPaths);
  upsert(map, 'src/app/layout.tsx', appLayout(), 'typescriptreact', addedPaths, patchedPaths);
  upsert(map, 'src/app/page.tsx', appPage(), 'typescriptreact', addedPaths, patchedPaths);
  upsert(map, 'src/app/globals.css', globalsCss(), 'css', addedPaths, patchedPaths);
}

function ensurePackageJson(
  map: Map<string, ContractFile>,
  addedPaths: string[],
  patchedPaths: string[],
  warnings: string[],
): void {
  const existing = map.get('package.json');
  const manifest = buildCanonicalPackageManifest(existing?.content, Array.from(map.values()));
  for (const warning of manifest.warnings) warnings.push(`package.json: ${warning}`);
  if (manifest.droppedDependencies.length > 0) {
    warnings.push(`package.json: dropped ${manifest.droppedDependencies.length} non-deterministic dependency declaration(s).`);
  }
  upsert(map, 'package.json', manifest.packageJson, 'json', addedPaths, patchedPaths);
}

function baseTsConfig(): string {
  return [
    '{',
    '  "compilerOptions": {',
    '    "target": "ES2020",',
    '    "lib": ["dom", "dom.iterable", "esnext"],',
    '    "allowJs": true,',
    '    "skipLibCheck": true,',
    '    "strict": true,',
    '    "noEmit": true,',
    '    "esModuleInterop": true,',
    '    "module": "esnext",',
    '    "moduleResolution": "bundler",',
    '    "resolveJsonModule": true,',
    '    "isolatedModules": true,',
    '    "jsx": "preserve",',
    '    "incremental": true,',
    '    "plugins": [{ "name": "next" }],',
    '    "paths": { "@/*": ["./src/*"] }',
    '  },',
    '  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],',
    '  "exclude": ["node_modules"]',
    '}',
    '',
  ].join('\n');
}

function nextConfig(): string {
  return [
    '/** @type {import("next").NextConfig} */',
    'const nextConfig = {',
    '  reactStrictMode: true,',
    '  async headers() {',
    '    return [{',
    '      source: "/:path*",',
    '      headers: [',
    '        { key: "X-Frame-Options", value: "ALLOWALL" },',
    '        { key: "Content-Security-Policy", value: "frame-ancestors *" },',
    '      ],',
    '    }];',
    '  },',
    '};',
    'export default nextConfig;',
    '',
  ].join('\n');
}

function postcssConfig(): string {
  return [
    'const config = {',
    '  plugins: {',
    '    tailwindcss: {},',
    '    autoprefixer: {},',
    '  },',
    '};',
    '',
    'export default config;',
    '',
  ].join('\n');
}

function appLayout(): string {
  return [
    'import type { ReactNode } from "react";',
    'import "./globals.css";',
    '',
    'export default function RootLayout({ children }: { children: ReactNode }) {',
    '  return (',
    '    <html lang="en">',
    '      <body>{children}</body>',
    '    </html>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function appPage(): string {
  return [
    'export default function Page() {',
    '  return (',
    '    <main className="mx-auto max-w-4xl p-8">',
    '      <h1 className="text-3xl font-semibold">Generated App</h1>',
    '      <p className="mt-3 text-base text-slate-600">A deterministic Next.js baseline is active.</p>',
    '    </main>',
    '  );',
    '}',
    '',
  ].join('\n');
}

function globalsCss(): string {
  return [
    '@tailwind base;',
    '@tailwind components;',
    '@tailwind utilities;',
    '',
    ':root {',
    '  --background: 255 255 255;',
    '  --foreground: 15 23 42;',
    '}',
    '',
    'body {',
    '  background: rgb(var(--background));',
    '  color: rgb(var(--foreground));',
    '  font-family: Inter, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif;',
    '}',
    '',
  ].join('\n');
}

function buildManifest(files: ContractFile[]): GenerationManifest {
  const out: GenerationManifest = {
    files: [],
    routes: [],
    components: [],
    dependencies: [],
  };
  for (const f of files) {
    const path = normalizePath(f.path);
    const bytes = Buffer.byteLength(f.content ?? '', 'utf8');
    out.files.push({ path, bytes, kind: classifyKind(path) });
    if (/^src\/app\/.+\/page\.tsx$/.test(path) || path === 'src/app/page.tsx') {
      out.routes.push(pathToRoute(path));
    }
    if (/^src\/components\/.+\.(tsx|ts)$/.test(path)) out.components.push(path);
  }
  const pkg = files.find((f) => normalizePath(f.path) === 'package.json');
  if (pkg) {
    try {
      const parsed = JSON.parse(pkg.content) as { dependencies?: Record<string, string> };
      out.dependencies = Object.keys(parsed.dependencies ?? {}).sort();
    } catch {
      out.dependencies = [];
    }
  }
  out.files.sort((a, b) => a.path.localeCompare(b.path));
  out.routes.sort();
  out.components.sort();
  return out;
}

function validateManifest(manifest: GenerationManifest): string | null {
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) return 'files must be a non-empty array';
  for (const file of manifest.files) {
    if (!file.path || typeof file.path !== 'string') return 'manifest.files[].path must be string';
    if (!Number.isFinite(file.bytes) || file.bytes < 0) return `invalid bytes for ${file.path}`;
  }
  if (!Array.isArray(manifest.routes)) return 'routes must be an array';
  if (!Array.isArray(manifest.components)) return 'components must be an array';
  if (!Array.isArray(manifest.dependencies)) return 'dependencies must be an array';
  return null;
}

function pathToRoute(path: string): string {
  const rel = path.replace(/^src\/app\//, '').replace(/\/page\.tsx$/, '').replace(/^page\.tsx$/, '');
  if (!rel) return '/';
  return '/' + rel.replace(/\[(.+?)\]/g, ':$1');
}

function classifyKind(path: string): GenerationManifestFile['kind'] {
  if (/\.(tsx?|jsx?|css|scss)$/.test(path)) return 'source';
  if (/package\.json$|tsconfig\.json$|next\.config|tailwind\.config|postcss\.config/.test(path)) return 'config';
  if (/\.(png|jpe?g|webp|svg|ico|gif)$/.test(path)) return 'asset';
  if (/\.md$/.test(path)) return 'doc';
  return 'other';
}
