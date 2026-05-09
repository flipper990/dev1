#!/usr/bin/env node

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

const ROLLBACK_CASES = [
  {
    name: 'legacy-shell',
    query: '?ui_redesign_shell=0&ui_redesign_workspace=0&ui_redesign_status_system=0&ui_redesign_dark_mode=0',
    route: '/workspace',
    mustContain: ['Project workspace', 'Prompt composer'],
  },
  {
    name: 'new-shell',
    query: '?ui_redesign_shell=1&ui_redesign_workspace=1&ui_redesign_status_system=1&ui_redesign_dark_mode=1',
    route: '/workspace',
    mustContain: ['Project workspace', 'Workspace sections'],
  },
];

async function runCase(testCase) {
  const url = `${BASE_URL}${testCase.route}${testCase.query}`;
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`${testCase.name}: ${res.status}`);
  }
  const html = await res.text();
  for (const marker of testCase.mustContain) {
    if (!html.includes(marker)) {
      throw new Error(`${testCase.name}: missing marker '${marker}'`);
    }
  }
  console.log(`ok ${testCase.name}`);
}

(async () => {
  for (const testCase of ROLLBACK_CASES) {
    await runCase(testCase);
  }
})();
