import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePackageJsonString } from '../../../../packages/agent-core/src/package-json-validator.js';
import { REACT_18_NEXT_15 } from '../../../../packages/agent-core/src/stack-compatibility.js';
import { buildCanonicalPackageManifest } from './canonical-package-manifest.js';

test('canonical manifest emits deterministic Next/React baseline', () => {
  const built = buildCanonicalPackageManifest(null, [
    { path: 'src/app/page.tsx', content: 'export default function Page(){return <div/>}\n' },
  ]);
  const parsed = JSON.parse(built.packageJson) as Record<string, unknown>;
  const deps = parsed.dependencies as Record<string, string>;
  const devDeps = parsed.devDependencies as Record<string, string>;
  const scripts = parsed.scripts as Record<string, string>;

  assert.equal(parsed.private, true);
  assert.equal(parsed.type, 'module');
  assert.equal(deps.next, REACT_18_NEXT_15.versions.next);
  assert.equal(deps.react, REACT_18_NEXT_15.versions.react);
  assert.equal(deps['react-dom'], REACT_18_NEXT_15.versions['react-dom']);
  assert.equal(devDeps.typescript, REACT_18_NEXT_15.versions.typescript);
  assert.equal(devDeps['@types/react'], REACT_18_NEXT_15.versions['@types/react']);
  assert.equal(devDeps['@types/react-dom'], REACT_18_NEXT_15.versions['@types/react-dom']);
  assert.equal(scripts.dev, 'next dev');
  assert.equal(scripts.build, 'next build');
  assert.equal(scripts.start, 'next start');
});

test('strict-react-next-bundle-pins passes for canonical manifest', () => {
  const built = buildCanonicalPackageManifest(null, [
    { path: 'src/app/page.tsx', content: 'export default function Page(){return <div/>}\n' },
  ]);
  const validation = validatePackageJsonString(built.packageJson);
  assert.equal(validation.hasBlockingError, false);
  assert.equal(validation.violations.filter((v) => v.ruleId === 'strict-react-next-bundle-pins').length, 0);
});

test('malformed package json fails validation', () => {
  const validation = validatePackageJsonString('{');
  assert.equal(validation.hasBlockingError, true);
  assert.match(validation.headline ?? '', /parse failed/i);
});

test('missing react-dom fails validation when next is present', () => {
  const bad = JSON.stringify({
    name: 'x',
    private: true,
    dependencies: { next: REACT_18_NEXT_15.versions.next, react: REACT_18_NEXT_15.versions.react },
  });
  const validation = validatePackageJsonString(bad);
  assert.equal(validation.hasBlockingError, true);
  assert.ok(validation.violations.some((v) => v.ruleId === 'next-requires-react-dom'));
});

test('mismatched bundled versions fail strict bundle pin validation', () => {
  const bad = JSON.stringify({
    name: 'x',
    private: true,
    dependencies: {
      next: REACT_18_NEXT_15.versions.next,
      react: REACT_18_NEXT_15.versions.react,
      'react-dom': REACT_18_NEXT_15.versions['react-dom'],
    },
    devDependencies: {
      typescript: '5.7.0',
      '@types/react': REACT_18_NEXT_15.versions['@types/react'],
      '@types/react-dom': REACT_18_NEXT_15.versions['@types/react-dom'],
    },
  });
  const validation = validatePackageJsonString(bad);
  assert.equal(validation.hasBlockingError, true);
  assert.ok(validation.violations.some((v) => v.ruleId === 'strict-react-next-bundle-pins'));
});

test('ai package json is sanitized and merged with deterministic baseline', () => {
  const built = buildCanonicalPackageManifest(JSON.stringify({
    name: 'My Cool App',
    version: '9.9.9',
    dependencies: {
      react: '19.0.0',
      zod: '^3.0.0',
      'made-up-lib': '1.2.3',
    },
    devDependencies: {
      typescript: '5.7.0',
    },
  }), [
    {
      path: 'src/app/page.tsx',
      content: [
        "import { z } from 'zod';",
        'export default function Page(){ return <pre>{z.string().parse("ok")}</pre> }',
        '',
      ].join('\n'),
    },
  ]);
  const parsed = JSON.parse(built.packageJson) as Record<string, unknown>;
  const deps = parsed.dependencies as Record<string, string>;
  const devDeps = parsed.devDependencies as Record<string, string>;

  assert.equal(parsed.name, 'my-cool-app');
  assert.equal(parsed.version, '9.9.9');
  assert.equal(deps.react, REACT_18_NEXT_15.versions.react);
  assert.equal(deps['react-dom'], REACT_18_NEXT_15.versions['react-dom']);
  assert.equal(devDeps.typescript, REACT_18_NEXT_15.versions.typescript);
  assert.equal(deps.zod, '^3.23.0');
  assert.equal('made-up-lib' in deps, false);
  assert.ok(built.droppedDependencies.includes('made-up-lib'));
});
