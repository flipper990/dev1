import assert from 'node:assert/strict';
import test from 'node:test';
import Fastify from 'fastify';
import { nanoid } from 'nanoid';

import { registerAuthRoutes } from './auth-routes.js';
import { createAuthGuardsWithSettings, type WorkspaceRole } from '../security/auth.js';
import type { AuthStore, AuthUser, RefreshSession } from '../security/auth-store.js';
import { normalizeEmail } from '../security/auth-store.js';

function parseCookie(setCookieHeader: string[] | string | undefined, name: string): string | null {
  const lines = Array.isArray(setCookieHeader)
    ? setCookieHeader
    : setCookieHeader
      ? [setCookieHeader]
      : [];
  for (const line of lines) {
    const [pair] = line.split(';');
    if (!pair) continue;
    const [cookieName, cookieValue] = pair.split('=');
    if (cookieName?.trim() !== name) continue;
    try {
      return decodeURIComponent((cookieValue ?? '').trim());
    } catch {
      return (cookieValue ?? '').trim();
    }
  }
  return null;
}

class InMemoryAuthStore {
  private usersById = new Map<string, AuthUser>();
  private usersByEmail = new Map<string, string>();
  private refreshByHash = new Map<string, RefreshSession>();
  private resetByHash = new Map<string, { id: string; userId: string; tokenHash: string; expiresAt: string; createdAt: string; usedAt: string | null }>();
  private verifyByHash = new Map<string, { id: string; userId: string; tokenHash: string; expiresAt: string; createdAt: string; usedAt: string | null }>();

  async ensureSchema(): Promise<void> {}
  async close(): Promise<void> {}
  async cleanupExpiredTokens(): Promise<void> {}

  async findUserByEmail(email: string): Promise<AuthUser | null> {
    const normalized = normalizeEmail(email);
    const id = this.usersByEmail.get(normalized);
    if (!id) return null;
    return this.usersById.get(id) ?? null;
  }

  async findUserById(userId: string): Promise<AuthUser | null> {
    return this.usersById.get(userId) ?? null;
  }

  async createUser(input: {
    email: string;
    fullName: string;
    passwordHash: string;
    role?: 'user' | 'admin';
    workspaceId?: string;
    workspaceRole?: WorkspaceRole;
  }): Promise<AuthUser> {
    const normalized = normalizeEmail(input.email);
    if (this.usersByEmail.has(normalized)) {
      const duplicate = new Error('duplicate');
      (duplicate as { code?: string }).code = '23505';
      throw duplicate;
    }
    const now = new Date().toISOString();
    const user: AuthUser = {
      id: `usr_${nanoid(12)}`,
      email: normalized,
      emailNormalized: normalized,
      fullName: input.fullName,
      passwordHash: input.passwordHash,
      role: input.role ?? 'user',
      workspaceId: input.workspaceId ?? `ws_${nanoid(10)}`,
      workspaceRole: input.workspaceRole ?? 'owner',
      emailVerified: false,
      emailVerifiedAt: null,
      lastLoginAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.usersById.set(user.id, user);
    this.usersByEmail.set(normalized, user.id);
    return user;
  }

  async markUserPassword(userId: string, passwordHash: string): Promise<void> {
    const user = this.usersById.get(userId);
    if (!user) return;
    user.passwordHash = passwordHash;
    user.updatedAt = new Date().toISOString();
  }

  async markEmailVerified(userId: string): Promise<void> {
    const user = this.usersById.get(userId);
    if (!user) return;
    user.emailVerified = true;
    user.emailVerifiedAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
  }

  async touchLastLogin(userId: string): Promise<void> {
    const user = this.usersById.get(userId);
    if (!user) return;
    user.lastLoginAt = new Date().toISOString();
    user.updatedAt = new Date().toISOString();
  }

  async createRefreshSession(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<RefreshSession> {
    const session: RefreshSession = {
      id: `rt_${nanoid(12)}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revokedAt: null,
      replacedByTokenId: null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };
    this.refreshByHash.set(session.tokenHash, session);
    return session;
  }

  async findRefreshSessionByHash(tokenHash: string): Promise<RefreshSession | null> {
    return this.refreshByHash.get(tokenHash) ?? null;
  }

  async rotateRefreshSession(input: {
    currentTokenHash: string;
    nextTokenHash: string;
    nextExpiresAt: Date;
    ipAddress?: string | null;
    userAgent?: string | null;
  }): Promise<{ session: RefreshSession; user: AuthUser } | null> {
    const current = this.refreshByHash.get(input.currentTokenHash);
    if (!current || current.revokedAt || Date.parse(current.expiresAt) <= Date.now()) return null;
    current.revokedAt = new Date().toISOString();
    current.updatedAt = new Date().toISOString();
    const next: RefreshSession = {
      id: `rt_${nanoid(12)}`,
      userId: current.userId,
      tokenHash: input.nextTokenHash,
      expiresAt: input.nextExpiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      revokedAt: null,
      replacedByTokenId: null,
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    };
    this.refreshByHash.set(next.tokenHash, next);
    const user = this.usersById.get(current.userId);
    if (!user) return null;
    return { session: next, user };
  }

  async revokeRefreshSessionByHash(tokenHash: string): Promise<void> {
    const session = this.refreshByHash.get(tokenHash);
    if (!session) return;
    session.revokedAt = session.revokedAt ?? new Date().toISOString();
    session.updatedAt = new Date().toISOString();
  }

  async revokeRefreshSessionsForUser(userId: string): Promise<void> {
    for (const session of this.refreshByHash.values()) {
      if (session.userId !== userId) continue;
      session.revokedAt = session.revokedAt ?? new Date().toISOString();
      session.updatedAt = new Date().toISOString();
    }
  }

  async createPasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    for (const [hash, token] of this.resetByHash.entries()) {
      if (token.userId === input.userId && !token.usedAt) this.resetByHash.delete(hash);
    }
    const token = {
      id: `prt_${nanoid(12)}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      usedAt: null as string | null,
    };
    this.resetByHash.set(token.tokenHash, token);
    return token;
  }

  async consumePasswordResetToken(tokenHash: string) {
    const token = this.resetByHash.get(tokenHash);
    if (!token || token.usedAt || Date.parse(token.expiresAt) <= Date.now()) return null;
    token.usedAt = new Date().toISOString();
    const user = this.usersById.get(token.userId);
    if (!user) return null;
    return { token, user };
  }

  async createEmailVerificationToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    for (const [hash, token] of this.verifyByHash.entries()) {
      if (token.userId === input.userId && !token.usedAt) this.verifyByHash.delete(hash);
    }
    const token = {
      id: `evt_${nanoid(12)}`,
      userId: input.userId,
      tokenHash: input.tokenHash,
      expiresAt: input.expiresAt.toISOString(),
      createdAt: new Date().toISOString(),
      usedAt: null as string | null,
    };
    this.verifyByHash.set(token.tokenHash, token);
    return token;
  }

  async consumeEmailVerificationToken(tokenHash: string) {
    const token = this.verifyByHash.get(tokenHash);
    if (!token || token.usedAt || Date.parse(token.expiresAt) <= Date.now()) return null;
    token.usedAt = new Date().toISOString();
    const user = this.usersById.get(token.userId);
    if (!user) return null;
    return { token, user };
  }
}

function createAuthTestApp() {
  const app = Fastify({ logger: false });
  const fakeProjectStore = {
    async get() { return null; },
    async update() { return null; },
  };
  const auth = createAuthGuardsWithSettings(fakeProjectStore as never, {
    devBypass: false,
    isDev: true,
  });
  const store = new InMemoryAuthStore();
  app.addHook('onRequest', auth.authenticate);
  registerAuthRoutes(app, {
    auth,
    authStore: store as unknown as AuthStore,
  });
  return { app, store };
}

test('auth signup/signin/session/duplicate flow works', async () => {
  const { app } = createAuthTestApp();
  const signup = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      fullName: 'Auth User',
      email: 'auth@example.com',
      password: 'StrongPassword!1',
    },
  });
  assert.equal(signup.statusCode, 201);

  const duplicate = await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      fullName: 'Auth User',
      email: 'auth@example.com',
      password: 'StrongPassword!1',
    },
  });
  assert.equal(duplicate.statusCode, 409);

  const accessToken = parseCookie(signup.headers['set-cookie'], 'devteam_access_token');
  assert.ok(accessToken);
  const session = await app.inject({
    method: 'GET',
    url: '/api/auth/session',
    headers: {
      cookie: `devteam_access_token=${encodeURIComponent(accessToken ?? '')}`,
    },
  });
  assert.equal(session.statusCode, 200);

  const invalidSignin = await app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: {
      email: 'auth@example.com',
      password: 'wrong-password',
    },
  });
  assert.equal(invalidSignin.statusCode, 401);

  const validSignin = await app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: {
      email: 'auth@example.com',
      password: 'StrongPassword!1',
    },
  });
  assert.equal(validSignin.statusCode, 200);

  const refreshToken = parseCookie(validSignin.headers['set-cookie'], 'devteam_refresh_token');
  const csrfToken = parseCookie(validSignin.headers['set-cookie'], 'devteam_csrf_token');
  assert.ok(refreshToken);
  assert.ok(csrfToken);

  const signout = await app.inject({
    method: 'POST',
    url: '/api/auth/signout',
    headers: {
      cookie: [
        `devteam_access_token=${encodeURIComponent(parseCookie(validSignin.headers['set-cookie'], 'devteam_access_token') ?? '')}`,
        `devteam_refresh_token=${encodeURIComponent(refreshToken ?? '')}`,
        `devteam_csrf_token=${encodeURIComponent(csrfToken ?? '')}`,
      ].join('; '),
      'x-csrf-token': csrfToken ?? '',
    },
  });
  assert.equal(signout.statusCode, 200);

  const refreshAfterSignout = await app.inject({
    method: 'POST',
    url: '/api/auth/refresh',
    headers: {
      cookie: `devteam_refresh_token=${encodeURIComponent(refreshToken ?? '')}`,
    },
    payload: {},
  });
  assert.equal(refreshAfterSignout.statusCode, 401);

  await app.close();
});

test('auth forgot/reset flow updates password and blocks old credentials', async () => {
  const { app } = createAuthTestApp();

  await app.inject({
    method: 'POST',
    url: '/api/auth/signup',
    payload: {
      fullName: 'Reset User',
      email: 'reset@example.com',
      password: 'StrongPassword!1',
    },
  });

  const forgot = await app.inject({
    method: 'POST',
    url: '/api/auth/forgot-password',
    payload: { email: 'reset@example.com' },
  });
  assert.equal(forgot.statusCode, 200);
  const forgotBody = forgot.json() as { token?: string };
  assert.ok(forgotBody.token);

  const reset = await app.inject({
    method: 'POST',
    url: '/api/auth/reset-password',
    payload: {
      token: forgotBody.token,
      password: 'NewPassword!2',
    },
  });
  assert.equal(reset.statusCode, 200);

  const oldSignin = await app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: {
      email: 'reset@example.com',
      password: 'StrongPassword!1',
    },
  });
  assert.equal(oldSignin.statusCode, 401);

  const newSignin = await app.inject({
    method: 'POST',
    url: '/api/auth/signin',
    payload: {
      email: 'reset@example.com',
      password: 'NewPassword!2',
    },
  });
  assert.equal(newSignin.statusCode, 200);
  await app.close();
});
