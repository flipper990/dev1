import { REACT_18_NEXT_15 } from '../../../../packages/agent-core/src/stack-compatibility.js';
import { pickKnownVersion } from '../../../../packages/agent-core/src/dependency-validator.js';

export interface ContractLikeFile {
  path: string;
  content: string;
  language?: string;
}

export interface CanonicalManifestResult {
  packageJson: string;
  warnings: string[];
  droppedDependencies: string[];
  keptAdditionalDependencies: string[];
}

const REQUIRED_SCRIPTS: Record<string, string> = {
  dev: 'next dev',
  build: 'next build',
  start: 'next start',
  preview: 'next dev',
  typecheck: 'tsc --noEmit',
};

const CORE_DEPENDENCIES: Record<string, string> = {
  next: REACT_18_NEXT_15.versions.next,
  react: REACT_18_NEXT_15.versions.react,
  'react-dom': REACT_18_NEXT_15.versions['react-dom'],
};

const CORE_DEV_DEPENDENCIES: Record<string, string> = {
  typescript: REACT_18_NEXT_15.versions.typescript,
  '@types/node': REACT_18_NEXT_15.versions['@types/node'],
  '@types/react': REACT_18_NEXT_15.versions['@types/react'],
  '@types/react-dom': REACT_18_NEXT_15.versions['@types/react-dom'],
  autoprefixer: REACT_18_NEXT_15.versions.autoprefixer,
  postcss: REACT_18_NEXT_15.versions.postcss,
  tailwindcss: REACT_18_NEXT_15.versions.tailwindcss,
};

const SOURCE_EXT = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/i;

function sanitizePackageName(value: unknown): string {
  if (typeof value !== 'string') return 'generated-app';
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized.length > 0 ? normalized : 'generated-app';
}

function asRecord(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object') return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (typeof v === 'string' && v.trim().length > 0) out[k] = v.trim();
  }
  return out;
}

function packageNameOf(specifier: string): string | null {
  if (!specifier) return null;
  if (specifier.startsWith('.') || specifier.startsWith('/')) return null;
  if (specifier.startsWith('node:') || specifier.startsWith('bun:')) return null;
  if (specifier.startsWith('@/') || specifier.startsWith('~/')) return null;
  if (specifier.startsWith('@')) {
    const parts = specifier.split('/');
    if (parts.length < 2) return null;
    return `${parts[0]}/${parts[1]}`;
  }
  const slash = specifier.indexOf('/');
  return slash === -1 ? specifier : specifier.slice(0, slash);
}

function extractSpecifiers(src: string): string[] {
  const out: string[] = [];
  const cleaned = src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
  for (const m of cleaned.matchAll(/\bimport\s+(?:[\s\S]*?\sfrom\s+)?['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of cleaned.matchAll(/\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g)) out.push(m[1]);
  for (const m of cleaned.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  for (const m of cleaned.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(m[1]);
  return out;
}

function inferBareImports(files: ContractLikeFile[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const path = file.path.replace(/\\/g, '/');
    if (!SOURCE_EXT.test(path)) continue;
    for (const spec of extractSpecifiers(file.content ?? '')) {
      const name = packageNameOf(spec);
      if (!name) continue;
      names.add(name);
    }
  }
  return names;
}

function addSorted(target: Record<string, string>, name: string, version: string): Record<string, string> {
  const next = { ...target, [name]: version };
  const out: Record<string, string> = {};
  for (const key of Object.keys(next).sort((a, b) => a.localeCompare(b))) out[key] = next[key];
  return out;
}

function isDevDependency(name: string): boolean {
  return (
    name.startsWith('@types/')
    || name === 'typescript'
    || name === 'tsx'
    || name.startsWith('eslint')
    || name === 'prettier'
    || name === 'tailwindcss'
    || name === 'postcss'
    || name === 'autoprefixer'
  );
}

export function buildCanonicalPackageManifest(
  currentPackageJson: string | null | undefined,
  files: ContractLikeFile[],
): CanonicalManifestResult {
  let parsed: Record<string, unknown> = {};
  if (currentPackageJson && currentPackageJson.trim().length > 0) {
    try {
      parsed = JSON.parse(currentPackageJson) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }

  const warnings: string[] = [];
  const droppedDependencies: string[] = [];
  const keptAdditionalDependencies: string[] = [];
  const referencedPackages = inferBareImports(files);
  const currentDependencies = asRecord(parsed.dependencies);
  const currentDevDependencies = asRecord(parsed.devDependencies);
  const candidateNames = new Set([
    ...Object.keys(currentDependencies),
    ...Object.keys(currentDevDependencies),
  ]);

  let dependencies = { ...CORE_DEPENDENCIES };
  let devDependencies = { ...CORE_DEV_DEPENDENCIES };

  for (const name of candidateNames) {
    if (name in CORE_DEPENDENCIES || name in CORE_DEV_DEPENDENCIES) continue;
    if (!referencedPackages.has(name)) {
      droppedDependencies.push(name);
      warnings.push(`Dropped non-referenced dependency "${name}" from package.json.`);
      continue;
    }
    const resolved = pickKnownVersion(name);
    if (resolved === 'latest') {
      droppedDependencies.push(name);
      warnings.push(`Dropped unapproved dependency "${name}" (no deterministic pinned version).`);
      continue;
    }
    if (isDevDependency(name)) {
      devDependencies = addSorted(devDependencies, name, resolved);
    } else {
      dependencies = addSorted(dependencies, name, resolved);
    }
    keptAdditionalDependencies.push(name);
  }

  const scripts = { ...REQUIRED_SCRIPTS };
  const content = JSON.stringify({
    name: sanitizePackageName(parsed.name),
    version: typeof parsed.version === 'string' && parsed.version.trim().length > 0 ? parsed.version.trim() : '0.1.0',
    private: true,
    type: 'module',
    scripts,
    dependencies,
    devDependencies,
    overrides: {},
  }, null, 2) + '\n';

  return { packageJson: content, warnings, droppedDependencies, keptAdditionalDependencies };
}
