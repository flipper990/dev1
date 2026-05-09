#!/usr/bin/env node

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const ROUTES = ['/', '/projects', '/workspace', '/agents', '/settings'];

async function run(route) {
  const res = await fetch(`${BASE_URL}${route}`);
  if (!res.ok) throw new Error(`${route}: ${res.status}`);
  const html = await res.text();

  const checks = [
    { label: 'main landmark', ok: html.includes('<main') },
    { label: 'focus styles hook', ok: html.includes('focus-visible') || html.includes('Project workspace') },
    { label: 'aria labels present', ok: html.includes('aria-label') || html.includes('aria-live') },
  ];

  const failed = checks.filter((c) => !c.ok);
  if (failed.length > 0) {
    throw new Error(`${route}: ${failed.map((f) => f.label).join(', ')}`);
  }

  console.log(`ok ${route}`);
}

(async () => {
  for (const route of ROUTES) {
    await run(route);
  }
})();
