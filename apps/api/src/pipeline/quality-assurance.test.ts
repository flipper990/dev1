import assert from 'node:assert/strict';
import test from 'node:test';
import { runQualityAssurance } from './quality-assurance.js';

test('functional e2e recognizes Next app route handlers as backend routes', () => {
  const qa = runQualityAssurance([
    {
      path: 'src/app/api/users/route.ts',
      content: [
        'export async function GET(){',
        '  return Response.json([{ id: 1 }]);',
        '}',
        '',
      ].join('\n'),
    },
    {
      path: 'src/app/page.tsx',
      content: [
        'export default async function Page(){',
        "  const r = await fetch('/api/users');",
        '  const data = await r.json();',
        '  return <main>{data.length}</main>;',
        '}',
        '',
      ].join('\n'),
    },
  ]);

  const noRoutes = qa.report.findings.find((f) => f.id === 'e2e.no-backend-routes');
  assert.equal(noRoutes, undefined);
});

test('functional e2e still fails when backend exists with no routes', () => {
  const qa = runQualityAssurance([
    {
      path: 'src/server/index.ts',
      content: [
        "import express from 'express';",
        'const app = express();',
        'export default app;',
        '',
      ].join('\n'),
    },
    {
      path: 'src/app/page.tsx',
      content: 'export default function Page(){ return <main>ok</main>; }\n',
    },
  ]);

  assert.ok(qa.report.findings.some((f) => f.id === 'e2e.no-backend-routes'));
});

