import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { ProjectRecord } from '../storage/project-store.js';
import { createAuthGuardsWithSettings, createAuthToken } from './auth.js';

function makeProject(projectId: string, workspaceId: string, ownerUserId: string): ProjectRecord {
  return {
    id: projectId,
    sessionId: `sess-${projectId}`,
    name: `Project ${projectId}`,
    prompts: ['build app'],
    status: 'generated',
    files: [],
    tasks: [],
    totalTokens: 0,
    totalCostUsd: 0,
    durationMs: 0,
    version: 1,
    versionHistory: [],
    createdAt: new Date().toISOString(),
    ownership: {
      workspaceId,
      ownerUserId,
      createdByUserId: ownerUserId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

function makeApp(
  projects: ProjectRecord[],
  options?: { devBypass?: boolean; tokenSecret?: string; isDev?: boolean },
): FastifyInstance {
  const projectMap = new Map(projects.map((project) => [project.id, project]));
  const fakeStore = {
    async get(projectId: string) {
      return projectMap.get(projectId) ?? null;
    },
    async update(projectId: string, mutator: (current: ProjectRecord) => void) {
      const current = projectMap.get(projectId) ?? null;
      if (!current) return null;
      mutator(current);
      projectMap.set(projectId, current);
      return current;
    },
  };
  const app = Fastify({ logger: false });
  const auth = createAuthGuardsWithSettings(fakeStore as unknown as import('../storage/project-store.js').ProjectStore, {
    devBypass: options?.devBypass ?? false,
    isDev: options?.isDev ?? true,
    tokenSecret: options?.tokenSecret ?? 'test-secret',
  });
  app.addHook('onRequest', auth.authenticate);
  app.get('/api/projects', { preHandler: [auth.requireRole('viewer')] }, async (request) => ({ userId: request.auth?.userId ?? null }));
  app.post('/api/projects/:id/mutate', { preHandler: [auth.requireProjectAccess('member')] }, async () => ({ ok: true }));
  app.get('/api/projects/:id/read', { preHandler: [auth.requireProjectAccess('viewer')] }, async () => ({ ok: true }));
  app.post('/api/write', { preHandler: [auth.requireRole('viewer')] }, async () => ({ ok: true }));
  return app;
}

test('unauthenticated access denied', async () => {
  const app = makeApp([makeProject('p1', 'ws-1', 'u1')]);
  const response = await app.inject({
    method: 'GET',
    url: '/api/projects/p1/read',
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('cross-project access denied for different workspace', async () => {
  const app = makeApp([makeProject('p1', 'ws-owner', 'u-owner')], { devBypass: true });
  const response = await app.inject({
    method: 'GET',
    url: '/api/projects/p1/read',
    headers: {
      'x-devteam-user-id': 'u-member',
      'x-devteam-workspace-id': 'ws-other',
      'x-devteam-role': 'member',
    },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('dev bypass injects default mock principal when headers are absent', async () => {
  const app = makeApp([makeProject('p1', 'dev-workspace', 'dev-user')], { devBypass: true });
  const response = await app.inject({
    method: 'GET',
    url: '/api/projects',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().userId, 'dev-user');
  await app.close();
});

test('owner and admin can mutate', async () => {
  const app = makeApp([makeProject('p1', 'ws-1', 'u-owner')], { devBypass: true });

  const owner = await app.inject({
    method: 'POST',
    url: '/api/projects/p1/mutate',
    headers: {
      'x-devteam-user-id': 'u-owner',
      'x-devteam-workspace-id': 'ws-1',
      'x-devteam-role': 'viewer',
    },
  });
  assert.equal(owner.statusCode, 200);

  const admin = await app.inject({
    method: 'POST',
    url: '/api/projects/p1/mutate',
    headers: {
      'x-devteam-user-id': 'u-admin',
      'x-devteam-workspace-id': 'ws-1',
      'x-devteam-role': 'admin',
    },
  });
  assert.equal(admin.statusCode, 200);
  await app.close();
});

test('viewer cannot mutate', async () => {
  const app = makeApp([makeProject('p1', 'ws-1', 'u-owner')], { devBypass: true });
  const response = await app.inject({
    method: 'POST',
    url: '/api/projects/p1/mutate',
    headers: {
      'x-devteam-user-id': 'u-viewer',
      'x-devteam-workspace-id': 'ws-1',
      'x-devteam-role': 'viewer',
    },
  });
  assert.equal(response.statusCode, 403);
  await app.close();
});

test('signed bearer token grants access', async () => {
  const app = makeApp([makeProject('p1', 'ws-1', 'u-owner')]);
  const token = createAuthToken({ sub: 'u-owner', workspaceId: 'ws-1', role: 'owner' }, 'test-secret');

  const response = await app.inject({
    method: 'GET',
    url: '/api/projects/p1/read',
    headers: {
      authorization: `Bearer ${token}`,
    },
  });

  assert.equal(response.statusCode, 200);
  await app.close();
});

test('signed cookie token grants access', async () => {
  const app = makeApp([makeProject('p1', 'ws-1', 'u-owner')]);
  const token = createAuthToken({ sub: 'u-owner', workspaceId: 'ws-1', role: 'owner' }, 'test-secret');

  const response = await app.inject({
    method: 'GET',
    url: '/api/projects/p1/read',
    headers: {
      cookie: `devteam_auth_token=${encodeURIComponent(token)}`,
    },
  });

  assert.equal(response.statusCode, 200);
  await app.close();
});

test('cookie-authenticated mutation requires csrf token', async () => {
  const app = makeApp([makeProject('p1', 'ws-1', 'u-owner')]);
  const token = createAuthToken({ sub: 'u-owner', workspaceId: 'ws-1', role: 'owner', type: 'access' }, 'test-secret');

  const denied = await app.inject({
    method: 'POST',
    url: '/api/write',
    headers: {
      cookie: `devteam_access_token=${encodeURIComponent(token)}`,
    },
  });
  assert.equal(denied.statusCode, 403);

  const allowed = await app.inject({
    method: 'POST',
    url: '/api/write',
    headers: {
      cookie: `devteam_access_token=${encodeURIComponent(token)}; devteam_csrf_token=csrf123`,
      'x-csrf-token': 'csrf123',
    },
  });
  assert.equal(allowed.statusCode, 200);
  await app.close();
});

test('dev headers are rejected when bypass disabled', async () => {
  const app = makeApp([makeProject('p1', 'ws-1', 'u-owner')], { devBypass: false });
  const response = await app.inject({
    method: 'GET',
    url: '/api/projects/p1/read',
    headers: {
      'x-devteam-user-id': 'u-owner',
      'x-devteam-workspace-id': 'ws-1',
      'x-devteam-role': 'owner',
    },
  });
  assert.equal(response.statusCode, 401);
  await app.close();
});

test('production mode ignores dev bypass and rejects unauthenticated access', async () => {
  const warnings: string[] = [];
  const originalWarn = console.warn;
  console.warn = (...parts: unknown[]) => {
    warnings.push(parts.map((part) => String(part)).join(' '));
  };
  try {
    const app = makeApp([makeProject('p1', 'dev-workspace', 'dev-user')], { devBypass: true, isDev: false });
    const response = await app.inject({
      method: 'GET',
      url: '/api/projects/p1/read',
    });
    assert.equal(response.statusCode, 401);
    assert.ok(warnings.some((line) => /DEV_AUTH_BYPASS/i.test(line)));
    await app.close();
  } finally {
    console.warn = originalWarn;
  }
});
