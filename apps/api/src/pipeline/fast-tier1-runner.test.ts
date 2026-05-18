import test from 'node:test';
import assert from 'node:assert/strict';
import { runFastTier1Generation, validateTier1SliceForTest, type FastTier1File, type Tier1SliceManifest } from './fast-tier1-runner.js';
import { runFinalIntegrityGate } from './final-integrity-gate.js';

const logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
} as const;

function mkManifest(path: string, content: string): Tier1SliceManifest {
  const imports = Array.from(content.matchAll(/from\s+['"]([^'"]+)['"]/g)).map((m) => String(m[1] ?? ''));
  return {
    path,
    content,
    imports,
    exports: [],
    dependencies: imports.filter((i) => !i.startsWith('./') && !i.startsWith('../') && !i.startsWith('@/')),
    purpose: 'test',
  };
}

test('deterministic fast tier1 template produces integrity-safe project', async () => {
  const result = await runFastTier1Generation({
    projectId: 'p1',
    prompt: 'Build a simple landing page with hero section, features, and CTA.',
    logger: logger as any,
  });
  const gate = runFinalIntegrityGate(result.files);
  assert.equal(gate.verdict, 'pass');
});

test('landing fast path emits preview-safe frontend files', async () => {
  const result = await runFastTier1Generation({
    projectId: 'p2',
    prompt: 'Build a simple landing page with hero section, features, and CTA.',
    logger: logger as any,
  });
  const paths = new Set(result.files.map((f) => f.path));
  assert.equal(paths.has('src/app/page.tsx'), true);
  assert.equal(paths.has('src/app/layout.tsx'), true);
  assert.equal(paths.has('src/app/globals.css'), true);
  assert.equal(Array.from(paths).some((p) => p.startsWith('server/')), false);
  assert.equal(Array.from(paths).some((p) => /\.test\./i.test(p)), false);
});

test('dashboard fast path does not emit backend files', async () => {
  const result = await runFastTier1Generation({
    projectId: 'p3',
    prompt: 'Build a simple SaaS dashboard with sidebar, KPI cards, and recent activity.',
    logger: logger as any,
  });
  const paths = result.files.map((f) => f.path);
  assert.equal(paths.some((p) => p.startsWith('apps/api/')), false);
  assert.equal(paths.some((p) => p.startsWith('src/app/api/')), false);
  assert.equal(paths.some((p) => p.startsWith('db/')), false);
});

test('incremental validation catches missing named export before final build', () => {
  const assembled: FastTier1File[] = [
    { path: 'src/components/ui/index.ts', content: "export { Button } from './Button';\n", language: 'typescript' },
  ];
  const issues = validateTier1SliceForTest(
    mkManifest('src/app/page.tsx', "import { Card } from '@/components/ui';\nexport default function Page(){ return <div/>; }\n"),
    assembled,
  );
  assert.equal(issues.some((i) => i.code === 'missing_named_export'), true);
});

test('incremental validation catches unresolved import immediately', () => {
  const issues = validateTier1SliceForTest(
    mkManifest('src/app/page.tsx', "import { Missing } from '@/components/Missing';\nexport default function Page(){ return <div/>; }\n"),
    [],
  );
  assert.equal(issues.some((i) => i.code === 'unresolved_import'), true);
});

test('incremental validation catches invalid TSX before final build', () => {
  const issues = validateTier1SliceForTest(
    mkManifest('src/components/Broken.tsx', 'export function Broken(){ return <div>; }\n'),
    [],
  );
  assert.equal(issues.some((i) => i.code === 'jsx_parse' || i.code === 'ts_parse'), true);
});

test('incremental validation catches invalid CSS before preview', () => {
  const issues = validateTier1SliceForTest(
    mkManifest('src/app/globals.css', '.a { color: red;\n'),
    [],
  );
  assert.equal(issues.some((i) => i.code === 'css_syntax'), true);
});

test('incremental validation drops forbidden paths with diagnostics', () => {
  const issues = validateTier1SliceForTest(
    mkManifest('server/index.ts', 'export const x = 1;\n'),
    [],
  );
  assert.equal(issues.some((i) => i.code === 'forbidden_path'), true);
});

