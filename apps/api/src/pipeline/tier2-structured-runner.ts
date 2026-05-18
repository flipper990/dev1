import { createHash } from 'node:crypto';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import { validateAndFixDependencies } from '../../../../packages/agent-core/src/dependency-validator.js';
import { REACT_18_NEXT_15 } from '../../../../packages/agent-core/src/stack-compatibility.js';
import { describeIntegrityFailure, runFinalIntegrityGate } from './final-integrity-gate.js';
import { enforceDeterministicGenerationContract } from './deterministic-generation-contract.js';
import { validateSliceManifest, type TierSliceManifest } from './tier-slice-validator.js';
import type { PromptTierClassification } from './prompt-tier-classifier.js';

interface Tier2WorkerOutput {
  worker: 'planner' | 'routes' | 'components' | 'state-form' | 'mock-data';
  manifests: TierSliceManifest[];
}

export interface Tier2File {
  path: string;
  content: string;
  language?: string;
}

export interface Tier2Result {
  files: Tier2File[];
  workerOutputs: Tier2WorkerOutput[];
  validation: Array<{ manifest: TierSliceManifest; verdict: 'pass' | 'rejected'; issues: string[] }>;
  phaseDurations: Record<string, number>;
  slicesGenerated: number;
  slicesRejected: number;
  slicesRepaired: number;
  retries: number;
  finalBuildDurationMs: number;
}

export interface RunTier2Options {
  projectId: string;
  prompt: string;
  logger: Logger;
}

const PHASES = [
  'template_ready',
  'app_planner_generating',
  'route_slice_generating',
  'component_slice_generating',
  'state_form_slice_generating',
  'mock_data_generating',
  'slice_validating',
  'assembling',
  'final_build',
] as const;

type PhaseName = (typeof PHASES)[number];

class PhaseTimer {
  private start = new Map<PhaseName, number>();
  private durations: Record<string, number> = {};

  begin(phase: PhaseName): void { this.start.set(phase, Date.now()); }
  end(phase: PhaseName): void {
    const s = this.start.get(phase);
    if (!s) return;
    this.durations[phase] = (this.durations[phase] ?? 0) + (Date.now() - s);
    this.start.delete(phase);
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
  for (const m of content.matchAll(/export\s+(?:const|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)) out.add(String(m[1]));
  for (const m of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    for (const token of String(m[1]).split(',')) {
      const clean = token.trim().split(/\s+as\s+/i)[0]?.trim();
      if (clean) out.add(clean);
    }
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

function foundation(prompt: string): Tier2File[] {
  const deps = REACT_18_NEXT_15.versions;
  const name = `generated-tier2-${createHash('sha1').update(prompt).digest('hex').slice(0, 8)}`;
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
      content: ':root { color-scheme: light; }\n* { box-sizing: border-box; }\nbody { margin: 0; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; background: #f7fafc; color: #0f172a; }\na { color: inherit; text-decoration: none; }\n',
      language: 'css',
    },
  ];
}

function plannerWorker(): Tier2WorkerOutput {
  return {
    worker: 'planner',
    manifests: [
      manifest(
        'src/lib/route-graph.ts',
        "export const routeGraph = ['/', '/dashboard', '/records'] as const;\nexport type RoutePath = (typeof routeGraph)[number];\n",
        'route-graph',
      ),
    ],
  };
}

function routeWorker(): Tier2WorkerOutput {
  return {
    worker: 'routes',
    manifests: [
      manifest(
        'src/app/page.tsx',
        "import Link from 'next/link';\n\nexport default function HomePage() {\n  return (\n    <main style={{ padding: 24 }}>\n      <h1>Structured App Workspace</h1>\n      <p>Choose a workspace area.</p>\n      <ul>\n        <li><Link href=\"/dashboard\">Dashboard</Link></li>\n        <li><Link href=\"/records\">Records</Link></li>\n      </ul>\n    </main>\n  );\n}\n",
        'root-route',
      ),
      manifest(
        'src/app/dashboard/page.tsx',
        "import { KPIGrid } from '@/components/KPIGrid';\nimport { recentActivity } from '@/lib/mock-data';\n\nexport default function DashboardPage() {\n  return (\n    <main style={{ padding: 24 }}>\n      <h1>Dashboard</h1>\n      <KPIGrid />\n      <h2>Recent activity</h2>\n      <ul>{recentActivity.map((item) => <li key={item.id}>{item.label}</li>)}</ul>\n    </main>\n  );\n}\n",
        'dashboard-route',
      ),
      manifest(
        'src/app/records/page.tsx',
        "import { RecordsTable } from '@/components/RecordsTable';\nimport { RecordForm } from '@/components/RecordForm';\n\nexport default function RecordsPage() {\n  return (\n    <main style={{ padding: 24 }}>\n      <h1>Records</h1>\n      <RecordForm />\n      <RecordsTable />\n    </main>\n  );\n}\n",
        'records-route',
      ),
    ],
  };
}

function componentWorker(): Tier2WorkerOutput {
  return {
    worker: 'components',
    manifests: [
      manifest(
        'src/components/KPIGrid.tsx',
        "import { kpis } from '@/lib/mock-data';\n\nexport function KPIGrid() {\n  return (\n    <section style={{ display: 'grid', gap: 12, gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' }}>\n      {kpis.map((kpi) => (\n        <article key={kpi.id} style={{ padding: 12, border: '1px solid #cbd5e1', borderRadius: 8, background: '#fff' }}>\n          <h3 style={{ marginTop: 0 }}>{kpi.label}</h3>\n          <strong>{kpi.value}</strong>\n        </article>\n      ))}\n    </section>\n  );\n}\n",
        'kpi-component',
      ),
      manifest(
        'src/components/RecordsTable.tsx',
        "import { useMemo, useState } from 'react';\nimport { records } from '@/lib/mock-data';\n\nexport function RecordsTable() {\n  const [query, setQuery] = useState('');\n  const filtered = useMemo(() => records.filter((r) => r.name.toLowerCase().includes(query.toLowerCase())), [query]);\n  return (\n    <section style={{ marginTop: 16 }}>\n      <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder=\"Filter records\" />\n      <table style={{ width: '100%', marginTop: 12, borderCollapse: 'collapse' }}>\n        <thead><tr><th align=\"left\">Name</th><th align=\"left\">Status</th></tr></thead>\n        <tbody>{filtered.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.status}</td></tr>)}</tbody>\n      </table>\n    </section>\n  );\n}\n",
        'table-component',
      ),
      manifest(
        'src/components/RecordForm.tsx',
        "'use client';\n\nimport { useState } from 'react';\n\nexport function RecordForm() {\n  const [name, setName] = useState('');\n  const [status, setStatus] = useState('active');\n  const [saved, setSaved] = useState<string | null>(null);\n\n  return (\n    <form onSubmit={(e) => { e.preventDefault(); setSaved(`${name} (${status})`); }} style={{ display: 'grid', gap: 8, maxWidth: 420 }}>\n      <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>\n      <label>Status<select value={status} onChange={(e) => setStatus(e.target.value)}><option value=\"active\">active</option><option value=\"paused\">paused</option></select></label>\n      <button type=\"submit\">Save</button>\n      {saved ? <p role=\"status\">Saved {saved}</p> : null}\n    </form>\n  );\n}\n",
        'form-component',
      ),
    ],
  };
}

function stateFormWorker(): Tier2WorkerOutput {
  return {
    worker: 'state-form',
    manifests: [
      manifest(
        'src/lib/local-data-store.ts',
        "export interface LocalRecord { id: string; name: string; status: 'active' | 'paused'; }\n\nlet state: LocalRecord[] = [];\n\nexport function listRecords(): LocalRecord[] { return state; }\nexport function addRecord(record: LocalRecord): void { state = [...state, record]; }\n",
        'local-state-store',
      ),
      manifest(
        'src/lib/api-client.ts',
        "import { listRecords, type LocalRecord } from '@/lib/local-data-store';\n\nexport async function fetchRecords(): Promise<LocalRecord[]> {\n  return listRecords();\n}\n",
        'deterministic-api-client',
      ),
    ],
  };
}

function mockDataWorker(): Tier2WorkerOutput {
  return {
    worker: 'mock-data',
    manifests: [
      manifest(
        'src/lib/mock-data.ts',
        "export const kpis = [\n  { id: 'k1', label: 'Open items', value: 18 },\n  { id: 'k2', label: 'In progress', value: 7 },\n  { id: 'k3', label: 'Completed', value: 42 },\n];\n\nexport const recentActivity = [\n  { id: 'a1', label: 'Imported records from CSV' },\n  { id: 'a2', label: 'Updated filter presets' },\n  { id: 'a3', label: 'Saved dashboard layout' },\n];\n\nexport const records = [\n  { id: 'r1', name: 'Acme Corp', status: 'active' },\n  { id: 'r2', name: 'Northwind', status: 'paused' },\n  { id: 'r3', name: 'Globex', status: 'active' },\n] as const;\n",
        'mock-data',
      ),
    ],
  };
}

export async function runTier2StructuredGeneration(opts: RunTier2Options): Promise<Tier2Result> {
  const timer = new PhaseTimer();
  const workerOutputs: Tier2WorkerOutput[] = [];
  const accepted: TierSliceManifest[] = [];
  const validation: Tier2Result['validation'] = [];

  timer.begin('template_ready');
  const files: Tier2File[] = [...foundation(opts.prompt)];
  timer.end('template_ready');

  const run = (phase: PhaseName, fn: () => Tier2WorkerOutput): Tier2WorkerOutput => {
    timer.begin(phase);
    const out = fn();
    timer.end(phase);
    return out;
  };

  for (const out of [
    run('app_planner_generating', plannerWorker),
    run('route_slice_generating', routeWorker),
    run('component_slice_generating', componentWorker),
    run('state_form_slice_generating', stateFormWorker),
    run('mock_data_generating', mockDataWorker),
  ]) {
    workerOutputs.push(out);
    for (const m of out.manifests) {
      timer.begin('slice_validating');
      const issues = validateSliceManifest('TIER_2_STRUCTURED_APP' as PromptTierClassification, m, accepted);
      timer.end('slice_validating');
      if (issues.length > 0) {
        validation.push({ manifest: m, verdict: 'rejected', issues: issues.map((i) => `${i.code}: ${i.message}`) });
        continue;
      }
      accepted.push(m);
      validation.push({ manifest: m, verdict: 'pass', issues: [] });
    }
  }

  timer.begin('assembling');
  for (const slice of accepted) files.push({ path: slice.path, content: slice.content, language: languageFor(slice.path) });

  const fixed = validateAndFixDependencies(files.map((f) => ({ path: f.path, content: f.content })));
  let assembled = fixed.files.map((f) => ({ path: f.path, content: f.content, language: languageFor(f.path) }));

  const contract = enforceDeterministicGenerationContract(assembled);
  assembled = contract.files.map((f) => ({ path: f.path, content: f.content, language: languageFor(f.path) }));
  timer.end('assembling');

  timer.begin('final_build');
  const integrity = runFinalIntegrityGate(assembled);
  timer.end('final_build');

  if (integrity.verdict !== 'pass') {
    throw new Error(`tier2 integrity failed: ${describeIntegrityFailure(integrity)}`);
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
  };
}
