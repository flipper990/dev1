const TEST_FILE_RE = /\.test\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i;
const SPEC_FILE_RE = /\.spec\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i;
const SOURCE_FILE_RE = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/i;
const TIER1_BACKEND_PATH_RE =
  /^(?:apps\/api\/|app\/api\/|src\/app\/api\/|server\/|routes\/|db\/|src\/server\/|src\/routes\/|src\/db\/|pages\/|src\/pages\/|apps\/[^/]+\/(?:server|routes|db)\/)/i;
const TIER1_ALLOWED_RUNTIME_PATH_RE =
  /^(?:package\.json|package-lock\.json|tsconfig\.json|next\.config\.(?:js|mjs|ts)|postcss\.config\.(?:js|mjs|cjs)|tailwind\.config\.(?:js|ts)|next-env\.d\.ts|src\/app\/layout\.tsx|src\/app\/page\.tsx|src\/app\/globals\.css|src\/components\/.+|src\/lib\/mock-data\.ts|src\/lib\/api-client\.(?:ts|tsx|js)|src\/components\/ui\/(?:Button|Card|Input|index)\.tsx|src\/components\/ui\/(?:Button|Card|Input|index)\.ts)$/i;

export function normalizeArtifactPath(path: string): string {
  return String(path ?? '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

export function isTier1TestArtifactPath(path: string): boolean {
  const norm = normalizeArtifactPath(path);
  const inUnderscoreTestsDir = /(^|\/)__tests__\//.test(norm);
  const inTestsDir = /(^|\/)tests\//.test(norm);
  const testNamed = TEST_FILE_RE.test(norm);
  const specNamed = SPEC_FILE_RE.test(norm);

  // Tier1 default is frontend-preview-safe: treat source files in explicit
  // test directories as test artifacts, and treat *.test.* files as test
  // artifacts anywhere. *.spec.* remains test-only inside test directories.
  const sourceFile = SOURCE_FILE_RE.test(norm);
  const candidate =
    (inUnderscoreTestsDir && sourceFile)
    || (inTestsDir && sourceFile)
    || testNamed;
  if (!candidate) return false;

  return (
    norm.startsWith('app/')
    || norm.startsWith('src/')
    || norm.startsWith('tests/')
    || norm.startsWith('apps/')
    || norm.startsWith('packages/')
    || norm.startsWith('components/')
    || norm.startsWith('lib/')
    || norm.startsWith('hooks/')
    || norm.startsWith('utils/')
    || norm.startsWith('__tests__/')
  );
}

export function isTier1BackendArtifactPath(path: string): boolean {
  const norm = normalizeArtifactPath(path);
  return TIER1_BACKEND_PATH_RE.test(norm);
}

export type Tier1RuntimeExclusionReason =
  | 'generated-test-artifact'
  | 'backend-runtime-artifact';

export function classifyTier1RuntimeExclusion(path: string): Tier1RuntimeExclusionReason | null {
  if (isTier1TestArtifactPath(path)) return 'generated-test-artifact';
  if (isTier1BackendArtifactPath(path)) return 'backend-runtime-artifact';
  return null;
}

export function isAllowedTier1RuntimePath(path: string): boolean {
  const norm = normalizeArtifactPath(path);
  if (!norm) return false;
  if (classifyTier1RuntimeExclusion(norm) !== null) return false;
  return TIER1_ALLOWED_RUNTIME_PATH_RE.test(norm);
}
