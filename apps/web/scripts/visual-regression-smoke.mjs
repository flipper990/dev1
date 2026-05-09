#!/usr/bin/env node

const crypto = require('crypto');

const BASE_URL = process.env.SMOKE_BASE_URL || 'http://localhost:3000';
const ROUTES = ['/', '/workspace', '/projects', '/agents'];
const VARIANTS = [
  '?ui_redesign_shell=1&ui_redesign_workspace=1&ui_redesign_status_system=1',
  '?ui_redesign_shell=0&ui_redesign_workspace=0&ui_redesign_status_system=0',
];

function stableHash(input) {
  return crypto.createHash('sha256').update(input).digest('hex').slice(0, 16);
}

async function run(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} -> ${res.status}`);
  const html = await res.text();

  const reduced = html
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, '')
    .replace(/nonce="[^"]+"/g, 'nonce=""')
    .replace(/\s+/g, ' ')
    .trim();

  return stableHash(reduced);
}

(async () => {
  for (const route of ROUTES) {
    for (const variant of VARIANTS) {
      const url = `${BASE_URL}${route}${variant}`;
      const hash = await run(url);
      console.log(`${route}${variant} => ${hash}`);
    }
  }
})();
