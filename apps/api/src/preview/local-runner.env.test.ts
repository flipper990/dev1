import assert from 'node:assert/strict';
import test from 'node:test';

import { assertNoForbiddenPreviewEnvKeys, buildLocalPreviewEnv } from './local-runner.js';

test('buildLocalPreviewEnv uses allowlist and drops secret env keys', () => {
  const baseEnv = {
    Path: 'C:\\Windows\\System32',
    NODE_ENV: 'development',
    OPENAI_API_KEY: 'sk-openai-secret',
    ANTHROPIC_API_KEY: 'sk-anthropic-secret',
    AZURE_OPENAI_API_KEY: 'azure-secret',
    DATABASE_URL: 'postgres://admin:secret@localhost:5432/app',
    AUTH_SECRET: 'super-secret',
    STRIPE_SECRET_KEY: 'stripe-secret',
  } as Record<string, string>;

  const bundle = buildLocalPreviewEnv({
    phase: 'dev',
    baseEnv,
    port: 43123,
    host: '127.0.0.1',
  });

  assert.equal(bundle.env.PATH, 'C:\\Windows\\System32');
  assert.equal(bundle.env.PORT, '43123');
  assert.equal(bundle.env.HOST, '127.0.0.1');
  assert.equal(bundle.env.NODE_ENV, 'development');
  assert.equal(bundle.env.CI, '1');
  assert.equal(bundle.env.BROWSER, 'none');

  assert.equal('OPENAI_API_KEY' in bundle.env, false);
  assert.equal('ANTHROPIC_API_KEY' in bundle.env, false);
  assert.equal('AZURE_OPENAI_API_KEY' in bundle.env, false);
  assert.equal('DATABASE_URL' in bundle.env, false);
  assert.equal('AUTH_SECRET' in bundle.env, false);
  assert.equal('STRIPE_SECRET_KEY' in bundle.env, false);
});

test('buildLocalPreviewEnv install phase keeps minimal runtime env', () => {
  const bundle = buildLocalPreviewEnv({
    phase: 'install',
    baseEnv: {
      PATH: '/usr/bin:/bin',
      NODE_ENV: 'test',
      NEXT_PUBLIC_API_URL: 'http://localhost:3003',
    },
  });

  assert.equal(bundle.env.PATH, '/usr/bin:/bin');
  assert.equal(bundle.env.NODE_ENV, 'test');
  assert.equal(bundle.env.CI, '1');
  assert.equal(bundle.env.FORCE_COLOR, '0');
  assert.equal(bundle.env.NO_COLOR, '1');
  assert.equal('PORT' in bundle.env, false);
  assert.equal('HOST' in bundle.env, false);
  assert.equal('NEXT_PUBLIC_API_URL' in bundle.env, false);
});

test('assertNoForbiddenPreviewEnvKeys rejects forbidden keys', () => {
  assert.throws(
    () => assertNoForbiddenPreviewEnvKeys({ OPENAI_API_KEY: 'x', PATH: '/usr/bin' }),
    /forbidden preview env keys/i,
  );
});
