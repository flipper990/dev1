import assert from 'node:assert/strict';
import test from 'node:test';
import { validatePackageJsonString } from '../../../../packages/agent-core/src/package-json-validator.js';
import { REACT_18_NEXT_15 } from '../../../../packages/agent-core/src/stack-compatibility.js';
import { enforceCanonicalPackageManifest } from './package-manifest-guard.js';

test('enforceCanonicalPackageManifest repairs AI-generated invalid package.json drift', () => {
  const input = [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'AI APP',
        private: true,
        scripts: { dev: 'next dev' },
        dependencies: {
          next: '15.3.0',
          react: '19.0.0',
          'react-dom': '19.0.0',
        },
      }, null, 2),
      language: 'json',
    },
    { path: 'src/app/page.tsx', content: 'export default function Page(){ return <main />; }\n', language: 'typescriptreact' },
  ];

  const out = enforceCanonicalPackageManifest(input);
  const pkg = out.files.find((f) => f.path === 'package.json');
  assert.ok(pkg);
  const validation = validatePackageJsonString(pkg!.content);
  assert.equal(validation.hasBlockingError, false);
  assert.equal(validation.violations.some((v) => v.ruleId === 'strict-react-next-bundle-pins'), false);
  assert.equal(out.diagnostics.packageManifestRepaired, true);
  assert.equal(out.diagnostics.packageManifestRejected, false);
  assert.equal(out.diagnostics.actualPins.next, REACT_18_NEXT_15.versions.next);
  assert.equal(out.diagnostics.actualPins.react, REACT_18_NEXT_15.versions.react);
  assert.equal(out.diagnostics.actualPins['react-dom'], REACT_18_NEXT_15.versions['react-dom']);
});

test('enforceCanonicalPackageManifest synthesizes package.json when missing', () => {
  const out = enforceCanonicalPackageManifest([
    { path: 'src/app/page.tsx', content: 'export default function Page(){ return <main />; }\n', language: 'typescriptreact' },
  ]);
  const pkg = out.files.find((f) => f.path === 'package.json');
  assert.ok(pkg);
  const validation = validatePackageJsonString(pkg!.content);
  assert.equal(validation.hasBlockingError, false);
  assert.equal(out.diagnostics.packageManifestRepaired, true);
});

