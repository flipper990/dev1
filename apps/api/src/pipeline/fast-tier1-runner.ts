import { createHash } from 'node:crypto';
import * as ts from 'typescript';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import { validateAndFixDependencies } from '../../../../packages/agent-core/src/dependency-validator.js';
import { validateImportIntegrity } from '../../../../packages/agent-core/src/import-integrity.js';
import { REACT_18_NEXT_15 } from '../../../../packages/agent-core/src/stack-compatibility.js';
import { enforceDeterministicGenerationContract } from './deterministic-generation-contract.js';
import { runFinalIntegrityGate } from './final-integrity-gate.js';
import { runDeterministicImportRepair } from './import-repair.js';
import { classifyTier1RuntimeExclusion, isAllowedTier1RuntimePath } from './test-artifact-policy.js';

export interface FastTier1File {
  path: string;
  content: string;
  language?: string;
}

export interface Tier1SliceManifest {
  path: string;
  content: string;
  imports: string[];
  exports: string[];
  dependencies: string[];
  purpose: string;
}

interface Tier1WorkerOutput {
  worker: 'A' | 'B' | 'C' | 'D';
  manifests: Tier1SliceManifest[];
}

interface Tier1ValidationIssue {
  code:
    | 'forbidden_path'
    | 'disallowed_path'
    | 'empty_content'
    | 'ts_parse'
    | 'jsx_parse'
    | 'css_syntax'
    | 'unresolved_import'
    | 'missing_named_export';
  message: string;
}

interface Tier1ValidatedSlice {
  manifest: Tier1SliceManifest;
  verdict: 'pass' | 'repaired' | 'rejected';
  issues: Tier1ValidationIssue[];
}

export interface FastTier1Result {
  files: FastTier1File[];
  phaseDurations: Record<string, number>;
  workerOutputs: Tier1WorkerOutput[];
  validation: Tier1ValidatedSlice[];
  slicesGenerated: number;
  slicesRepaired: number;
  slicesRejected: number;
  retries: number;
  finalBuildDurationMs: number;
}

export interface FastTier1RunOptions {
  projectId: string;
  prompt: string;
  logger: Logger;
}

const PHASES = [
  'classified',
  'template_ready',
  'page_slice_generating',
  'component_slice_generating',
  'style_slice_generating',
  'mock_data_generating',
  'slice_validating',
  'slice_repairing',
  'assembling',
  'final_build',
] as const;

type PhaseName = (typeof PHASES)[number];

function nowIso(): string {
  return new Date().toISOString();
}

class PhaseTimer {
  private start = new Map<PhaseName, number>();
  private durations: Record<string, number> = {};

  begin(phase: PhaseName): void {
    this.start.set(phase, Date.now());
  }

  end(phase: PhaseName): void {
    const started = this.start.get(phase);
    if (!started) return;
    this.durations[phase] = (this.durations[phase] ?? 0) + (Date.now() - started);
    this.start.delete(phase);
  }

  snapshot(): Record<string, number> {
    return { ...this.durations };
  }
}

function classifyPromptVariant(prompt: string): 'landing' | 'pricing' | 'waitlist' | 'dashboard' | 'generic' {
  const p = prompt.toLowerCase();
  if (p.includes('pricing')) return 'pricing';
  if (p.includes('waitlist')) return 'waitlist';
  if (p.includes('dashboard')) return 'dashboard';
  if (p.includes('landing') || p.includes('marketing') || p.includes('hero')) return 'landing';
  return 'generic';
}

function extractImports(content: string): string[] {
  const out = new Set<string>();
  const re = /from\s+['"]([^'"]+)['"]/g;
  for (const m of content.matchAll(re)) out.add(String(m[1] ?? '').trim());
  return Array.from(out);
}

function extractDependencies(imports: string[]): string[] {
  return imports.filter((s) => !s.startsWith('./') && !s.startsWith('../') && !s.startsWith('@/'));
}

function extractExports(content: string): string[] {
  const out = new Set<string>();
  if (/export\s+default\s+/m.test(content)) out.add('default');
  for (const m of content.matchAll(/export\s+(?:const|function|class|type|interface)\s+([A-Za-z_$][\w$]*)/g)) {
    out.add(String(m[1]));
  }
  for (const m of content.matchAll(/export\s*\{([^}]+)\}/g)) {
    const items = String(m[1]).split(',').map((x) => x.trim()).filter(Boolean);
    for (const item of items) out.add(item.split(/\s+as\s+/i)[0] ?? item);
  }
  return Array.from(out);
}

function manifest(path: string, content: string, purpose: string): Tier1SliceManifest {
  const imports = extractImports(content);
  return {
    path,
    content,
    imports,
    exports: extractExports(content),
    dependencies: extractDependencies(imports),
    purpose,
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

function foundationFiles(prompt: string): FastTier1File[] {
  const deps = REACT_18_NEXT_15.versions;
  const name = `generated-tier1-${createHash('sha1').update(prompt).digest('hex').slice(0, 8)}`;
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
    {
      path: 'next.config.mjs',
      content: [
        '/** @type {import("next").NextConfig} */',
        'const nextConfig = { reactStrictMode: true };',
        'export default nextConfig;',
        '',
      ].join('\n'),
      language: 'javascript',
    },
    {
      path: 'postcss.config.js',
      content: 'module.exports = { plugins: {} };\n',
      language: 'javascript',
    },
    {
      path: 'next-env.d.ts',
      content: '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
      language: 'typescript',
    },
    {
      path: 'src/app/layout.tsx',
      content: [
        "import './globals.css';",
        '',
        'export default function RootLayout({ children }: { children: React.ReactNode }) {',
        '  return (',
        '    <html lang="en">',
        '      <body>{children}</body>',
        '    </html>',
        '  );',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    },
    {
      path: 'src/lib/api-client.ts',
      content: [
        "const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';",
        '',
        'export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {',
        "  const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;",
        '  const res = await fetch(url, init);',
        '  if (!res.ok) throw new Error(`API ${res.status}`);',
        '  return (await res.json()) as T;',
        '}',
        '',
        'export const request = apiFetch;',
        'export const getJson = apiFetch;',
        'export const postJson = apiFetch;',
        'export const fetcher = apiFetch;',
        'export const apiClient = { apiFetch, request, getJson, postJson, fetcher };',
        '',
      ].join('\n'),
      language: 'typescript',
    },
    {
      path: 'src/components/ui/Button.tsx',
      content: [
        "import * as React from 'react';",
        '',
        "export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline';",
        "export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';",
        '',
        'export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {',
        '  variant?: ButtonVariant;',
        '  size?: ButtonSize;',
        '}',
        '',
        'export function Button({ variant = "primary", size = "md", className = "", ...props }: ButtonProps) {',
        '  const cls = `btn btn-${variant} btn-${size} ${className}`.trim();',
        '  return <button className={cls} {...props} />;',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    },
    {
      path: 'src/components/ui/Card.tsx',
      content: [
        "import * as React from 'react';",
        '',
        'export function Card({ className = "", ...props }: React.HTMLAttributes<HTMLDivElement>) {',
        '  return <div className={`card ${className}`.trim()} {...props} />;',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    },
    {
      path: 'src/components/ui/Input.tsx',
      content: [
        "import * as React from 'react';",
        '',
        'export function Input({ className = "", ...props }: React.InputHTMLAttributes<HTMLInputElement>) {',
        '  return <input className={`input ${className}`.trim()} {...props} />;',
        '}',
        '',
      ].join('\n'),
      language: 'typescriptreact',
    },
    {
      path: 'src/components/ui/index.ts',
      content: [
        "export { Button } from './Button';",
        "export { Card } from './Card';",
        "export { Input } from './Input';",
        '',
      ].join('\n'),
      language: 'typescript',
    },
  ];
}

function workerA(prompt: string): Tier1WorkerOutput {
  const variant = classifyPromptVariant(prompt);
  let body = '';
  if (variant === 'dashboard') {
    body = [
      "import { Card, Button } from '@/components/ui';",
      "import { dashboardMetrics } from '@/lib/mock-data';",
      '',
      'export default function Page() {',
      '  return (',
      '    <main className="container">',
      '      <header className="hero">',
      '        <h1>Simple SaaS Dashboard</h1>',
      '        <p>Overview metrics and recent activity with mock data.</p>',
      '        <Button variant="secondary">Create Report</Button>',
      '      </header>',
      '      <section className="grid">',
      '        {dashboardMetrics.map((m) => (',
      '          <Card key={m.label} className="kpi-card">',
      '            <h3>{m.label}</h3>',
      '            <p>{m.value}</p>',
      '          </Card>',
      '        ))}',
      '      </section>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n');
  } else if (variant === 'pricing') {
    body = [
      "import { Card, Button } from '@/components/ui';",
      '',
      'const plans = [',
      "  { name: 'Starter', price: '$9', features: ['1 project', 'Email support'] },",
      "  { name: 'Pro', price: '$29', features: ['Unlimited projects', 'Priority support'] },",
      "  { name: 'Scale', price: '$99', features: ['Team seats', 'SLA'] },",
      '];',
      '',
      'export default function Page() {',
      '  return (',
      '    <main className="container">',
      '      <header className="hero"><h1>Pricing</h1><p>Simple and transparent plans.</p></header>',
      '      <section className="grid">',
      '        {plans.map((plan) => (',
      '          <Card key={plan.name} className="pricing-card">',
      '            <h3>{plan.name}</h3><p className="price">{plan.price}</p>',
      '            <ul>{plan.features.map((f) => <li key={f}>{f}</li>)}</ul>',
      '            <Button>Choose {plan.name}</Button>',
      '          </Card>',
      '        ))}',
      '      </section>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n');
  } else if (variant === 'waitlist') {
    body = [
      "import { Input, Button } from '@/components/ui';",
      '',
      'export default function Page() {',
      '  return (',
      '    <main className="container">',
      '      <section className="hero">',
      '        <h1>Join the Waitlist</h1>',
      '        <p>Be first to know when we launch.</p>',
      '        <form className="waitlist-form">',
      '          <Input type="email" placeholder="you@company.com" aria-label="Email" />',
      '          <Button type="submit">Notify Me</Button>',
      '        </form>',
      '      </section>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n');
  } else {
    body = [
      "import { Button } from '@/components/ui';",
      '',
      'export default function Page() {',
      '  return (',
      '    <main className="container">',
      '      <section className="hero">',
      '        <h1>Build Faster With Confidence</h1>',
      '        <p>A clean landing page generated with deterministic runtime-safe scaffolding.</p>',
      '        <Button>Get Started</Button>',
      '      </section>',
      '      <section className="features">',
      '        <article><h3>Fast</h3><p>Incremental validation during generation.</p></article>',
      '        <article><h3>Safe</h3><p>Deterministic contracts and strict path policy.</p></article>',
      '        <article><h3>Focused</h3><p>Frontend-only artifacts for Tier 1 prompts.</p></article>',
      '      </section>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n');
  }
  return { worker: 'A', manifests: [manifest('src/app/page.tsx', body, 'page-structure')] };
}

function workerB(prompt: string): Tier1WorkerOutput {
  const variant = classifyPromptVariant(prompt);
  const manifests: Tier1SliceManifest[] = [];
  if (variant === 'landing' || variant === 'generic') {
    manifests.push(
      manifest(
        'src/components/HeroSection.tsx',
        [
          "import { Button } from '@/components/ui';",
          '',
          'export function HeroSection() {',
          '  return (',
          '    <section className="hero">',
          '      <h1>Hero Section</h1>',
          '      <p>High-impact headline and concise supporting copy.</p>',
          '      <Button>Primary Action</Button>',
          '    </section>',
          '  );',
          '}',
          '',
        ].join('\n'),
        'component',
      ),
    );
  }
  if (variant === 'dashboard') {
    manifests.push(
      manifest(
        'src/components/DashboardSidebar.tsx',
        [
          'export function DashboardSidebar() {',
          '  return (',
          '    <aside className="sidebar">',
          '      <nav><a href="#">Overview</a><a href="#">Reports</a><a href="#">Billing</a></nav>',
          '    </aside>',
          '  );',
          '}',
          '',
        ].join('\n'),
        'component',
      ),
    );
  }
  return { worker: 'B', manifests };
}

function workerC(): Tier1WorkerOutput {
  return {
    worker: 'C',
    manifests: [
      manifest(
        'src/app/globals.css',
        [
          ':root { color-scheme: light; --bg: #f5f7fb; --card: #ffffff; --text: #101828; --muted: #667085; --primary: #0f62fe; }',
          '* { box-sizing: border-box; }',
          'html, body { margin: 0; padding: 0; font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background: radial-gradient(circle at top, #eaf1ff 0%, var(--bg) 45%); color: var(--text); }',
          '.container { max-width: 1080px; margin: 0 auto; padding: 2rem 1.25rem; }',
          '.hero { padding: 3rem 0 1rem; }',
          '.hero h1 { margin: 0 0 0.75rem; font-size: clamp(2rem, 6vw, 3.25rem); line-height: 1.1; }',
          '.hero p { margin: 0 0 1rem; color: var(--muted); max-width: 70ch; }',
          '.features, .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-top: 1.25rem; }',
          '.card, .pricing-card, .kpi-card { background: var(--card); border: 1px solid #d0d5dd; border-radius: 14px; padding: 1rem; }',
          '.btn { border: 1px solid transparent; border-radius: 10px; padding: 0.6rem 0.9rem; font-weight: 600; cursor: pointer; }',
          '.btn-primary { background: var(--primary); color: #fff; }',
          '.btn-secondary { background: #e4e7ec; color: #1d2939; }',
          '.btn-ghost { background: transparent; color: #344054; border-color: #d0d5dd; }',
          '.btn-outline { background: #fff; color: #101828; border-color: #98a2b3; }',
          '.btn-sm { font-size: 0.8rem; }',
          '.btn-md { font-size: 0.92rem; }',
          '.btn-lg { font-size: 1rem; padding: 0.7rem 1.1rem; }',
          '.btn-icon { width: 2.25rem; height: 2.25rem; padding: 0; }',
          '.input { width: 100%; border: 1px solid #d0d5dd; border-radius: 10px; padding: 0.65rem 0.75rem; }',
          '.waitlist-form { display: grid; gap: 0.75rem; max-width: 420px; }',
          '.sidebar { border: 1px solid #d0d5dd; border-radius: 12px; padding: 0.75rem; background: #fff; }',
          '.sidebar nav { display: grid; gap: 0.4rem; }',
          '.price { font-size: 1.8rem; margin: 0.5rem 0; }',
          '',
        ].join('\n'),
        'style-theme',
      ),
    ],
  };
}

function workerD(prompt: string): Tier1WorkerOutput {
  const variant = classifyPromptVariant(prompt);
  if (variant === 'dashboard') {
    return {
      worker: 'D',
      manifests: [
        manifest(
          'src/lib/mock-data.ts',
          [
            'export const dashboardMetrics = [',
            "  { label: 'Revenue', value: '$42,300' },",
            "  { label: 'Conversion', value: '5.4%' },",
            "  { label: 'Active Users', value: '1,283' },",
            "  { label: 'Tickets', value: '14 open' },",
            '];',
            '',
          ].join('\n'),
          'mock-data',
        ),
      ],
    };
  }
  return {
    worker: 'D',
    manifests: [
      manifest(
        'src/lib/mock-data.ts',
        ['export const mockItems = [];', ''].join('\n'),
        'mock-data',
      ),
    ],
  };
}

function parseDiagnostics(path: string, content: string): ts.DiagnosticWithLocation[] {
  const kind =
    path.endsWith('.tsx') ? ts.ScriptKind.TSX
      : path.endsWith('.jsx') ? ts.ScriptKind.JSX
        : path.endsWith('.ts') ? ts.ScriptKind.TS
          : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(path, content, ts.ScriptTarget.Latest, false, kind);
  return (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
}

function hasBalancedBraces(input: string): boolean {
  let balance = 0;
  for (const ch of input) {
    if (ch === '{') balance++;
    if (ch === '}') balance--;
    if (balance < 0) return false;
  }
  return balance === 0;
}

function resolveInternalSpecifier(fromPath: string, specifier: string): string | null {
  if (specifier.startsWith('@/')) return `src/${specifier.slice(2)}`;
  if (specifier.startsWith('./') || specifier.startsWith('../')) {
    const fromDir = fromPath.replace(/\\/g, '/').split('/').slice(0, -1).join('/');
    const full = `${fromDir}/${specifier}`.replace(/\/+/g, '/');
    const norm = full.split('/').reduce<string[]>((acc, seg) => {
      if (!seg || seg === '.') return acc;
      if (seg === '..') {
        acc.pop();
      } else {
        acc.push(seg);
      }
      return acc;
    }, []).join('/');
    return norm;
  }
  return null;
}

function exportNamesFor(content: string): Set<string> {
  return new Set(extractExports(content));
}

function fallbackContent(path: string): string {
  if (path.endsWith('page.tsx')) {
    return [
      'export default function Page() {',
      '  return (',
      '    <main className="container">',
      '      <h1>Generated Tier 1 Page</h1>',
      '      <p>Recovered from slice validation failure.</p>',
      '    </main>',
      '  );',
      '}',
      '',
    ].join('\n');
  }
  if (path.endsWith('.tsx')) {
    return [
      'export function RecoveredComponent() {',
      '  return <div />;',
      '}',
      '',
    ].join('\n');
  }
  if (path.endsWith('.css')) return '/* recovered css */\n';
  if (path.endsWith('.ts')) return 'export {};\n';
  return '';
}

function validateSliceManifest(
  item: Tier1SliceManifest,
  assembled: Map<string, FastTier1File>,
): Tier1ValidationIssue[] {
  const issues: Tier1ValidationIssue[] = [];
  const normalizedPath = item.path.replace(/\\/g, '/');

  const exclusion = classifyTier1RuntimeExclusion(normalizedPath);
  if (exclusion) {
    issues.push({ code: 'forbidden_path', message: `${normalizedPath}: ${exclusion}` });
    return issues;
  }
  if (!isAllowedTier1RuntimePath(normalizedPath)) {
    issues.push({ code: 'disallowed_path', message: normalizedPath });
  }
  if (!item.content || item.content.trim().length === 0) {
    issues.push({ code: 'empty_content', message: normalizedPath });
    return issues;
  }

  if (/\.(tsx?|jsx?)$/.test(normalizedPath)) {
    const diags = parseDiagnostics(normalizedPath, item.content);
    for (const d of diags) {
      const msg = typeof d.messageText === 'string' ? d.messageText : String(d.messageText.messageText ?? '');
      issues.push({ code: normalizedPath.endsWith('x') ? 'jsx_parse' : 'ts_parse', message: msg });
    }
  }
  if (normalizedPath.endsWith('.css') && !hasBalancedBraces(item.content)) {
    issues.push({ code: 'css_syntax', message: 'unbalanced braces' });
  }

  const importIssues = validateImportIntegrity(
    [...assembled.values(), { path: normalizedPath, content: item.content, language: languageFor(normalizedPath) }]
      .map((f) => ({ path: f.path, content: f.content, language: f.language })),
  ).filter((m) => m.importer === normalizedPath);
  for (const miss of importIssues) {
    issues.push({ code: 'unresolved_import', message: `${miss.specifier}` });
  }

  // Named export checks for local internal imports.
  for (const specifier of item.imports) {
    const targetBase = resolveInternalSpecifier(normalizedPath, specifier);
    if (!targetBase) continue;
    const candidates = [
      targetBase,
      `${targetBase}.ts`,
      `${targetBase}.tsx`,
      `${targetBase}.js`,
      `${targetBase}.jsx`,
      `${targetBase}/index.ts`,
      `${targetBase}/index.tsx`,
    ];
    const target = candidates.find((c) => assembled.has(c));
    if (!target) continue;
    const targetContent = assembled.get(target)?.content ?? '';
    const available = exportNamesFor(targetContent);
    const namedImportMatch = new RegExp(`import\\s+\\{([^}]+)\\}\\s+from\\s+['"]${specifier.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}['"]`, 'g');
    for (const m of item.content.matchAll(namedImportMatch)) {
      const names = String(m[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => (x.split(/\s+as\s+/i)[0] ?? x));
      for (const name of names) {
        if (!available.has(name)) {
          issues.push({ code: 'missing_named_export', message: `${name} not exported by ${target}` });
        }
      }
    }
  }

  return issues;
}

export function validateTier1SliceForTest(
  item: Tier1SliceManifest,
  assembled: Array<FastTier1File>,
): Tier1ValidationIssue[] {
  return validateSliceManifest(item, new Map(assembled.map((f) => [f.path, f])));
}

function repairSlice(
  item: Tier1SliceManifest,
  issues: Tier1ValidationIssue[],
): Tier1SliceManifest | null {
  if (issues.some((i) => i.code === 'forbidden_path' || i.code === 'disallowed_path')) return null;
  const repaired = { ...item };
  if (issues.some((i) => i.code === 'ts_parse' || i.code === 'jsx_parse' || i.code === 'css_syntax' || i.code === 'unresolved_import' || i.code === 'missing_named_export')) {
    repaired.content = fallbackContent(item.path);
    repaired.imports = extractImports(repaired.content);
    repaired.exports = extractExports(repaired.content);
    repaired.dependencies = extractDependencies(repaired.imports);
  }
  return repaired;
}

export async function runFastTier1Generation(opts: FastTier1RunOptions): Promise<FastTier1Result> {
  const timer = new PhaseTimer();
  const assembled = new Map<string, FastTier1File>();
  const validation: Tier1ValidatedSlice[] = [];
  const workerOutputs: Tier1WorkerOutput[] = [];
  let retries = 0;

  timer.begin('template_ready');
  for (const f of foundationFiles(opts.prompt)) assembled.set(f.path, f);
  timer.end('template_ready');

  const runWorker = async (phase: PhaseName, fn: () => Tier1WorkerOutput): Promise<Tier1WorkerOutput> => {
    timer.begin(phase);
    const output = fn();
    timer.end(phase);
    return output;
  };

  const outputs = await Promise.all([
    runWorker('page_slice_generating', () => workerA(opts.prompt)),
    runWorker('component_slice_generating', () => workerB(opts.prompt)),
    runWorker('style_slice_generating', () => workerC()),
    runWorker('mock_data_generating', () => workerD(opts.prompt)),
  ]);

  for (const output of outputs) {
    workerOutputs.push(output);
    for (const m of output.manifests) {
      timer.begin('slice_validating');
      const issues = validateSliceManifest(m, assembled);
      timer.end('slice_validating');
      if (issues.length === 0) {
        assembled.set(m.path, { path: m.path, content: m.content, language: languageFor(m.path) });
        validation.push({ manifest: m, verdict: 'pass', issues: [] });
        continue;
      }
      timer.begin('slice_repairing');
      const repaired = repairSlice(m, issues);
      timer.end('slice_repairing');
      if (!repaired) {
        validation.push({ manifest: m, verdict: 'rejected', issues });
        continue;
      }
      retries++;
      timer.begin('slice_validating');
      const repairedIssues = validateSliceManifest(repaired, assembled);
      timer.end('slice_validating');
      if (repairedIssues.length > 0) {
        validation.push({ manifest: repaired, verdict: 'rejected', issues: repairedIssues });
        continue;
      }
      assembled.set(repaired.path, { path: repaired.path, content: repaired.content, language: languageFor(repaired.path) });
      validation.push({ manifest: repaired, verdict: 'repaired', issues });
    }
  }

  timer.begin('assembling');
  let files = Array.from(assembled.values());
  let contract = enforceDeterministicGenerationContract(files, { allowBackendRuntimeArtifacts: false });
  if (contract.blockingViolations.length > 0 && contract.blockingViolations.every((v) => v.startsWith('dangling internal import:'))) {
    const repaired = runDeterministicImportRepair(contract.files);
    retries++;
    contract = enforceDeterministicGenerationContract(repaired.files, { allowBackendRuntimeArtifacts: false });
  }
  if (contract.blockingViolations.length > 0) {
    throw new Error(`fast-tier1 contract failed: ${contract.blockingViolations.slice(0, 3).join(' | ')}`);
  }
  const depFix = validateAndFixDependencies(contract.files);
  files = depFix.files.map((f) => ({ path: f.path, content: f.content, language: languageFor(f.path) }));
  timer.end('assembling');

  timer.begin('final_build');
  const integrity = runFinalIntegrityGate(files);
  if (integrity.verdict !== 'pass') {
    retries++;
    const repaired = runDeterministicImportRepair(files);
    const secondIntegrity = runFinalIntegrityGate(repaired.files);
    if (secondIntegrity.verdict !== 'pass') {
      throw new Error(`fast-tier1 final build failed: ${secondIntegrity.danglingInternalImports[0]?.specifier ?? 'integrity-failed'}`);
    }
    files = repaired.files.map((f) => ({ path: f.path, content: f.content, language: languageFor(f.path) }));
  }
  timer.end('final_build');

  const slicesGenerated = workerOutputs.reduce((n, w) => n + w.manifests.length, 0);
  const slicesRepaired = validation.filter((v) => v.verdict === 'repaired').length;
  const slicesRejected = validation.filter((v) => v.verdict === 'rejected').length;
  const phaseDurations = timer.snapshot();

  opts.logger.info('[fast-tier1] generation completed', {
    event: 'fast-tier1:completed',
    projectId: opts.projectId,
    at: nowIso(),
    slicesGenerated,
    slicesRepaired,
    slicesRejected,
    retries,
    phaseDurations,
  });

  return {
    files,
    phaseDurations,
    workerOutputs,
    validation,
    slicesGenerated,
    slicesRepaired,
    slicesRejected,
    retries,
    finalBuildDurationMs: phaseDurations.final_build ?? 0,
  };
}
