import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import test from 'node:test';
import Fastify from 'fastify';
import { registerPreviewRoutes } from './preview-routes.js';

function createNoopLogger() {
  return {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
}

function createAuthStub() {
  const allow = async () => {};
  return {
    requireProjectAccess: () => allow,
    requireRole: () => allow,
  };
}

async function startHeaderEchoServer(): Promise<{
  port: number;
  close: () => Promise<void>;
  getLastRequest: () => IncomingMessage | null;
}> {
  let lastRequest: IncomingMessage | null = null;
  const server = createServer((req, res) => {
    lastRequest = req;
    res.statusCode = 200;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: true }));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return {
    port,
    close: async () => {
      await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
    },
    getLastRequest: () => lastRequest,
  };
}

test('preview proxy strips auth, cookie, csrf, and internal identity headers', async () => {
  const upstream = await startHeaderEchoServer();
  const app = Fastify({ logger: false });
  const projectId = 'projABCD1';
  registerPreviewRoutes(app, {
    preview: {
      getStatus: () => ({
        projectId,
        state: 'ready',
        health: 'healthy',
        hostPort: upstream.port,
      }),
      touch: () => {},
      isAnyAvailable: () => true,
      isDockerAvailable: () => false,
      isLocalAvailable: () => true,
      listAll: () => [],
      start: async () => ({ state: 'ready', health: 'healthy', hostPort: upstream.port }),
      stop: async () => {},
      reportIframeReady: () => {},
    } as never,
    projectStore: { get: async () => ({ id: projectId }) } as never,
    updater: {} as never,
    apiBaseUrl: 'http://127.0.0.1:3003',
    logger: createNoopLogger() as never,
    auth: createAuthStub() as never,
  });

  const res = await app.inject({
    method: 'GET',
    url: `/preview/${projectId}/index.html`,
    headers: {
      authorization: 'Bearer secret',
      cookie: 'devteam_access_token=secret',
      'x-csrf-token': 'csrf-secret',
      'x-devteam-user-id': 'u_123',
      'x-devteam-user-email': 'user@example.com',
      'x-devteam-workspace-id': 'w_123',
      'x-devteam-role': 'owner',
      'x-internal-token': 'internal-secret',
      accept: 'text/html',
      'x-preview-client': 'ui',
    },
  });

  assert.equal(res.statusCode, 200);
  const req = upstream.getLastRequest();
  assert.ok(req, 'upstream request should exist');
  const headers = req.headers;
  assert.equal(headers.authorization, undefined);
  assert.equal(headers.cookie, undefined);
  assert.equal(headers['x-csrf-token'], undefined);
  assert.equal(headers['x-devteam-user-id'], undefined);
  assert.equal(headers['x-devteam-user-email'], undefined);
  assert.equal(headers['x-devteam-workspace-id'], undefined);
  assert.equal(headers['x-devteam-role'], undefined);
  assert.equal(headers['x-internal-token'], undefined);
  assert.equal(headers.accept, 'text/html');
  assert.equal(headers['x-preview-client'], 'ui');

  await app.close();
  await upstream.close();
});
