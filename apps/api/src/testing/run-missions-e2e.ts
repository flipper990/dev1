import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDbPreflight } from '../runtime/db-preflight.js';
import { loadRuntimeEnv } from '../runtime/load-env.js';
import { runFastContractCheck } from './contract-fast-check.js';
import {
  buildIsolatedE2eDataRoot,
  cleanupE2eRunRoot,
  preflightE2eDataRoot,
  type E2eDataRootPaths,
} from './e2e-filesystem-preflight.js';

const API_URL = process.env.API_URL ?? 'http://127.0.0.1:3003';
const FALLBACK_API_PORT = Number.parseInt(process.env.E2E_API_PORT ?? '3303', 10);
const STARTUP_TIMEOUT_MS = Number.parseInt(process.env.E2E_API_STARTUP_TIMEOUT_MS ?? '45000', 10);
const POLL_MS = 1500;
const FORCE_MANAGED_API = process.env.E2E_FORCE_MANAGED_API !== 'false';
const CLEANUP_TEST_RUN_DIR = process.env.E2E_CLEANUP_TEST_RUN_DIR !== 'false';

const authHeaders: Record<string, string> = {
  'x-devteam-user-id': process.env.DEV_USER_ID ?? 'dev-user',
  'x-devteam-user-email': process.env.DEV_USER_EMAIL ?? 'dev@local.test',
  'x-devteam-workspace-id': process.env.DEV_WORKSPACE_ID ?? 'dev-workspace',
  'x-devteam-role': process.env.DEV_USER_ROLE ?? 'owner',
};

interface ApiReadyCheck {
  ok: boolean;
  healthStatus?: number;
  preflightStatus?: number;
  preflightOk?: boolean;
  reason?: string;
}

async function checkApiReady(baseUrl: string): Promise<ApiReadyCheck> {
  try {
    const health = await fetch(`${baseUrl}/health`, { cache: 'no-store' });
    if (!health.ok) {
      return { ok: false, healthStatus: health.status, reason: `health status=${health.status}` };
    }
    const preflight = await fetch(`${baseUrl}/api/runtime/preflight`, {
      cache: 'no-store',
      headers: authHeaders,
    });
    if (!preflight.ok) {
      return {
        ok: false,
        healthStatus: health.status,
        preflightStatus: preflight.status,
        reason: `preflight status=${preflight.status}`,
      };
    }
    const preflightBody = await preflight.json().catch(() => ({}));
    const preflightOk = Boolean((preflightBody as { ok?: boolean }).ok);
    if (!preflightOk) {
      return {
        ok: false,
        healthStatus: health.status,
        preflightStatus: preflight.status,
        preflightOk,
        reason: `preflight reports unhealthy: ${JSON.stringify(preflightBody).slice(0, 250)}`,
      };
    }
    return { ok: true, healthStatus: health.status, preflightStatus: preflight.status, preflightOk };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

async function runRawMissionsScript(): Promise<number> {
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const script = resolve(apiRoot, 'src/testing/successful-mission-e2e.ts');

  const child = spawn(process.execPath, ['--import', 'tsx', script], {
    cwd: apiRoot,
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });

  const [code, signal] = await once(child, 'exit') as [number | null, NodeJS.Signals | null];
  if (signal) {
    console.error(`[e2e-bootstrap] mission runner terminated by signal ${signal}`);
    return 1;
  }
  return code ?? 1;
}

async function startManagedApi(paths: E2eDataRootPaths): Promise<{ process: ReturnType<typeof spawn>; apiUrl: string }> {
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const apiPort = Number.isFinite(FALLBACK_API_PORT) ? FALLBACK_API_PORT : 3303;
  const apiUrl = `http://127.0.0.1:${apiPort}`;

  const child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
    cwd: apiRoot,
    env: {
      ...process.env,
      API_PORT: String(apiPort),
      PORT: String(apiPort),
      HOST: '127.0.0.1',
      DEV_AUTH_BYPASS: 'true',
      PROJECTS_DIR: paths.projectsDir,
      MEMORY_DIR: paths.memoryDir,
    },
    stdio: 'inherit',
    shell: false,
  });

  const startedAt = Date.now();
  while (Date.now() - startedAt < STARTUP_TIMEOUT_MS) {
    if (child.exitCode !== null) {
      throw new Error(`managed API exited early with code=${child.exitCode}`);
    }
    const ready = await checkApiReady(apiUrl);
    if (ready.ok) {
      return { process: child, apiUrl };
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`managed API did not become ready within ${STARTUP_TIMEOUT_MS}ms`);
}

async function main(): Promise<void> {
  loadRuntimeEnv();
  runFastContractCheck();
  const apiRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
  const isolatedDataRoot = buildIsolatedE2eDataRoot(apiRoot);
  try {
    await preflightE2eDataRoot(isolatedDataRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[e2e-bootstrap] filesystem preflight failed for isolated data root: ${message}`);
    process.exit(1);
  }

  const db = await runDbPreflight();
  if (!db.ok) {
    console.error('[e2e-bootstrap] blocking E2E run because DB preflight failed.');
    console.error(`[e2e-bootstrap] DATABASE_URL=${db.databaseUrl ?? 'missing'}`);
    for (const diag of db.diagnostics) {
      console.error(`[e2e-bootstrap] ${diag}`);
    }
    process.exit(1);
  }

  let apiUrl = API_URL;
  let managedApi: ReturnType<typeof spawn> | null = null;
  if (FORCE_MANAGED_API) {
    console.warn(`[e2e-bootstrap] forcing managed API with isolated data root at ${isolatedDataRoot.rootDir}`);
    const started = await startManagedApi(isolatedDataRoot);
    managedApi = started.process;
    apiUrl = started.apiUrl;
  } else {
    const currentApi = await checkApiReady(apiUrl);
    if (!currentApi.ok) {
    console.warn(
      `[e2e-bootstrap] default API not mission-ready at ${apiUrl} (${currentApi.reason ?? 'unknown reason'}).`,
    );
    console.warn(`[e2e-bootstrap] starting managed API on fallback port ${FALLBACK_API_PORT}...`);
    const started = await startManagedApi(isolatedDataRoot);
    managedApi = started.process;
    apiUrl = started.apiUrl;
    }
  }

  process.env.API_URL = apiUrl;
  console.log(`[e2e-bootstrap] running mission E2E against ${apiUrl}`);

  try {
    const code = await runRawMissionsScript();
    process.exit(code);
  } finally {
    if (managedApi && managedApi.exitCode === null) {
      managedApi.kill('SIGTERM');
      await once(managedApi, 'exit').catch(() => {});
    }
    if (CLEANUP_TEST_RUN_DIR) {
      await cleanupE2eRunRoot(isolatedDataRoot.rootDir).catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`[e2e-bootstrap] warning: could not cleanup isolated data root: ${message}`);
      });
    }
  }
}

main().catch((err) => {
  console.error(`[e2e-bootstrap] fatal=${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
