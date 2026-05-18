import assert from 'node:assert/strict';
import test from 'node:test';
import { describeIntegrityFailure, runFinalIntegrityGate } from './final-integrity-gate.js';

test('final integrity gate reports exact missing package names for artifact corruption diagnostics', () => {
  const report = runFinalIntegrityGate([
    {
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-app',
        private: true,
        dependencies: { next: '15.0.4', react: '18.3.1', 'react-dom': '18.3.1' },
      }, null, 2),
    },
    {
      path: 'src/app/api/auth.login/route.ts',
      content: "import bcrypt from 'bcrypt';\nexport async function POST(){ return Response.json({ ok: Boolean(bcrypt) }); }\n",
    },
  ]);

  assert.equal(report.verdict, 'fail');
  assert.ok(report.missingPackages.some((m) => m.name === 'bcrypt'));
  const message = describeIntegrityFailure(report);
  assert.match(message, /bcrypt/);
  assert.match(message, /unresolved package import/);
});
