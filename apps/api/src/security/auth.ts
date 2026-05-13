import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import type { ProjectRecord, ProjectStore } from '../storage/project-store.js';
import { config } from '../config.js';
import { AUTH_COOKIE_NAMES } from './auth-cookies.js';

export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';
export type AccountRole = 'user' | 'admin';

export interface AuthPrincipal {
  userId: string;
  email?: string;
  workspaceId: string;
  role: WorkspaceRole;
  accountRole: AccountRole;
  tokenExpiresAt?: number;
}

export interface AuthTokenClaims {
  sub: string;
  workspaceId: string;
  role: WorkspaceRole;
  accountRole?: AccountRole;
  email?: string;
  type?: 'access';
  exp?: number;
  iat?: number;
  sid?: string;
  jti?: string;
}

const ROLE_ORDER: Record<WorkspaceRole, number> = {
  viewer: 0,
  member: 1,
  admin: 2,
  owner: 3,
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const PUBLIC_AUTH_PATHS = new Set([
  '/api/auth/signup',
  '/api/auth/signin',
  '/api/auth/refresh',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
  '/api/auth/verify-email/confirm',
  '/api/auth/verify-email/resend',
]);

function roleAtLeast(actual: WorkspaceRole, required: WorkspaceRole): boolean {
  return ROLE_ORDER[actual] >= ROLE_ORDER[required];
}

function parseRole(value: string | undefined): WorkspaceRole | null {
  if (!value) return null;
  const lowered = value.trim().toLowerCase();
  if (lowered === 'owner' || lowered === 'admin' || lowered === 'member' || lowered === 'viewer') {
    return lowered;
  }
  return null;
}

export function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  if (!cookieHeader || !cookieHeader.trim()) return {};
  const out: Record<string, string> = {};
  const parts = cookieHeader.split(';');
  for (const part of parts) {
    const idx = part.indexOf('=');
    if (idx <= 0) continue;
    const key = part.slice(0, idx).trim();
    if (!key) continue;
    const rawValue = part.slice(idx + 1).trim();
    try {
      out[key] = decodeURIComponent(rawValue);
    } catch {
      out[key] = rawValue;
    }
  }
  return out;
}

function normalizeBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^Bearer\s+/i.test(trimmed)) {
    const token = trimmed.replace(/^Bearer\s+/i, '').trim();
    return token.length > 0 ? token : null;
  }
  return trimmed;
}

function base64UrlEncode(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function base64UrlDecode(input: string): Buffer {
  return Buffer.from(input, 'base64url');
}

function signPayload(payloadBase64: string, secret: string): string {
  return base64UrlEncode(createHmac('sha256', secret).update(payloadBase64).digest());
}

function verifySignedToken(token: string, secret: string): AuthTokenClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'dt1') return null;
  const payloadBase64 = parts[1];
  const signature = parts[2];
  const expected = signPayload(payloadBase64, secret);
  const provided = Buffer.from(signature);
  const computed = Buffer.from(expected);
  if (provided.length !== computed.length) return null;
  if (!timingSafeEqual(provided, computed)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64UrlDecode(payloadBase64).toString('utf8'));
  } catch {
    return null;
  }
  const claims = parsed as Partial<AuthTokenClaims>;
  const role = parseRole(claims.role);
  const accountRole = claims.accountRole === 'admin' ? 'admin' : 'user';
  if (!claims.sub || !claims.workspaceId || !role) return null;
  if (claims.type && claims.type !== 'access') return null;
  if (typeof claims.exp === 'number' && Number.isFinite(claims.exp) && claims.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return {
    sub: claims.sub,
    workspaceId: claims.workspaceId,
    role,
    accountRole,
    email: claims.email,
    type: 'access',
    exp: claims.exp,
    iat: claims.iat,
    sid: claims.sid,
    jti: claims.jti,
  };
}

interface AuthSettings {
  devBypassRequested: boolean;
  devBypass: boolean;
  tokenSecret: string;
  isDev: boolean;
  devUserId: string;
  devUserEmail: string;
  devWorkspaceId: string;
  devRole: WorkspaceRole;
}

const defaultAuthSettings: AuthSettings = {
  devBypassRequested: config.auth.devBypassRequested,
  devBypass: config.auth.devBypass,
  tokenSecret: config.auth.tokenSecret,
  isDev: config.isDev,
  devUserId: config.auth.devUserId,
  devUserEmail: config.auth.devUserEmail,
  devWorkspaceId: config.auth.devWorkspaceId,
  devRole: parseRole(config.auth.devRole) ?? 'owner',
};

function resolveDevHeaderPrincipal(request: FastifyRequest): AuthPrincipal | null {
  const userId = typeof request.headers['x-devteam-user-id'] === 'string'
    ? request.headers['x-devteam-user-id'].trim()
    : '';
  const email = typeof request.headers['x-devteam-user-email'] === 'string'
    ? request.headers['x-devteam-user-email'].trim()
    : '';
  const workspaceId = typeof request.headers['x-devteam-workspace-id'] === 'string'
    ? request.headers['x-devteam-workspace-id'].trim()
    : '';
  const role = parseRole(
    typeof request.headers['x-devteam-role'] === 'string'
      ? request.headers['x-devteam-role']
      : undefined,
  );
  if (!userId || !workspaceId || !role) return null;
  return {
    userId,
    email: email || undefined,
    workspaceId,
    role,
    accountRole: role === 'admin' ? 'admin' : 'user',
  };
}

function resolvePrincipal(
  request: FastifyRequest,
  settings: AuthSettings,
  cookieBag: Record<string, string>,
): AuthPrincipal | null {
  const authHeader = request.headers.authorization;
  const headerToken = normalizeBearerToken(authHeader);
  const cookieToken = normalizeBearerToken(
    cookieBag[AUTH_COOKIE_NAMES.accessToken]
      ?? cookieBag[AUTH_COOKIE_NAMES.legacyAccessToken]
      ?? cookieBag.auth_token
      ?? cookieBag.access_token
      ?? cookieBag.token,
  );

  const signedToken = headerToken ?? cookieToken;
  if (signedToken && settings.tokenSecret) {
    const claims = verifySignedToken(signedToken, settings.tokenSecret);
    if (claims) {
      return {
        userId: claims.sub,
        email: claims.email,
        workspaceId: claims.workspaceId,
        role: claims.role,
        accountRole: claims.accountRole === 'admin' ? 'admin' : 'user',
        tokenExpiresAt: claims.exp,
      };
    }
  }

  if (settings.devBypass) {
    const headerPrincipal = resolveDevHeaderPrincipal(request);
    if (headerPrincipal) return headerPrincipal;
    return {
      userId: settings.devUserId,
      email: settings.devUserEmail,
      workspaceId: settings.devWorkspaceId,
      role: settings.devRole,
      accountRole: settings.devRole === 'admin' ? 'admin' : 'user',
    };
  }

  return null;
}

function normalizePath(url: string): string {
  const withoutQuery = url.split('?')[0] ?? url;
  if (withoutQuery.length > 1 && withoutQuery.endsWith('/')) {
    return withoutQuery.slice(0, -1);
  }
  return withoutQuery;
}

function isProtectedPath(url: string): boolean {
  const path = normalizePath(url);
  if (path === '/health') return false;
  if (path.startsWith('/api/auth/')) return !PUBLIC_AUTH_PATHS.has(path);
  if (path.startsWith('/api/')) return true;
  if (path.startsWith('/preview/')) return true;
  if (path.startsWith('/ws/')) return true;
  if (path === '/debug/runtime') return true;
  return false;
}

function requiresCsrfValidation(
  request: FastifyRequest,
  cookieBag: Record<string, string>,
): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  if (request.headers.authorization) return false;
  return Boolean(
    cookieBag[AUTH_COOKIE_NAMES.accessToken]
    || cookieBag[AUTH_COOKIE_NAMES.legacyAccessToken]
    || cookieBag.auth_token
    || cookieBag.access_token
    || cookieBag.token,
  );
}

function unauthorized(reply: FastifyReply, message = 'Authentication required') {
  return reply.status(401).send({ error: message, code: 'UNAUTHENTICATED' });
}

function forbidden(reply: FastifyReply, message = 'Forbidden') {
  return reply.status(403).send({ error: message, code: 'FORBIDDEN' });
}

export interface ProjectOwnership {
  workspaceId: string;
  ownerUserId: string;
  createdByUserId: string;
  createdAt: string;
  updatedAt?: string;
}

function getOwnership(project: ProjectRecord): ProjectOwnership | null {
  const raw = (project as ProjectRecord & { ownership?: Partial<ProjectOwnership> }).ownership;
  if (!raw) return null;
  if (!raw.workspaceId || !raw.ownerUserId || !raw.createdByUserId || !raw.createdAt) return null;
  return {
    workspaceId: raw.workspaceId,
    ownerUserId: raw.ownerUserId,
    createdByUserId: raw.createdByUserId,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

function effectiveRole(principal: AuthPrincipal, project: ProjectRecord): WorkspaceRole {
  const ownership = getOwnership(project);
  if (ownership && ownership.ownerUserId === principal.userId) return 'owner';
  return principal.role;
}

export function withOwnership<T extends ProjectRecord>(
  project: T,
  principal: AuthPrincipal,
): T & { ownership: ProjectOwnership } {
  const now = new Date().toISOString();
  const existing = getOwnership(project);
  return {
    ...project,
    ownership: existing ?? {
      workspaceId: principal.workspaceId,
      ownerUserId: principal.userId,
      createdByUserId: principal.userId,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function createAuthToken(claims: AuthTokenClaims, secret: string): string {
  const payload = base64UrlEncode(JSON.stringify(claims));
  const signature = signPayload(payload, secret);
  return `dt1.${payload}.${signature}`;
}

export function getAuthPrincipal(request: FastifyRequest): AuthPrincipal {
  if (!request.auth) {
    throw new Error('Missing authenticated principal on request');
  }
  return request.auth;
}

interface EnsureProjectAccessOptions {
  minRole?: WorkspaceRole;
  allowLegacyClaim?: boolean;
}

export function createAuthGuards(projectStore: ProjectStore) {
  const settings = defaultAuthSettings;
  return createAuthGuardsWithSettings(projectStore, settings);
}

export function createAuthGuardsWithSettings(
  projectStore: ProjectStore,
  settingsOverride: Partial<AuthSettings>,
) {
  const settings: AuthSettings = { ...defaultAuthSettings, ...settingsOverride };
  if (!settings.isDev && (settings.devBypassRequested || settings.devBypass)) {
    console.warn('[auth] DEV_AUTH_BYPASS is ignored in production mode');
    settings.devBypass = false;
  }
  const authenticate: preHandlerHookHandler = async (request, reply) => {
    if (request.method === 'OPTIONS') return;
    if (!isProtectedPath(request.url)) return;
    const cookieBag = parseCookieHeader(
      typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined,
    );
    const principal = resolvePrincipal(request, settings, cookieBag);
    if (!principal) {
      await unauthorized(reply);
      return;
    }
    if (requiresCsrfValidation(request, cookieBag)) {
      const csrfCookie = cookieBag[AUTH_COOKIE_NAMES.csrfToken] ?? '';
      const csrfHeader = typeof request.headers['x-csrf-token'] === 'string'
        ? request.headers['x-csrf-token'].trim()
        : '';
      if (!csrfCookie || !csrfHeader || csrfCookie !== csrfHeader) {
        await forbidden(reply, 'Invalid CSRF token');
        return;
      }
    }
    request.auth = principal;
  };

  const requireRole = (minRole: WorkspaceRole): preHandlerHookHandler => {
    return async (request, reply) => {
      const principal = request.auth;
      if (!principal) {
        await unauthorized(reply);
        return;
      }
      if (!roleAtLeast(principal.role, minRole)) {
        await forbidden(reply, `${minRole} role required`);
        return;
      }
    };
  };

  const ensureProjectAccess = async (
    request: FastifyRequest,
    reply: FastifyReply,
    projectId: string,
    options: EnsureProjectAccessOptions = {},
  ): Promise<ProjectRecord | null> => {
    const principal = request.auth;
    if (!principal) {
      await unauthorized(reply);
      return null;
    }
    const project = await projectStore.get(projectId);
    if (!project) {
      await reply.status(404).send({ error: 'Project not found' });
      return null;
    }

    let ownership = getOwnership(project);
    if (!ownership && (options.allowLegacyClaim ?? true) && roleAtLeast(principal.role, 'admin')) {
      const claimed = await projectStore.update(project.id, (current) => {
        const next = current as ProjectRecord & { ownership?: ProjectOwnership };
        if (!next.ownership) {
          next.ownership = {
            workspaceId: principal.workspaceId,
            ownerUserId: principal.userId,
            createdByUserId: principal.userId,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          };
        }
      }, {
        phase: 'auth:legacy-ownership-claim',
        caller: 'security:auth',
        reason: `attach ownership for workspace ${principal.workspaceId}`,
      });
      ownership = claimed ? getOwnership(claimed) : null;
    }

    if (!ownership) {
      await forbidden(reply, 'Project ownership is not initialized');
      return null;
    }
    if (ownership.workspaceId !== principal.workspaceId) {
      await forbidden(reply, 'Project belongs to a different workspace');
      return null;
    }

    const minRole = options.minRole ?? 'viewer';
    if (!roleAtLeast(effectiveRole(principal, project), minRole)) {
      await forbidden(reply, `${minRole} role required for this project`);
      return null;
    }
    request.project = project;
    return project;
  };

  const requireProjectAccess = (
    minRole: WorkspaceRole = 'viewer',
    idParam = 'id',
  ): preHandlerHookHandler => {
    return async (request, reply) => {
      const params = request.params as Record<string, string>;
      const id = params[idParam];
      if (!id) {
        await reply.status(400).send({ error: 'Missing project id' });
        return;
      }
      await ensureProjectAccess(request, reply, id, { minRole });
    };
  };

  const canAccessProject = (
    principal: AuthPrincipal,
    project: Pick<ProjectRecord, 'ownership'>,
  ): boolean => {
    const ownership = project.ownership && project.ownership.workspaceId && project.ownership.ownerUserId && project.ownership.createdByUserId && project.ownership.createdAt
      ? {
        workspaceId: project.ownership.workspaceId,
        ownerUserId: project.ownership.ownerUserId,
        createdByUserId: project.ownership.createdByUserId,
        createdAt: project.ownership.createdAt,
        updatedAt: project.ownership.updatedAt,
      }
      : null;
    return Boolean(ownership && ownership.workspaceId === principal.workspaceId);
  };

  return {
    authenticate,
    requireRole,
    requireProjectAccess,
    ensureProjectAccess,
    canAccessProject,
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthPrincipal;
    project?: ProjectRecord;
  }
}

