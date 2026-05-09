#!/usr/bin/env node

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';

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

async function check(url) {
  const res = await fetch(url, { redirect: 'manual' });
  if (!res.ok) {
    throw new Error(`${url} -> ${res.status}`);
  }
  const html = await res.text();
  if (!html.includes('<main') && !html.includes('Project workspace')) {
    throw new Error(`${url} -> missing expected page markers`);
  }
}

(async () => {
  for (const route of ROUTES) {
    for (const variant of FLAG_VARIANTS) {
      const url = `${BASE_URL}${route}${variant}`;
      await check(url);
      console.log(`ok ${url}`);
    }
  }
})();
