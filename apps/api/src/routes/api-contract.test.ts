import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type RouteMethod = HttpMethod | 'WS';

interface FrontendContract {
  fn: string;
  method: RouteMethod;
  path: string;
  sourcePattern: RegExp;
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');

function readRepoFile(relativePath: string): string {
  return readFileSync(resolve(ROOT, relativePath), 'utf8');
}

function normalizeRoutePath(path: string): string {
  if (path.length > 1) return path.replace(/\/+$/, '');
  return path;
}

function routeKey(method: RouteMethod, path: string): string {
  return `${method} ${normalizeRoutePath(path)}`;
}

function collectBackendContracts(): Set<string> {
  const files = [
    'apps/api/src/routes/api.ts',
    'apps/api/src/routes/version-routes.ts',
    'apps/api/src/routes/preview-routes.ts',
    'apps/api/src/routes/llm-routes.ts',
    'apps/api/src/routes/websocket.ts',
  ];

  const contracts = new Set<string>();

  for (const file of files) {
    const source = readRepoFile(file);

    const directRouteRe = /app\.(get|post|put|patch|delete)\(\s*['"`]([^'"`]+)['"`]/g;
    for (const match of source.matchAll(directRouteRe)) {
      const method = match[1]?.toUpperCase() as HttpMethod;
      const path = match[2];
      contracts.add(routeKey(method, path));
    }

    const routeObjectRe = /app\.route\(\s*\{([\s\S]*?)\}\s*\)/g;
    for (const blockMatch of source.matchAll(routeObjectRe)) {
      const block = blockMatch[1] ?? '';
      const urlMatch = block.match(/url:\s*['"`]([^'"`]+)['"`]/);
      const methodMatch = block.match(/method:\s*(\[[\s\S]*?\]|['"`][^'"`]+['"`])/);
      if (!urlMatch || !methodMatch) continue;
      const path = urlMatch[1];
      const rawMethod = methodMatch[1].trim();
      const methods = rawMethod.startsWith('[')
        ? [...rawMethod.matchAll(/['"`]([A-Za-z]+)['"`]/g)].map((m) => m[1]?.toUpperCase() as HttpMethod)
        : [rawMethod.replace(/['"`]/g, '').toUpperCase() as HttpMethod];
      for (const method of methods) {
        contracts.add(routeKey(method, path));
      }
    }

    const wsRouteRe = /app\.get\(\s*['"`]([^'"`]+)['"`]\s*,\s*\{[\s\S]*?websocket:\s*true[\s\S]*?\}/g;
    for (const wsMatch of source.matchAll(wsRouteRe)) {
      contracts.add(routeKey('WS', wsMatch[1]));
    }
  }

  return contracts;
}

function extractExportedFunctions(source: string): string[] {
  return [...source.matchAll(/export\s+(?:async\s+)?function\s+([A-Za-z0-9_]+)\s*\(/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function extractUnionMembers(source: string, typeName: string): string[] {
  const unionMatch = source.match(
    new RegExp(`export\\s+type\\s+${typeName}\\s*=([\\s\\S]*?);`),
  );
  assert.ok(unionMatch, `Type union ${typeName} must exist`);
  const body = unionMatch[1] ?? '';
  return [...body.matchAll(/'([^']+)'/g)]
    .map((match) => match[1])
    .filter(Boolean);
}

function assertSameMembers(actual: string[], expected: string[], label: string): void {
  const actualSorted = [...actual].sort();
  const expectedSorted = [...expected].sort();
  assert.deepEqual(actualSorted, expectedSorted, `${label} must match shared enum members`);
}

const FRONTEND_CONTRACTS: FrontendContract[] = [
  {
    fn: 'generateProject',
    method: 'POST',
    path: '/api/projects',
    sourcePattern: /export\s+async\s+function\s+generateProject[\s\S]*?request<[\s\S]*?>\('\/api\/projects',\s*\{[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'listProjects',
    method: 'GET',
    path: '/api/projects',
    sourcePattern: /export\s+async\s+function\s+listProjects[\s\S]*?request<[\s\S]*?>\('\/api\/projects'\)/,
  },
  {
    fn: 'checkBackendReachable',
    method: 'GET',
    path: '/api/projects',
    sourcePattern: /export\s+async\s+function\s+checkBackendReachable[\s\S]*?request<[\s\S]*?>\('\/api\/projects'/,
  },
  {
    fn: 'getProject',
    method: 'GET',
    path: '/api/projects/:id',
    sourcePattern: /export\s+async\s+function\s+getProject[\s\S]*?`\/api\/projects\/\$\{projectId\}`/,
  },
  {
    fn: 'getProjectDetail',
    method: 'GET',
    path: '/api/projects/:id',
    sourcePattern: /export\s+async\s+function\s+getProjectDetail[\s\S]*?`\/api\/projects\/\$\{projectId\}`/,
  },
  {
    fn: 'getProjectFiles',
    method: 'GET',
    path: '/api/projects/:id/files',
    sourcePattern: /export\s+async\s+function\s+getProjectFiles[\s\S]*?`\/api\/projects\/\$\{projectId\}\/files`/,
  },
  {
    fn: 'getProjectFile',
    method: 'GET',
    path: '/api/projects/:id/files/*',
    sourcePattern: /export\s+async\s+function\s+getProjectFile[\s\S]*?`\/api\/projects\/\$\{projectId\}\/files\/\$\{encodedPath\}`/,
  },
  {
    fn: 'getProjectRevisionState', method: 'GET', path: '/api/projects/:id/versions',
    sourcePattern: /export\s+async\s+function\s+getProjectRevisionState[\s\S]*?`\/api\/projects\/\$\{projectId\}\/versions`/,
  },
  {
    fn: 'getProjectRuntime', method: 'GET', path: '/api/projects/:id/runtime',
    sourcePattern: /export\s+async\s+function\s+getProjectRuntime[\s\S]*?`\/api\/projects\/\$\{projectId\}\/runtime`/,
  },
  {
    fn: 'getProjectMemories', method: 'GET', path: '/api/projects/:id/memories',
    sourcePattern: /export\s+async\s+function\s+getProjectMemories[\s\S]*?`\/api\/projects\/\$\{projectId\}\/memories/,
  },
  {
    fn: 'createProjectMemory', method: 'POST', path: '/api/projects/:id/memories',
    sourcePattern: /export\s+async\s+function\s+createProjectMemory[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'updateProjectMemory', method: 'PATCH', path: '/api/projects/:id/memories/:memoryId',
    sourcePattern: /export\s+async\s+function\s+updateProjectMemory[\s\S]*?method:\s*'PATCH'/,
  },
  {
    fn: 'deleteProjectMemory', method: 'DELETE', path: '/api/projects/:id/memories/:memoryId',
    sourcePattern: /export\s+async\s+function\s+deleteProjectMemory[\s\S]*?method:\s*'DELETE'/,
  },
  {
    fn: 'controlProjectRuntime', method: 'POST', path: '/api/projects/:id/runtime/control',
    sourcePattern: /export\s+async\s+function\s+controlProjectRuntime[\s\S]*?runtime\/control[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'commitProjectFile', method: 'PUT', path: '/api/projects/:id/files/*',
    sourcePattern: /export\s+async\s+function\s+commitProjectFile[\s\S]*?method:\s*'PUT'/,
  },
  {
    fn: 'createProjectCheckpoint', method: 'POST', path: '/api/projects/:id/checkpoints',
    sourcePattern: /export\s+async\s+function\s+createProjectCheckpoint[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'restoreProjectCheckpoint', method: 'POST', path: '/api/projects/:id/versions/:version/restore',
    sourcePattern: /export\s+async\s+function\s+restoreProjectCheckpoint[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'branchProjectRevision', method: 'POST', path: '/api/projects/:id/versions/:version/branch',
    sourcePattern: /export\s+async\s+function\s+branchProjectRevision[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'compareProjectRevisions', method: 'GET', path: '/api/projects/:id/versions/compare',
    sourcePattern: /export\s+async\s+function\s+compareProjectRevisions[\s\S]*?versions\/compare\?from=/,
  },
  {
    fn: 'updateProject',
    method: 'POST',
    path: '/api/projects/:id/prompts',
    sourcePattern: /export\s+async\s+function\s+updateProject[\s\S]*?`\/api\/projects\/\$\{projectId\}\/prompts`[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'getProjectPromptHistory',
    method: 'GET',
    path: '/api/projects/:id/prompts',
    sourcePattern: /export\s+async\s+function\s+getProjectPromptHistory[\s\S]*?`\/api\/projects\/\$\{projectId\}\/prompts`/,
  },
  {
    fn: 'getProjectVersions',
    method: 'GET',
    path: '/api/projects/:id/versions',
    sourcePattern: /export\s+async\s+function\s+getProjectVersions[\s\S]*?`\/api\/projects\/\$\{projectId\}\/versions`/,
  },
  {
    fn: 'getPreviewHealth',
    method: 'GET',
    path: '/api/preview/health',
    sourcePattern: /export\s+async\s+function\s+getPreviewHealth[\s\S]*?'\/api\/preview\/health'/,
  },
  {
    fn: 'getPreviewStatus',
    method: 'GET',
    path: '/api/projects/:id/preview/status',
    sourcePattern: /export\s+async\s+function\s+getPreviewStatus[\s\S]*?`\/api\/projects\/\$\{projectId\}\/preview\/status`/,
  },
  {
    fn: 'startPreview',
    method: 'POST',
    path: '/api/projects/:id/preview/start',
    sourcePattern: /export\s+async\s+function\s+startPreview[\s\S]*?`\/api\/projects\/\$\{projectId\}\/preview\/start`[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'reportIframeReady',
    method: 'POST',
    path: '/api/projects/:id/preview/iframe-ready',
    sourcePattern: /export\s+async\s+function\s+reportIframeReady[\s\S]*?`\/api\/projects\/\$\{projectId\}\/preview\/iframe-ready`[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'stopPreview',
    method: 'POST',
    path: '/api/projects/:id/preview/stop',
    sourcePattern: /export\s+async\s+function\s+stopPreview[\s\S]*?`\/api\/projects\/\$\{projectId\}\/preview\/stop`[\s\S]*?method:\s*'POST'/,
  },
  {
    fn: 'exportProject',
    method: 'GET',
    path: '/api/projects/:id/export',
    sourcePattern: /export\s+async\s+function\s+exportProject[\s\S]*?const\s+url\s*=\s*`\$\{API_BASE\}\/api\/projects\/\$\{projectId\}\/export`/,
  },
  {
    fn: 'getSessionProgress',
    method: 'GET',
    path: '/api/sessions/:id/progress',
    sourcePattern: /export\s+async\s+function\s+getSessionProgress[\s\S]*?`\/api\/sessions\/\$\{sessionId\}\/progress`/,
  },
  {
    fn: 'listActiveSessions',
    method: 'GET',
    path: '/api/sessions/active',
    sourcePattern: /export\s+async\s+function\s+listActiveSessions[\s\S]*?'\/api\/sessions\/active'/,
  },
  {
    fn: 'openSessionSocket',
    method: 'WS',
    path: '/ws/sessions/:id/progress',
    sourcePattern: /export\s+function\s+openSessionSocket[\s\S]*?\/ws\/sessions\/\$\{sessionId\}\/progress/,
  },
];

test('frontend API functions map to real backend routes', () => {
  const backendContracts = collectBackendContracts();
  for (const contract of FRONTEND_CONTRACTS) {
    const key = routeKey(contract.method, contract.path);
    assert.ok(
      backendContracts.has(key),
      `Missing backend route for ${contract.fn}: ${key}`,
    );
  }
});

test('preview iframe fallback proxy route exists on backend', () => {
  const backendContracts = collectBackendContracts();
  assert.ok(backendContracts.has(routeKey('GET', '/preview/:id/*')));
  assert.ok(backendContracts.has(routeKey('GET', '/preview/:id')));
  const apiClientSource = readRepoFile('apps/web/lib/api.ts');
  assert.match(
    apiClientSource,
    /return\s+`\$\{API_BASE\}\/preview\/\$\{projectId\}\/`;/,
  );
});

test('frontend API source paths and methods follow the contract map', () => {
  const apiClientSource = readRepoFile('apps/web/lib/api.ts');
  for (const contract of FRONTEND_CONTRACTS) {
    assert.match(
      apiClientSource,
      contract.sourcePattern,
      `api.ts contract drift in ${contract.fn}`,
    );
  }
});

test('api client exports only supported functions', () => {
  const apiClientSource = readRepoFile('apps/web/lib/api.ts');
  const exportedFunctions = new Set(extractExportedFunctions(apiClientSource));
  const supportedRouteFns = new Set(FRONTEND_CONTRACTS.map((contract) => contract.fn));
  const supportedUtilityFns = new Set([
    'setApiAuthToken',
    'normalizeProject',
    'normalizeFileEntry',
    'normalizeFileContent',
    'previewIframeUrl',
  ]);

  for (const fn of exportedFunctions) {
    assert.ok(
      supportedRouteFns.has(fn) || supportedUtilityFns.has(fn),
      `Unsupported exported function in api client: ${fn}`,
    );
  }
});

test('legacy unsupported client helpers are removed', () => {
  const apiClientSource = readRepoFile('apps/web/lib/api.ts');
  assert.doesNotMatch(apiClientSource, /\brestoreProjectVersion\b/);
  assert.doesNotMatch(apiClientSource, /\bgetContainerInfo\b/);
});

test('preview and project status enums match shared types', () => {
  const sharedSource = readRepoFile('packages/types/src/index.ts');
  const sharedPreviewLifecycle = extractUnionMembers(sharedSource, 'PreviewLifecycleStatus');
  const sharedPreviewHealth = extractUnionMembers(sharedSource, 'PreviewHealthStatus');
  const sharedProjectLifecycle = extractUnionMembers(sharedSource, 'ProjectLifecycleStatus');

  const webProjectStatusSource = readRepoFile('apps/web/lib/project-status.ts');
  const webPreviewTruthSource = readRepoFile('apps/web/src/features/preview/model/preview-truth.ts');
  const apiPreviewTypesSource = readRepoFile('apps/api/src/preview/types.ts');
  const apiProjectStoreSource = readRepoFile('apps/api/src/storage/project-store.ts');

  const webRawPreview = extractUnionMembers(webProjectStatusSource, 'RawPreviewStatus');
  const webRawProject = extractUnionMembers(webProjectStatusSource, 'RawProjectStatus');
  const webPreviewTruthProject = extractUnionMembers(webPreviewTruthSource, 'ProjectStatus');

  assertSameMembers(webRawPreview, sharedPreviewLifecycle, 'RawPreviewStatus');
  assertSameMembers(webRawProject, sharedProjectLifecycle, 'RawProjectStatus');
  assertSameMembers(webPreviewTruthProject, sharedProjectLifecycle, 'preview-truth ProjectStatus');

  assert.match(apiPreviewTypesSource, /state:\s*PreviewLifecycleStatus;/);
  assert.match(apiPreviewTypesSource, /health:\s*PreviewHealthStatus;/);
  assert.match(apiProjectStoreSource, /status:\s*ProjectLifecycleStatus;/);
  assert.match(apiProjectStoreSource, /projectStatus\?:\s*ProjectLifecycleStatus;/);
  assert.match(apiProjectStoreSource, /previewHealthStatus\?:\s*PreviewHealthStatus;/);

  assert.ok(sharedPreviewHealth.includes('unknown'));
  assert.ok(sharedPreviewHealth.includes('healthy'));
  assert.ok(sharedPreviewHealth.includes('placeholder'));
  assert.ok(sharedPreviewHealth.includes('broken'));
});
