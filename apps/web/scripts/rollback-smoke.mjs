#!/usr/bin/env node

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const API_BASE_URL = process.env.SMOKE_API_BASE_URL || 'http://localhost:3003';

const ROLLBACK_CASES = [
  {
    name: 'legacy-shell',
    query: '?ui_redesign_shell=0&ui_redesign_workspace=0&ui_redesign_status_system=0&ui_redesign_dark_mode=0',
    route: '/workspace',
    mustContain: ['AI Engineering Runtime', 'Orchestration console'],
  },
  {
    name: 'new-shell',
    query: '?ui_redesign_shell=1&ui_redesign_workspace=1&ui_redesign_status_system=1&ui_redesign_dark_mode=1',
    route: '/workspace',
    mustContain: ['AI Engineering Runtime', 'Orchestration console'],
  },
];

async function signInForSmoke() {
  const email = `rollback-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;
  const res = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Rollback Smoke User',
      email,
      password: 'Str0ng!Passw0rd#',
    }),
  });
  if (!res.ok) {
    throw new Error(`auth bootstrap failed -> ${res.status}`);
  }
  const setCookie = res.headers.getSetCookie?.() ?? [];
  const cookiePairs = setCookie.map((value) => value.split(';')[0]).filter(Boolean);
  if (cookiePairs.length === 0) {
    throw new Error('auth bootstrap returned no cookies');
  }
  return cookiePairs.join('; ');
}

async function runCase(testCase, cookieHeader) {
  const url = `${BASE_URL}${testCase.route}${testCase.query}`;
  const res = await fetch(url, {
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
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
  const cookieHeader = await signInForSmoke();
  for (const testCase of ROLLBACK_CASES) {
    await runCase(testCase, cookieHeader);
  }
})();
