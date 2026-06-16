import { validatePackageJsonString } from '../../../../packages/agent-core/src/package-json-validator.js';
import { REACT_18_NEXT_15 } from '../../../../packages/agent-core/src/stack-compatibility.js';
import { buildCanonicalPackageManifest, type ContractLikeFile } from './canonical-package-manifest.js';

export interface PackageManifestGuardDiagnostics {
  packageManifestSource: 'canonical_builder';
  packageManifestRepaired: boolean;
  packageManifestRejected: boolean;
  packageValidationRule: string | null;
  expectedPins: Record<string, string>;
  actualPins: Record<string, string | null>;
}

export interface PackageManifestGuardResult {
  files: Array<{ path: string; content: string; language?: string }>;
  diagnostics: PackageManifestGuardDiagnostics;
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/').replace(/^\.\//, '');
}

export function enforceCanonicalPackageManifest(
  files: Array<{ path: string; content: string; language?: string }>,
): PackageManifestGuardResult {
  const normalized = files.map((f) => ({ ...f, path: normalizePath(f.path) }));
  const packageIndex = normalized.findIndex((f) => f.path === 'package.json');
  const currentPackageJson = packageIndex >= 0 ? normalized[packageIndex]?.content ?? null : null;

  const manifest = buildCanonicalPackageManifest(
    currentPackageJson,
    normalized as ContractLikeFile[],
  );
  const nextPackageJson = manifest.packageJson;
  const packageManifestRepaired = currentPackageJson !== nextPackageJson;

  const outFiles = normalized.slice();
  if (packageIndex >= 0) {
    outFiles[packageIndex] = {
      ...outFiles[packageIndex],
      path: 'package.json',
      language: outFiles[packageIndex]?.language ?? 'json',
      content: nextPackageJson,
    };
  } else {
    outFiles.push({ path: 'package.json', content: nextPackageJson, language: 'json' });
  }

  const validation = validatePackageJsonString(nextPackageJson);
  const firstBlocking = validation.violations.find((v) => v.severity === 'error');
  const packageValidationRule = firstBlocking?.ruleId ?? (validation.parseError ? 'parse-error' : null);

  const parsed = JSON.parse(nextPackageJson) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  const deps = parsed.dependencies ?? {};
  const devDeps = parsed.devDependencies ?? {};
  const expectedPins: Record<string, string> = {
    next: REACT_18_NEXT_15.versions.next,
    react: REACT_18_NEXT_15.versions.react,
    'react-dom': REACT_18_NEXT_15.versions['react-dom'],
    '@types/react': REACT_18_NEXT_15.versions['@types/react'],
    '@types/react-dom': REACT_18_NEXT_15.versions['@types/react-dom'],
  };
  const actualPins: Record<string, string | null> = {
    next: deps.next ?? null,
    react: deps.react ?? null,
    'react-dom': deps['react-dom'] ?? null,
    '@types/react': devDeps['@types/react'] ?? null,
    '@types/react-dom': devDeps['@types/react-dom'] ?? null,
  };

  return {
    files: outFiles,
    diagnostics: {
      packageManifestSource: 'canonical_builder',
      packageManifestRepaired,
      packageManifestRejected: validation.hasBlockingError,
      packageValidationRule,
      expectedPins,
      actualPins,
    },
  };
}

