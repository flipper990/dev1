import assert from 'node:assert/strict';
import test from 'node:test';
import { runDeterministicImportRepair } from './import-repair.js';

test('unresolved local component import creates safe stub component', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/app/page.tsx',
      content: [
        "import { HeroBanner } from '@/components/HeroBanner';",
        'export default function Page(){ return <HeroBanner />; }',
        '',
      ].join('\n'),
    },
  ]);

  assert.equal(result.changed, true);
  assert.ok(result.files.some((f) => f.path === 'src/components/HeroBanner.tsx'));
  assert.equal(result.diagnostics.filesCreatedForImports.length, 1);
});

test('unresolved unused import is removed', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/components/Card.tsx',
      content: [
        "import { MissingThing } from './MissingThing';",
        'export default function Card(){ return <div>Card</div>; }',
        '',
      ].join('\n'),
    },
  ]);

  const card = result.files.find((f) => f.path === 'src/components/Card.tsx')?.content ?? '';
  assert.equal(card.includes('MissingThing'), false);
  assert.equal(result.diagnostics.importsRemoved.length, 1);
});

test('root-to-src style mismatch import is rewritten to canonical existing path', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'app/page.tsx',
      content: [
        "import Button from '../components/Button';",
        'export default function Page(){ return <Button />; }',
        '',
      ].join('\n'),
    },
    {
      path: 'src/components/Button.tsx',
      content: 'export default function Button(){ return <button>Go</button>; }\n',
    },
  ]);

  const page = result.files.find((f) => f.path === 'app/page.tsx')?.content ?? '';
  assert.match(page, /\.\.\/components\/Button\.tsx/);
  assert.equal(result.diagnostics.importsRepaired.length, 1);
});

test('unrecoverable unsafe local import still fails with diagnostics', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/app/page.tsx',
      content: [
        "import { SecretThing } from '../server/secret';",
        'export default function Page(){ return <div>{String(SecretThing)}</div>; }',
        '',
      ].join('\n'),
    },
  ]);

  assert.equal(result.changed, false);
  assert.ok(result.diagnostics.unrecoverableImports.some((u) => u.specifier === '../server/secret'));
});

test('repair diagnostics are persisted in result payload', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/app/page.tsx',
      content: [
        "import { A } from './A';",
        "import { B } from './B';",
        'export default function Page(){ return <div>{String(A)}</div>; }',
        '',
      ].join('\n'),
    },
  ]);

  assert.ok(Array.isArray(result.diagnostics.importsRemoved));
  assert.ok(Array.isArray(result.diagnostics.filesCreatedForImports));
  assert.ok(Array.isArray(result.diagnostics.unrecoverableImports));
});

test('unresolved imports inside generated __tests__ files are ignored and classified separately', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
    {
      path: 'src/app/__tests__/page.test.tsx',
      content: "import Missing from '@/components/DoesNotExist';\nexport default Missing;\n",
    },
  ]);

  assert.equal(result.changed, false);
  assert.equal(result.diagnostics.unrecoverableImports.length, 0);
  assert.equal(result.diagnostics.testImportsIgnored.length, 1);
  assert.equal(result.diagnostics.testImportsIgnored[0]?.importer, 'src/app/__tests__/page.test.tsx');
  assert.ok(result.diagnostics.testArtifactPathsMatched.includes('src/app/__tests__/page.test.tsx'));
});

test('unresolved imports inside apps/api/tests/*.test.ts are ignored', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
    {
      path: 'apps/api/tests/metrics-updates.test.ts',
      content: "import Missing from '../src/routes/metrics'; export default Missing;\n",
    },
  ]);

  assert.equal(result.diagnostics.unrecoverableImports.some((u) => u.importer.includes('metrics-updates.test.ts')), false);
  assert.equal(result.diagnostics.testImportsIgnored.some((u) => u.importer === 'apps/api/tests/metrics-updates.test.ts'), true);
  assert.ok(result.diagnostics.testArtifactPathsMatched.includes('apps/api/tests/metrics-updates.test.ts'));
});

test('unresolved imports inside tests/*.test.ts are ignored', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'tests/smoke.behavior.test.ts',
      content: "import Missing from './missing'; export default Missing;\n",
    },
  ]);
  assert.equal(result.diagnostics.unrecoverableImports.length, 0);
  assert.equal(result.diagnostics.testImportsIgnored.some((u) => u.importer === 'tests/smoke.behavior.test.ts'), true);
  assert.ok(result.diagnostics.testArtifactPathsMatched.includes('tests/smoke.behavior.test.ts'));
});

test('unresolved imports inside src/tests/*.test.ts are ignored', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/tests/feature.behavior.test.ts',
      content: "import Missing from '../missing'; export default Missing;\n",
    },
  ]);
  assert.equal(result.diagnostics.unrecoverableImports.length, 0);
  assert.equal(result.diagnostics.testImportsIgnored.some((u) => u.importer === 'src/tests/feature.behavior.test.ts'), true);
  assert.ok(result.diagnostics.testArtifactPathsMatched.includes('src/tests/feature.behavior.test.ts'));
});

test('runtime unresolved imports remain strict and are tracked as runtime violations', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/app/page.tsx',
      content: "import RuntimeMissing from '../server/secret'; export default function Page(){ return <div>{String(RuntimeMissing)}</div>; }\n",
    },
  ]);
  assert.ok(result.diagnostics.unrecoverableImports.some((u) => u.importer === 'src/app/page.tsx'));
  assert.ok(result.diagnostics.runtimeImportViolations.some((v) => v.importer === 'src/app/page.tsx'));
  assert.equal(result.diagnostics.testImportsIgnored.some((v) => v.importer === 'src/app/page.tsx'), false);
});

test('source files under src/tests are treated as test artifacts', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/tests/runtime-helper.ts',
      content: "import Missing from '../missing'; export const value = Missing;\n",
    },
  ]);
  assert.equal(result.diagnostics.unrecoverableImports.some((u) => u.importer === 'src/tests/runtime-helper.ts'), false);
  assert.equal(result.diagnostics.testImportsIgnored.some((u) => u.importer === 'src/tests/runtime-helper.ts'), true);
});

test('import repair never creates apps/api runtime stubs in tier1 mode', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/app/page.tsx',
      content: "import { RuntimeValue } from '@/lib/runtime-value'; export default function Page(){ return <main>{String(RuntimeValue)}</main>; }\n",
    },
  ]);

  assert.equal(result.files.some((f) => f.path.startsWith('apps/api/')), false);
  assert.equal(
    result.files.some((f) => f.path === 'src/lib/runtime-value.ts' || f.path === 'src/lib/runtime-value.tsx'),
    true,
  );
});

test('repairs named-vs-default local import binding mismatch', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'src/components/FeaturesGrid.tsx',
      content: [
        "import { FeatureCard } from '@/components/landing/FeatureCard';",
        'export default function FeaturesGrid(){ return <FeatureCard />; }',
        '',
      ].join('\n'),
    },
    {
      path: 'src/components/landing/FeatureCard.tsx',
      content: 'export default function FeatureCard(){ return <article />; }\n',
    },
  ]);

  const grid = result.files.find((f) => f.path === 'src/components/FeaturesGrid.tsx')?.content ?? '';
  assert.match(grid, /import\s+FeatureCard\s+from\s+['"]@\/components\/landing\/FeatureCard['"]/);
  assert.equal(result.diagnostics.unrecoverableImports.length, 0);
  assert.equal(result.changed, true);
});

test('packages/**/tests source files are treated as test artifacts', () => {
  const result = runDeterministicImportRepair([
    {
      path: 'packages/core/tests/runtime-helper.ts',
      content: "import MissingRuntime from '../missing-runtime'; export const value = MissingRuntime;\n",
    },
    {
      path: 'packages/core/tests/runtime-helper.test.ts',
      content: "import MissingTest from '../missing-test'; export default MissingTest;\n",
    },
  ]);

  assert.equal(result.diagnostics.unrecoverableImports.some((u) => u.importer === 'packages/core/tests/runtime-helper.ts'), false);
  assert.equal(result.diagnostics.testImportsIgnored.some((u) => u.importer === 'packages/core/tests/runtime-helper.ts'), true);
  assert.equal(result.diagnostics.testImportsIgnored.some((u) => u.importer === 'packages/core/tests/runtime-helper.test.ts'), true);
  assert.ok(result.diagnostics.testArtifactPathsMatched.includes('packages/core/tests/runtime-helper.ts'));
  assert.ok(result.diagnostics.testArtifactPathsMatched.includes('packages/core/tests/runtime-helper.test.ts'));
});
