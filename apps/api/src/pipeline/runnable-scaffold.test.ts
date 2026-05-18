import assert from 'node:assert/strict';
import test from 'node:test';
import { ensureRunnableScaffold } from './runnable-scaffold.js';
import type { ProjectFile } from './generator-types.js';

function file(path: string, content: string): ProjectFile {
  return { path, content, language: 'typescriptreact' };
}

test('ensureRunnableScaffold injects standalone src/lib/api-client with compatibility exports', () => {
  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
  ]);

  ensureRunnableScaffold(fileMap);
  const apiClient = fileMap.get('src/lib/api-client.ts')?.content ?? '';
  assert.match(apiClient, /export async function apiFetch/);
  assert.match(apiClient, /export async function fetcher/);
  assert.match(apiClient, /export async function postJson/);
  assert.match(apiClient, /export const apiClient = \{ apiFetch, request, getJson, postJson, fetcher \};/);
});

test('ensureRunnableScaffold keeps existing standalone api-client file', () => {
  const existing = "export const custom = true;\n";
  const fileMap = new Map<string, ProjectFile>([
    ['src/app/page.tsx', file('src/app/page.tsx', 'export default function Page(){ return <main>ok</main>; }\n')],
    ['src/lib/api-client.ts', file('src/lib/api-client.ts', existing)],
  ]);

  ensureRunnableScaffold(fileMap);
  assert.equal(fileMap.get('src/lib/api-client.ts')?.content, existing);
});
