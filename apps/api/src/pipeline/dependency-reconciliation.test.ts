import assert from 'node:assert/strict';
import test from 'node:test';
import { validateAndFixDependencies } from '../../../../packages/agent-core/src/dependency-validator.js';

test('dependency validator reconciles bcrypt when imported by runtime source files', () => {
  const input = [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-app',
        private: true,
        scripts: { dev: 'next dev', build: 'next build' },
        dependencies: { next: '15.0.4', react: '18.3.1', 'react-dom': '18.3.1' },
      }, null, 2),
    },
    {
      path: 'src/app/api/auth.login/route.ts',
      content: "import bcrypt from 'bcrypt';\nexport async function POST(){ return Response.json({ ok: Boolean(bcrypt) }); }\n",
    },
  ];

  const out = validateAndFixDependencies(input);
  const pkg = out.files.find((f) => f.path === 'package.json');
  assert.ok(pkg);
  const parsed = JSON.parse(pkg.content) as { dependencies?: Record<string, string> };
  assert.equal(typeof parsed.dependencies?.bcrypt, 'string');
});

test('dependency validator reconciles imports introduced after an initial pass', () => {
  const initial = [
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-app',
        private: true,
        scripts: { dev: 'next dev', build: 'next build' },
        dependencies: { next: '15.0.4', react: '18.3.1', 'react-dom': '18.3.1' },
      }, null, 2),
    },
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
  ];

  const firstPass = validateAndFixDependencies(initial);
  const withPostQaImport = firstPass.files.map((f) => ({ ...f }));
  withPostQaImport.push({
    path: 'src/app/api/auth.login/route.ts',
    content: "import bcrypt from 'bcrypt';\nexport async function POST(){ return Response.json({ ok: Boolean(bcrypt) }); }\n",
  });

  const secondPass = validateAndFixDependencies(withPostQaImport);
  const pkg = secondPass.files.find((f) => f.path === 'package.json');
  assert.ok(pkg);
  const parsed = JSON.parse(pkg.content) as { dependencies?: Record<string, string> };
  assert.equal(typeof parsed.dependencies?.bcrypt, 'string');
});
