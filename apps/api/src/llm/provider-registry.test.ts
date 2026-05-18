import assert from 'node:assert/strict';
import test from 'node:test';

import { ProviderRegistry } from './provider-registry.js';
import type { LLMProviderClient } from './types.js';

function loggerStub() {
  return {
    info() {},
    warn() {},
    error() {},
    debug() {},
  };
}

function makeProvider(id: 'openai' | 'anthropic', healthy: boolean): LLMProviderClient {
  return {
    providerId: id,
    displayName: id,
    async chatSync() {
      return { content: 'ok', tokensIn: 1, tokensOut: 1 };
    },
    async *chatStream() {
      yield 'ok';
    },
    async healthCheck() {
      return healthy;
    },
  } as LLMProviderClient;
}

test('preflight fails when required provider is unhealthy', async () => {
  const registry = new ProviderRegistry(loggerStub() as never);
  registry.register(makeProvider('openai', false));
  const preflight = await registry.preflight(['openai'], { timeoutMs: 250 });
  assert.equal(preflight.ok, false);
  assert.equal(preflight.providers.openai?.healthy, false);
  assert.match(preflight.reason ?? '', /openai/i);
});

test('preflight passes when required providers are healthy', async () => {
  const registry = new ProviderRegistry(loggerStub() as never);
  registry.register(makeProvider('openai', true));
  registry.register(makeProvider('anthropic', true));
  const preflight = await registry.preflight(['openai', 'anthropic'], { timeoutMs: 250 });
  assert.equal(preflight.ok, true);
  assert.equal(preflight.providers.openai?.healthy, true);
  assert.equal(preflight.providers.anthropic?.healthy, true);
});
