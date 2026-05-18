#!/usr/bin/env node

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const API_BASE_URL = process.env.SMOKE_API_BASE_URL || 'http://localhost:3003';

const ROUTES = [
  '/',
  '/projects',
  '/workspace',
  '/agents',
];

const FLAG_VARIANTS = [
  '?ui_redesign_shell=1&ui_redesign_workspace=1&ui_redesign_status_system=1',
  '?ui_redesign_shell=0&ui_redesign_workspace=0&ui_redesign_status_system=0',
];

async function signInForSmoke() {
  const email = `smoke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}@example.com`;
  const res = await fetch(`${API_BASE_URL}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      fullName: 'Smoke Route User',
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

async function check(url, cookieHeader) {
  const res = await fetch(url, {
    redirect: 'manual',
    headers: cookieHeader ? { cookie: cookieHeader } : undefined,
  });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}`);
  }
  const html = await res.text();
  if (!html.includes('<main') && !html.includes('AI Engineering Runtime')) {
    throw new Error(`${url} -> missing expected page markers`);
  }
}

(async () => {
  const cookieHeader = await signInForSmoke();
  for (const route of ROUTES) {
    for (const variant of FLAG_VARIANTS) {
      const url = `${BASE_URL}${route}${variant}`;
      await check(url, cookieHeader);
      console.log(`ok ${url}`);
    }
  }
})();
