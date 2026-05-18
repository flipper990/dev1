import { createHash } from 'node:crypto';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import { validateAndFixDependencies } from '../../../../packages/agent-core/src/dependency-validator.js';
import { REACT_18_NEXT_15 } from '../../../../packages/agent-core/src/stack-compatibility.js';
import { describeIntegrityFailure, runFinalIntegrityGate } from './final-integrity-gate.js';
import { validateSliceManifest, type TierSliceManifest } from './tier-slice-validator.js';
import { TIER3_REQUIRED_CONTRACT_PATHS, validateTier3RequiredContracts } from './tier-policy.js';
import type { PromptTierClassification } from './prompt-tier-classifier.js';

interface Tier3WorkerOutput {
  worker: 'product-spec' | 'architecture' | 'contract' | 'frontend' | 'backend' | 'database' | 'integration';
  manifests: TierSliceManifest[];
}

export interface Tier3File {
  path: string;
  content: string;
  language?: string;
}

export interface Tier3Result {
  files: Tier3File[];
  workerOutputs: Tier3WorkerOutput[];
  validation: Array<{ manifest: TierSliceManifest; verdict: 'pass' | 'rejected'; issues: string[] }>;
  phaseDurations: Record<string, number>;
  slicesGenerated: number;
  slicesRejected: number;
  slicesRepaired: number;
  retries: number;
  finalBuildDurationMs: number;
  contracts: {
    apiContractPath: string;
    dataModelContractPath: string;
    routeContractPath: string;
    boundaryContractPath: string;
  };
}

export interface RunTier3Options {
  projectId: string;
  prompt: string;
  logger: Logger;
}

class Tier3ContractMissingError extends Error {
  readonly code = 'tier3_contract_missing';
  readonly missingPaths: string[];

  constructor(missingPaths: string[]) {
    super(`tier3_contract_missing: required contract artifacts missing: ${missingPaths.join(', ')}`);
    this.name = 'Tier3ContractMissingError';
    this.missingPaths = missingPaths;
  }
}

class PhaseTimer {
  private starts = new Map<string, number>();
  private durations: Record<string, number> = {};
  begin(phase: string): void { this.starts.set(phase, Date.now()); }
  end(phase: string): void {
    const started = this.starts.get(phase);
    if (!started) return;
    this.durations[phase] = (this.durations[phase] ?? 0) + (Date.now() - started);
    this.starts.delete(phase);
  }
  snapshot(): Record<string, number> { return { ...this.durations }; }
}

function extractImports(content: string): string[] {
  const out = new Set<string>();
  for (const m of content.matchAll(/from\s+['"]([^'"]+)['"]/g)) out.add(String(m[1] ?? ''));
  return [...out];
}

function extractExports(content: string): string[] {
  const out = new Set<string>();
  if (/export\s+default\s+/m.test(content)) out.add('default');
  for (const m of content.matchAll(/export\s+(?:async\s+)?(?:const|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)) {
    out.add(String(m[1]));
  }
  return [...out];
}

function manifest(path: string, content: string, purpose: string): TierSliceManifest {
  const imports = extractImports(content);
  return {
    path,
    content,
    purpose,
    imports,
    exports: extractExports(content),
    dependencies: imports.filter((i) => !i.startsWith('./') && !i.startsWith('../') && !i.startsWith('@/')),
  };
}

function languageFor(path: string): string | undefined {
  if (path.endsWith('.tsx')) return 'typescriptreact';
  if (path.endsWith('.ts')) return 'typescript';
  if (path.endsWith('.css')) return 'css';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.js') || path.endsWith('.mjs') || path.endsWith('.cjs')) return 'javascript';
  return undefined;
}

function foundation(prompt: string): Tier3File[] {
  const deps = REACT_18_NEXT_15.versions;
  const name = `generated-tier3-${createHash('sha1').update(prompt).digest('hex').slice(0, 8)}`;
  return [
    {
      path: 'package.json',
      content: JSON.stringify({
        name,
        private: true,
        version: '0.1.0',
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          typecheck: 'tsc --noEmit',
          preview: 'next build && next start',
        },
        dependencies: {
          next: deps.next,
          react: deps.react,
          'react-dom': deps['react-dom'],
        },
        devDependencies: {
          typescript: deps.typescript,
          '@types/react': deps['@types/react'],
          '@types/react-dom': deps['@types/react-dom'],
          '@types/node': deps['@types/node'],
        },
      }, null, 2) + '\n',
      language: 'json',
    },
    {
      path: 'tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022',
          lib: ['dom', 'dom.iterable', 'es2022'],
          allowJs: false,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          module: 'ESNext',
          moduleResolution: 'Bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          baseUrl: '.',
          paths: { '@/*': ['./src/*'] },
          esModuleInterop: true,
          plugins: [{ name: 'next' }],
        },
        include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
        exclude: ['node_modules'],
      }, null, 2) + '\n',
      language: 'json',
    },
    { path: 'next.config.mjs', content: 'const nextConfig = { reactStrictMode: true };\nexport default nextConfig;\n', language: 'javascript' },
    { path: 'postcss.config.js', content: 'module.exports = { plugins: {} };\n', language: 'javascript' },
    { path: 'next-env.d.ts', content: '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n', language: 'typescript' },
    {
      path: 'src/app/layout.tsx',
      content: "import './globals.css';\n\nexport default function RootLayout({ children }: { children: React.ReactNode }) {\n  return <html lang=\"en\"><body>{children}</body></html>;\n}\n",
      language: 'typescriptreact',
    },
    {
      path: 'src/app/globals.css',
      content: 'body { margin: 0; font-family: ui-sans-serif, system-ui; background: #0b1020; color: #e2e8f0; }\nmain { padding: 24px; }\nsection { margin-block: 12px; }\n',
      language: 'css',
    },
  ];
}

function productSpecWorker(prompt: string): Tier3WorkerOutput {
  return {
    worker: 'product-spec',
    manifests: [
      manifest('src/contracts/product-spec.ts', `export const productSpec = { summary: ${JSON.stringify(prompt)}, objective: 'deliver tier3 fullstack flow' } as const;\n`, 'product-spec'),
    ],
  };
}

function architectureWorker(): Tier3WorkerOutput {
  return {
    worker: 'architecture',
    manifests: [
      manifest('src/contracts/architecture.ts', "export const architecture = { frontend: 'next-app-router', backend: 'next-route-handlers', database: 'schema-contract', integration: 'http-adapter' } as const;\n", 'architecture'),
    ],
  };
}

function contractWorker(): Tier3WorkerOutput {
  return {
    worker: 'contract',
    manifests: [
      manifest('src/contracts/api-contract.ts', "export type ApiRoute = '/api/users' | '/api/users/[id]';\nexport interface ApiContract {\n  listUsers: { route: '/api/users'; method: 'GET'; response: Array<{ id: string; email: string; role: 'owner' | 'member' }>; };\n}\n", 'api-contract'),
      manifest('src/contracts/data-model-contract.ts', "export interface UserModel { id: string; email: string; role: 'owner' | 'member'; }\nexport interface SessionModel { userId: string; token: string; }\n", 'data-model-contract'),
      manifest('src/contracts/route-contract.ts', "export const routeContract = [{ route: '/api/users', method: 'GET' }] as const;\n", 'route-contract'),
      manifest('src/contracts/boundary-contract.ts', "export interface FrontendBackendBoundary {\n  clientModule: '@/lib/api-client';\n  serverModule: '@/app/api/users/route';\n  schemaModule: '@/contracts/data-model-contract';\n}\n", 'boundary-contract'),
    ],
  };
}

function frontendWorker(): Tier3WorkerOutput {
  return {
    worker: 'frontend',
    manifests: [
      manifest('src/lib/api-client.ts', "import type { UserModel } from '@/contracts/data-model-contract';\n\nexport async function listUsers(): Promise<UserModel[]> {\n  const res = await fetch('/api/users', { cache: 'no-store' });\n  if (!res.ok) throw new Error(`users request failed: ${res.status}`);\n  return await res.json() as UserModel[];\n}\n", 'frontend-api-client'),
      manifest('src/app/page.tsx', "'use client';\n\nimport { useEffect, useState } from 'react';\nimport { listUsers } from '@/lib/api-client';\n\ninterface UserView { id: string; email: string; role: 'owner' | 'member'; }\n\nexport default function HomePage() {\n  const [users, setUsers] = useState<UserView[]>([]);\n  const [error, setError] = useState<string | null>(null);\n\n  useEffect(() => {\n    listUsers().then(setUsers).catch((err) => setError(err instanceof Error ? err.message : String(err)));\n  }, []);\n\n  return (\n    <main>\n      <h1>Tier3 Fullstack Contract App</h1>\n      {error ? <p role=\"alert\">{error}</p> : null}\n      <section>\n        <h2>Users</h2>\n        <ul>{users.map((u) => <li key={u.id}>{u.email} ({u.role})</li>)}</ul>\n      </section>\n    </main>\n  );\n}\n", 'frontend-page'),
    ],
  };
}

function backendWorker(): Tier3WorkerOutput {
  return {
    worker: 'backend',
    manifests: [
      manifest('src/app/api/users/route.ts', "import type { UserModel } from '@/contracts/data-model-contract';\n\nconst USERS: UserModel[] = [\n  { id: 'u1', email: 'owner@example.com', role: 'owner' },\n  { id: 'u2', email: 'member@example.com', role: 'member' },\n];\n\nexport async function GET(): Promise<Response> {\n  return Response.json(USERS);\n}\n", 'backend-route-handler'),
      manifest('src/server/services/user-service.ts', "import type { UserModel } from '@/contracts/data-model-contract';\n\nexport function listContractUsers(): UserModel[] {\n  return [\n    { id: 'u1', email: 'owner@example.com', role: 'owner' },\n    { id: 'u2', email: 'member@example.com', role: 'member' },\n  ];\n}\n", 'backend-service'),
    ],
  };
}

function databaseWorker(): Tier3WorkerOutput {
  return {
    worker: 'database',
    manifests: [
      manifest('src/server/db/schema.ts', "export interface TableSchema { table: string; columns: Array<{ name: string; type: string; nullable?: boolean }>; }\n\nexport const schema: TableSchema[] = [\n  { table: 'users', columns: [{ name: 'id', type: 'uuid' }, { name: 'email', type: 'text' }, { name: 'role', type: 'text' }] },\n  { table: 'sessions', columns: [{ name: 'user_id', type: 'uuid' }, { name: 'token', type: 'text' }] },\n];\n", 'database-contract-schema'),
    ],
  };
}

function integrationWorker(): Tier3WorkerOutput {
  return {
    worker: 'integration',
    manifests: [
      manifest('src/server/integrations/http-client.ts', "export interface HttpCall<T> { ok: boolean; status: number; payload: T; }\n\nexport async function executeHttpCall<T>(payload: T): Promise<HttpCall<T>> {\n  return { ok: true, status: 200, payload };\n}\n", 'integration-adapter'),
    ],
  };
}

function requiredContractsFromAccepted(accepted: TierSliceManifest[]): { ok: boolean; missing: string[] } {
  return validateTier3RequiredContracts(accepted.map((slice) => ({ path: slice.path })));
}

function validateTier3ContractArtifacts(accepted: TierSliceManifest[]): { ok: boolean; diagnostics: string[] } {
  const diagnostics: string[] = [];
  const byPath = new Map(accepted.map((slice) => [slice.path.replace(/\\/g, '/'), slice]));
  const required = requiredContractsFromAccepted(accepted);
  if (!required.ok) diagnostics.push(...required.missing.map((p) => `missing contract artifact: ${p}`));

  const apiContract = byPath.get('src/contracts/api-contract.ts');
  if (!apiContract || (!apiContract.exports.includes('ApiContract') && !apiContract.exports.includes('ApiRoute'))) {
    diagnostics.push('src/contracts/api-contract.ts must export ApiContract or ApiRoute');
  }

  const dataModel = byPath.get('src/contracts/data-model-contract.ts');
  if (!dataModel || !dataModel.exports.includes('UserModel')) {
    diagnostics.push('src/contracts/data-model-contract.ts must export UserModel');
  }

  const routeContract = byPath.get('src/contracts/route-contract.ts');
  if (!routeContract || !routeContract.exports.includes('routeContract')) {
    diagnostics.push('src/contracts/route-contract.ts must export routeContract');
  }

  const boundary = byPath.get('src/contracts/boundary-contract.ts');
  if (!boundary || !boundary.exports.includes('FrontendBackendBoundary')) {
    diagnostics.push('src/contracts/boundary-contract.ts must export FrontendBackendBoundary');
  }

  return { ok: diagnostics.length === 0, diagnostics };
}

export function validateTier3FrontendBackendContract(files: Array<{ path: string; content: string }>): { ok: boolean; diagnostics: string[] } {
  const byPath = new Map(files.map((f) => [f.path.replace(/\\/g, '/'), f.content]));
  const diagnostics: string[] = [];
  const apiContract = byPath.get('src/contracts/api-contract.ts') ?? '';
  const apiClient = byPath.get('src/lib/api-client.ts') ?? '';
  const routeHandler = byPath.get('src/app/api/users/route.ts') ?? '';

  if (!/listUsers/.test(apiContract)) diagnostics.push('api contract missing listUsers operation');
  if (!/listUsers\(/.test(apiClient)) diagnostics.push('api client missing listUsers implementation');
  if (!/\/api\/users/.test(apiContract)) diagnostics.push('api contract missing /api/users route');
  if (!/export\s+async\s+function\s+GET/.test(routeHandler)) diagnostics.push('backend route missing GET handler for /api/users');

  return { ok: diagnostics.length === 0, diagnostics };
}

export async function runTier3ContractFirstGeneration(opts: RunTier3Options): Promise<Tier3Result> {
  const timer = new PhaseTimer();
  const workerOutputs: Tier3WorkerOutput[] = [];
  const accepted: TierSliceManifest[] = [];
  const validation: Tier3Result['validation'] = [];

  timer.begin('template_ready');
  const files: Tier3File[] = [...foundation(opts.prompt)];
  timer.end('template_ready');

  const applyWorkerOutput = (output: Tier3WorkerOutput): void => {
    workerOutputs.push(output);
    for (const m of output.manifests) {
      timer.begin('slice_validating');
      const issues = validateSliceManifest('TIER_3_FULLSTACK' as PromptTierClassification, m, accepted);
      timer.end('slice_validating');
      if (issues.length > 0) {
        validation.push({ manifest: m, verdict: 'rejected', issues: issues.map((i) => `${i.code}: ${i.message}`) });
        continue;
      }
      accepted.push(m);
      validation.push({ manifest: m, verdict: 'pass', issues: [] });
    }
  };

  const runWorker = (
    phase: string,
    fn: () => Tier3WorkerOutput,
  ): Tier3WorkerOutput => {
    timer.begin(phase);
    const output = fn();
    timer.end(phase);
    applyWorkerOutput(output);
    return output;
  };

  runWorker('product_spec_generating', () => productSpecWorker(opts.prompt));
  if (!accepted.some((slice) => slice.path === 'src/contracts/product-spec.ts')) {
    throw new Error('tier3_contract_missing: product spec missing at src/contracts/product-spec.ts');
  }

  runWorker('architecture_generating', architectureWorker);
  if (!accepted.some((slice) => slice.path === 'src/contracts/architecture.ts')) {
    throw new Error('tier3_contract_missing: architecture plan missing at src/contracts/architecture.ts');
  }

  runWorker('contract_generating', contractWorker);
  timer.begin('contract_validating');
  const contractArtifacts = validateTier3ContractArtifacts(accepted);
  timer.end('contract_validating');
  if (!contractArtifacts.ok) {
    const missing = contractArtifacts.diagnostics
      .filter((d) => d.startsWith('missing contract artifact: '))
      .map((d) => d.slice('missing contract artifact: '.length));
    if (missing.length > 0) throw new Tier3ContractMissingError(missing);
    throw new Error(`tier3 contract artifacts invalid: ${contractArtifacts.diagnostics.join(' | ')}`);
  }

  runWorker('frontend_slice_generating', frontendWorker);
  runWorker('backend_slice_generating', backendWorker);
  runWorker('database_slice_generating', databaseWorker);
  runWorker('integration_slice_generating', integrationWorker);

  timer.begin('assembling');
  for (const slice of accepted) files.push({ path: slice.path, content: slice.content, language: languageFor(slice.path) });
  const fixed = validateAndFixDependencies(files.map((f) => ({ path: f.path, content: f.content })));
  const assembled = fixed.files.map((f) => ({ path: f.path, content: f.content, language: languageFor(f.path) }));
  timer.end('assembling');

  const requiredContracts = validateTier3RequiredContracts(assembled);
  if (!requiredContracts.ok) {
    throw new Tier3ContractMissingError(requiredContracts.missing);
  }

  const retainedContracts = TIER3_REQUIRED_CONTRACT_PATHS.filter((requiredPath) =>
    assembled.some((file) => file.path.replace(/\\/g, '/') === requiredPath),
  );
  if (retainedContracts.length !== TIER3_REQUIRED_CONTRACT_PATHS.length) {
    const missingAfterAssembly = TIER3_REQUIRED_CONTRACT_PATHS.filter((requiredPath) => !retainedContracts.includes(requiredPath));
    throw new Tier3ContractMissingError([...missingAfterAssembly]);
  }

  const contractMatch = validateTier3FrontendBackendContract(assembled);
  if (!contractMatch.ok) {
    throw new Error(`tier3 frontend/backend contract mismatch: ${contractMatch.diagnostics.join(' | ')}`);
  }

  timer.begin('final_build');
  const integrity = runFinalIntegrityGate(assembled);
  timer.end('final_build');
  if (integrity.verdict !== 'pass') {
    throw new Error(`tier3 integrity failed: ${describeIntegrityFailure(integrity)}`);
  }

  const phaseDurations = timer.snapshot();
  const slicesGenerated = workerOutputs.reduce((n, w) => n + w.manifests.length, 0);
  const slicesRejected = validation.filter((v) => v.verdict === 'rejected').length;

  return {
    files: assembled,
    workerOutputs,
    validation,
    phaseDurations,
    slicesGenerated,
    slicesRejected,
    slicesRepaired: 0,
    retries: 0,
    finalBuildDurationMs: phaseDurations.final_build ?? 0,
    contracts: {
      apiContractPath: 'src/contracts/api-contract.ts',
      dataModelContractPath: 'src/contracts/data-model-contract.ts',
      routeContractPath: 'src/contracts/route-contract.ts',
      boundaryContractPath: 'src/contracts/boundary-contract.ts',
    },
  };
}
