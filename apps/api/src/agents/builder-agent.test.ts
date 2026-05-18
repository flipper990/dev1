import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDeterministicTier1Fallback,
  deriveFallbackTargetPaths,
  type BuilderInput,
} from './builder-agent.js';

test('builder fallback target paths are src-canonical and include deterministic baseline files', () => {
  const input: BuilderInput = {
    spec: { prompt: 'Build a simple dashboard page' },
    currentSlice: {
      id: 'slice-dashboard',
      routes: ['/dashboard'],
      components: ['KpiCard'],
      apiIds: ['metrics'],
    },
  };

  const paths = deriveFallbackTargetPaths(input);
  assert.ok(paths.includes('src/app/layout.tsx'));
  assert.ok(paths.includes('src/app/page.tsx'));
  assert.ok(paths.includes('src/app/globals.css'));
  assert.ok(paths.includes('src/app/dashboard/page.tsx'));
  assert.ok(paths.includes('src/components/KpiCard.tsx'));
  assert.ok(paths.includes('src/app/api/metrics/route.ts'));
  assert.equal(paths.some((p) => p.startsWith('app/')), false);
});

test('deterministic tier1 fallback creates non-empty preview-safe shell files', () => {
  const input: BuilderInput = {
    spec: { prompt: 'Build a simple landing page with hero and CTA' },
    currentSlice: {
      id: 'slice-landing',
      routes: ['/'],
      components: ['HeroBanner'],
    },
  };
  const targets = deriveFallbackTargetPaths(input);
  const files = buildDeterministicTier1Fallback(input, targets);
  const byPath = new Map(files.map((f) => [f.path, f.content]));

  for (const required of [
    'package.json',
    'tsconfig.json',
    'next.config.mjs',
    'postcss.config.js',
    'src/app/layout.tsx',
    'src/app/page.tsx',
    'src/app/globals.css',
  ]) {
    assert.ok(byPath.has(required), `missing ${required}`);
    assert.ok((byPath.get(required) ?? '').trim().length > 0, `${required} should not be empty`);
  }

  const page = byPath.get('src/app/page.tsx') ?? '';
  assert.match(page, /Simple Landing Page|Simple Generated App/i);
});

