import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

export interface E2eDataRootPaths {
  rootDir: string;
  projectsDir: string;
  memoryDir: string;
}

function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').toLowerCase();
}

function assertUnder(base: string, child: string, label: string): void {
  const baseNorm = normalizePath(base).replace(/\/+$/, '');
  const childNorm = normalizePath(child);
  if (!(childNorm === baseNorm || childNorm.startsWith(`${baseNorm}/`))) {
    throw new Error(`${label} is outside allowed base: ${child}`);
  }
}

function buildRunId(now = new Date()): string {
  const stamp = now.toISOString().replace(/[:.]/g, '-');
  return `${stamp}-${process.pid}`;
}

export function buildIsolatedE2eDataRoot(apiRoot: string, runId = buildRunId()): E2eDataRootPaths {
  const runsBase = resolve(apiRoot, 'data', 'test-runs');
  const rootDir = resolve(runsBase, runId);
  const projectsDir = resolve(rootDir, 'projects');
  const memoryDir = resolve(rootDir, 'memory');

  assertUnder(runsBase, rootDir, 'E2E root');
  assertUnder(rootDir, projectsDir, 'E2E projects dir');
  assertUnder(rootDir, memoryDir, 'E2E memory dir');
  return { rootDir, projectsDir, memoryDir };
}

export async function preflightE2eDataRoot(paths: E2eDataRootPaths): Promise<void> {
  await mkdir(paths.projectsDir, { recursive: true });
  await mkdir(paths.memoryDir, { recursive: true });

  const sentinel = join(paths.projectsDir, `.e2e-write-check-${process.pid}.tmp`);
  await writeFile(sentinel, 'ok', 'utf8');
  const readBack = await readFile(sentinel, 'utf8');
  if (readBack !== 'ok') {
    throw new Error(`filesystem preflight readback mismatch at ${sentinel}`);
  }
  await rm(sentinel, { force: true });

  const tempDir = await mkdtemp(join(paths.projectsDir, '.e2e-dir-check-'));
  await rm(tempDir, { recursive: true, force: true });
}

export async function cleanupE2eRunRoot(rootDir: string): Promise<void> {
  const retryable = new Set(['EPERM', 'EBUSY', 'ENOTEMPTY']);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      await rm(rootDir, { recursive: true, force: true });
      return;
    } catch (err) {
      const code = String((err as { code?: string })?.code ?? '').toUpperCase();
      if (!retryable.has(code) || attempt >= 4) {
        lastErr = err;
        break;
      }
      const backoff = 50 * (2 ** (attempt - 1));
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw new Error(`could not cleanup E2E run root ${rootDir}: ${String((lastErr as Error)?.message ?? lastErr)}`);
}

export function buildReadonlyProbePaths(): E2eDataRootPaths {
  const impossibleRoot = resolve(tmpdir(), '.e2e-readonly-probe', 'locked');
  return {
    rootDir: impossibleRoot,
    projectsDir: resolve(impossibleRoot, 'projects'),
    memoryDir: resolve(impossibleRoot, 'memory'),
  };
}

