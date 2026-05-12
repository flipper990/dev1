import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type CandidateKind = 'file' | 'dir';

interface Candidate {
  absolutePath: string;
  reason: string;
  kind: CandidateKind;
}

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const normalizedRepoRoot = normalizePath(repoRoot);
const apiRoot = path.join(repoRoot, 'apps', 'api');

const knownStorageRoots = [
  path.join(repoRoot, 'data'),
  path.join(apiRoot, 'data'),
  path.join(apiRoot, '.data'),
  path.join(repoRoot, 'storage'),
].map(normalizePath);

const testingArtifactPatterns = [
  /^results\.json$/i,
  /^last-.*\.(json|jsonl)$/i,
  /^project-state-mutations-.*\.jsonl$/i,
  /^\.api-restart-counter\.json$/i,
  /^\.last-api-pid\.json$/i,
];

const wipeChildrenSubdirs = [
  { name: 'previews', reason: 'preview runtime data' },
  { name: 'sessions', reason: 'session/run artifacts' },
  { name: 'exports', reason: 'generated export artifacts' },
  { name: 'cache', reason: 'generated cache artifacts' },
  { name: 'tmp', reason: 'temporary runtime artifacts' },
] as const;

interface DiscoveryResult {
  allowRoots: string[];
  projectDirs: string[];
  memoryDirs: string[];
  wipeChildrenDirs: Array<{ dir: string; reason: string }>;
  explicitPreviewRuntimeDirs: string[];
  externalConfiguredPaths: string[];
}

function normalizePath(inputPath: string): string {
  return path.resolve(inputPath).replace(/\\/g, '/');
}

function relToRepo(inputPath: string): string {
  const relative = path.relative(repoRoot, inputPath) || '.';
  return relative.replace(/\\/g, '/');
}

function displayPath(inputPath: string): string {
  const normalized = normalizePath(inputPath);
  return isPathInside(normalizedRepoRoot, normalized)
    ? relToRepo(normalized)
    : normalized;
}

function parseArgs(argv: string[]) {
  const dryRun = argv.includes('--dry-run');
  const yesFlag = argv.includes('--yes');
  const forceEnv = /^(1|true|yes|on)$/i.test(process.env.FORCE_CLEAR_GENERATED ?? '');
  return { dryRun, force: yesFlag || forceEnv };
}

function isPathInside(parent: string, child: string): boolean {
  const parentNormalized = normalizePath(parent);
  const childNormalized = normalizePath(child);
  return childNormalized === parentNormalized || childNormalized.startsWith(`${parentNormalized}/`);
}

function assertSafeTarget(absolutePath: string, allowRoots: string[]): void {
  const normalized = normalizePath(absolutePath);
  const allowed = allowRoots.some((root) => isPathInside(root, normalized));
  if (!allowed) {
    throw new Error(`Refusing to delete path outside allowlist: ${normalized}`);
  }
}

async function listChildren(absoluteDirPath: string): Promise<Array<{ name: string; absolutePath: string; kind: CandidateKind }>> {
  const entries = await readdir(absoluteDirPath, { withFileTypes: true });
  return entries.map((entry) => ({
    name: entry.name,
    absolutePath: path.join(absoluteDirPath, entry.name),
    kind: entry.isDirectory() ? 'dir' : 'file',
  }));
}

async function exists(absolutePath: string): Promise<boolean> {
  try {
    await stat(absolutePath);
    return true;
  } catch {
    return false;
  }
}

function isReferenceProjectsEntry(name: string): boolean {
  const lowered = name.toLowerCase();
  return lowered === 'reference-projects' || lowered.includes('reference-project');
}

function shouldDeleteTestingArtifact(name: string): boolean {
  return testingArtifactPatterns.some((pattern) => pattern.test(name));
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const byPath = new Map<string, Candidate>();
  for (const candidate of candidates) {
    byPath.set(normalizePath(candidate.absolutePath), candidate);
  }
  return [...byPath.values()].sort((a, b) => a.absolutePath.localeCompare(b.absolutePath));
}

function dedupePaths(paths: string[]): string[] {
  return [...new Set(paths.map(normalizePath))];
}

function parseEnvFile(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx <= 0) continue;
    const key = trimmed.slice(0, idx).trim();
    if (!key) continue;
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

function resolveConfiguredPathCandidates(rawValue: string | undefined, anchors: string[]): string[] {
  if (!rawValue) return [];
  const value = rawValue.trim();
  if (!value) return [];
  if (path.isAbsolute(value)) return [normalizePath(value)];
  return anchors.map((anchor) => normalizePath(path.resolve(anchor, value)));
}

async function readConfiguredEnv(): Promise<Record<string, string>> {
  const envPath = path.join(repoRoot, '.env');
  try {
    const raw = await readFile(envPath, 'utf-8');
    return parseEnvFile(raw);
  } catch {
    return {};
  }
}

async function discoverPaths(): Promise<DiscoveryResult> {
  const envFileValues = await readConfiguredEnv();
  const envValues = {
    STORAGE_PATH: process.env.STORAGE_PATH ?? envFileValues.STORAGE_PATH,
    PROJECTS_DIR: process.env.PROJECTS_DIR ?? envFileValues.PROJECTS_DIR,
    MEMORY_DIR: process.env.MEMORY_DIR ?? envFileValues.MEMORY_DIR,
  };
  const anchors = [repoRoot, apiRoot];

  const storagePathCandidates = resolveConfiguredPathCandidates(envValues.STORAGE_PATH, anchors);
  const projectsPathCandidates = resolveConfiguredPathCandidates(envValues.PROJECTS_DIR, anchors);
  const memoryPathCandidates = resolveConfiguredPathCandidates(envValues.MEMORY_DIR, anchors);

  const configuredStorageRoots = dedupePaths([
    ...storagePathCandidates,
    ...projectsPathCandidates.map((projectDir) => normalizePath(path.dirname(projectDir))),
    ...memoryPathCandidates.map((memoryDir) => normalizePath(path.dirname(memoryDir))),
  ]);

  const rawStorageRoots = dedupePaths([
    ...knownStorageRoots,
    ...configuredStorageRoots,
  ]);

  const insideRepoStorageRoots = rawStorageRoots.filter((candidate) => isPathInside(normalizedRepoRoot, candidate));
  const outsideRepoStorageRoots = configuredStorageRoots.filter((candidate) => !isPathInside(normalizedRepoRoot, candidate));
  const outsideRepoConfiguredPaths = dedupePaths([
    ...storagePathCandidates,
    ...projectsPathCandidates,
    ...memoryPathCandidates,
  ]).filter((candidate) => !isPathInside(normalizedRepoRoot, candidate));

  const activeStorageRoots = dedupePaths([
    ...insideRepoStorageRoots,
    ...outsideRepoStorageRoots,
  ]);

  const projectDirs = dedupePaths([
    ...activeStorageRoots.map((storageRoot) => path.join(storageRoot, 'projects')),
    ...projectsPathCandidates,
  ]);

  const memoryDirs = dedupePaths([
    ...activeStorageRoots.map((storageRoot) => path.join(storageRoot, 'memory')),
    ...memoryPathCandidates,
  ]);

  const wipeChildrenDirs = dedupePaths(
    activeStorageRoots.flatMap((storageRoot) => wipeChildrenSubdirs.map((item) => path.join(storageRoot, item.name))),
  ).map((dir) => {
    const reason = wipeChildrenSubdirs.find((item) => dir.endsWith(`/${item.name}`))?.reason ?? 'runtime artifacts';
    return { dir, reason };
  });

  const explicitPreviewRuntimeDirs = dedupePaths([
    path.join(repoRoot, '.preview-runtime'),
    path.join(apiRoot, '.preview-runtime'),
    ...activeStorageRoots.map((storageRoot) => path.join(storageRoot, '.preview-runtime')),
  ]);

  const testingDir = normalizePath(path.join(apiRoot, 'src', 'testing'));
  const allowRoots = dedupePaths([
    ...activeStorageRoots,
    ...projectDirs,
    ...memoryDirs,
    ...wipeChildrenDirs.map((item) => item.dir),
    ...explicitPreviewRuntimeDirs,
    testingDir,
  ]);

  return {
    allowRoots,
    projectDirs,
    memoryDirs,
    wipeChildrenDirs,
    explicitPreviewRuntimeDirs,
    externalConfiguredPaths: outsideRepoConfiguredPaths,
  };
}

async function collectCandidates(discovery: DiscoveryResult): Promise<Candidate[]> {
  const candidates: Candidate[] = [];

  for (const projectsDir of discovery.projectDirs) {
    if (!(await exists(projectsDir))) continue;
    for (const entry of await listChildren(projectsDir)) {
      if (entry.name === '.gitkeep') continue;
      if (isReferenceProjectsEntry(entry.name)) continue;
      candidates.push({
        absolutePath: entry.absolutePath,
        reason: 'generated project data',
        kind: entry.kind,
      });
    }
  }

  for (const memoryDir of discovery.memoryDirs) {
    if (!(await exists(memoryDir))) continue;
    for (const entry of await listChildren(memoryDir)) {
      if (entry.name === '.gitkeep') continue;
      if (isReferenceProjectsEntry(entry.name)) continue;
      candidates.push({
        absolutePath: entry.absolutePath,
        reason: 'generated run memory',
        kind: entry.kind,
      });
    }
  }

  for (const item of discovery.wipeChildrenDirs) {
    if (!(await exists(item.dir))) continue;
    for (const entry of await listChildren(item.dir)) {
      if (entry.name === '.gitkeep') continue;
      if (isReferenceProjectsEntry(entry.name)) continue;
      candidates.push({
        absolutePath: entry.absolutePath,
        reason: item.reason,
        kind: entry.kind,
      });
    }
  }

  for (const previewRuntimeDir of discovery.explicitPreviewRuntimeDirs) {
    if (!(await exists(previewRuntimeDir))) continue;
    candidates.push({
      absolutePath: previewRuntimeDir,
      reason: 'preview runtime folder',
      kind: 'dir',
    });
  }

  const testingDir = path.join(apiRoot, 'src', 'testing');
  if (await exists(testingDir)) {
    for (const entry of await listChildren(testingDir)) {
      if (entry.kind !== 'file') continue;
      if (!shouldDeleteTestingArtifact(entry.name)) continue;
      candidates.push({
        absolutePath: entry.absolutePath,
        reason: 'diagnostic run artifact',
        kind: entry.kind,
      });
    }
  }

  return dedupeCandidates(candidates);
}

function printDiscovery(discovery: DiscoveryResult): void {
  if (discovery.externalConfiguredPaths.length === 0) return;
  console.log('Note: configured storage paths outside this repository were detected:');
  for (const externalPath of discovery.externalConfiguredPaths) {
    console.log(`- ${displayPath(externalPath)}`);
  }
  console.log('Cleanup includes generated subfolders under these configured storage roots.');
}

function printPlan(candidates: Candidate[], dryRun: boolean): void {
  if (candidates.length === 0) {
    console.log('No generated data targets found.');
    return;
  }

  console.log(dryRun ? 'Dry run: the following paths would be deleted:' : 'The following paths will be deleted:');
  for (const candidate of candidates) {
    const kindLabel = candidate.kind === 'dir' ? 'dir ' : 'file';
    console.log(`- [${kindLabel}] ${displayPath(candidate.absolutePath)} (${candidate.reason})`);
  }
  const dirCount = candidates.filter((candidate) => candidate.kind === 'dir').length;
  const fileCount = candidates.length - dirCount;
  console.log(`\nSummary: ${candidates.length} targets (${dirCount} directories, ${fileCount} files).`);
}

async function requireConfirmation(candidates: Candidate[]): Promise<void> {
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    const answer = await rl.question(
      `Type CLEAR to permanently delete ${candidates.length} generated-data targets: `,
    );
    if (answer.trim() !== 'CLEAR') {
      throw new Error('Aborted: confirmation text did not match CLEAR.');
    }
  } finally {
    rl.close();
  }
}

async function deleteCandidates(candidates: Candidate[], allowRoots: string[]): Promise<void> {
  for (const candidate of candidates) {
    assertSafeTarget(candidate.absolutePath, allowRoots);
    await rm(candidate.absolutePath, { recursive: true, force: true });
    console.log(`Deleted: ${displayPath(candidate.absolutePath)}`);
  }
}

async function main(): Promise<void> {
  const { dryRun, force } = parseArgs(process.argv.slice(2));
  const discovery = await discoverPaths();
  const candidates = await collectCandidates(discovery);
  printDiscovery(discovery);
  printPlan(candidates, dryRun);

  if (candidates.length === 0) return;
  if (dryRun) return;

  if (!force) {
    await requireConfirmation(candidates);
  } else {
    console.log('Confirmation bypassed via FORCE_CLEAR_GENERATED=true or --yes.');
  }

  await deleteCandidates(candidates, discovery.allowRoots);
  console.log('Generated data cleanup completed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
