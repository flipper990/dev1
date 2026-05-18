import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runTier3ContractFirstGeneration, validateTier3FrontendBackendContract } from './tier3-contract-runner.js';

const loggerStub = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as any;

test('tier3 frontend/backend contract mismatch caught before final build', () => {
  const files = [
    {
      path: 'src/contracts/api-contract.ts',
      content: "export interface ApiContract { listUsers: { route: '/api/users'; method: 'GET' } }\n",
    },
    {
      path: 'src/lib/api-client.ts',
      content: 'export async function fetchUsers(){ return []; }\n',
    },
    {
      path: 'src/app/api/users/route.ts',
      content: 'export async function POST(){ return Response.json([]); }\n',
    },
  ];

  const out = validateTier3FrontendBackendContract(files);
  assert.equal(out.ok, false);
  assert.ok(out.diagnostics.some((d) => /listUsers/.test(d)));
  assert.ok(out.diagnostics.some((d) => /GET handler/.test(d)));
});

test('tier3 contract runner retains required src/contracts artifacts through assembly normalization', async () => {
  const result = await runTier3ContractFirstGeneration({
    projectId: 'tier3-contract-test',
    prompt: 'Build a fullstack SaaS app with user accounts, projects, dashboard, API routes, and persistent CRUD data model.',
    logger: loggerStub,
  });

  const paths = new Set(result.files.map((f) => f.path.replace(/\\/g, '/')));
  assert.ok(paths.has('src/contracts/api-contract.ts'));
  assert.ok(paths.has('src/contracts/data-model-contract.ts'));
  assert.ok(paths.has('src/contracts/route-contract.ts'));
  assert.ok(paths.has('src/contracts/boundary-contract.ts'));
  assert.ok(paths.has('src/app/page.tsx'));
  assert.equal(result.validation.some((item) => item.verdict === 'rejected' && item.manifest.path.startsWith('src/contracts/')), false);
  assert.equal(result.validation.some((item) => item.verdict === 'rejected' && item.manifest.path === 'src/app/page.tsx'), false);
});
