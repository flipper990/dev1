import type { FastifyInstance, FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { z } from 'zod';
import { config } from '../config.js';
import type { createAuthGuards, WorkspaceRole } from '../security/auth.js';
import { createAuthToken, getAuthPrincipal, parseCookieHeader } from '../security/auth.js';
import { AUTH_COOKIE_NAMES, AUTH_COOKIE_PATHS } from '../security/auth-cookies.js';
import { type AuthStore, type AuthUser, normalizeEmail } from '../security/auth-store.js';
import { hashOpaqueToken, createOpaqueToken } from '../security/opaque-token.js';
import { hashPassword, verifyPassword } from '../security/password.js';

interface AuthRoutesDeps {
  authStore: AuthStore;
  auth: ReturnType<typeof createAuthGuards>;
}

const PASSWORD_MIN_LENGTH = 10;

const signupSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  email: z.string().email().max(320),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});

const signinSchema = z.object({
  email: z.string().email().max(320),
  password: z.string().min(1).max(128),
});

const forgotPasswordSchema = z.object({
  email: z.string().email().max(320),
});

const resetPasswordSchema = z.object({
  token: z.string().trim().min(16).max(256),
  password: z.string().min(PASSWORD_MIN_LENGTH).max(128),
});

const verifyEmailSchema = z.object({
  token: z.string().trim().min(16).max(256),
});

const resendVerifyEmailSchema = z.object({
  email: z.string().email().max(320),
});

function passwordStrengthError(password: string): string | null {
  const checks: Array<[RegExp, string]> = [
    [/[A-Z]/, 'at least one uppercase letter'],
    [/[a-z]/, 'at least one lowercase letter'],
    [/[0-9]/, 'at least one number'],
    [/[^A-Za-z0-9]/, 'at least one symbol'],
  ];
  const missing = checks.filter(([pattern]) => !pattern.test(password)).map(([, label]) => label);
  if (missing.length === 0) return null;
  return `Password must include ${missing.join(', ')}`;
}

function serializeCookie(name: string, value: string, options: {
  maxAge?: number;
  path?: string;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
}): string {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  parts.push(`Path=${options.path ?? '/'}`);
  if (typeof options.maxAge === 'number') parts.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly) parts.push('HttpOnly');
  if (options.secure) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite ?? 'Lax'}`);
  return parts.join('; ');
}

function setAuthCookies(reply: FastifyReply, payload: {
  accessToken: string;
  refreshToken: string;
  csrfToken: string;
}): void {
  const secure = !config.isDev;
  const cookies = [
    serializeCookie(AUTH_COOKIE_NAMES.accessToken, payload.accessToken, {
      maxAge: config.auth.accessTokenTtlSec,
      path: AUTH_COOKIE_PATHS.accessToken,
      httpOnly: true,
      secure,
      sameSite: 'Lax',
    }),
    // Keep backward compatibility for clients still reading legacy token cookie.
    serializeCookie(AUTH_COOKIE_NAMES.legacyAccessToken, payload.accessToken, {
      maxAge: config.auth.accessTokenTtlSec,
      path: AUTH_COOKIE_PATHS.accessToken,
      httpOnly: true,
      secure,
      sameSite: 'Lax',
    }),
    serializeCookie(AUTH_COOKIE_NAMES.refreshToken, payload.refreshToken, {
      maxAge: config.auth.refreshTokenTtlSec,
      path: AUTH_COOKIE_PATHS.refreshToken,
      httpOnly: true,
      secure,
      sameSite: 'Strict',
    }),
    serializeCookie(AUTH_COOKIE_NAMES.csrfToken, payload.csrfToken, {
      maxAge: config.auth.refreshTokenTtlSec,
      path: AUTH_COOKIE_PATHS.csrfToken,
      httpOnly: false,
      secure,
      sameSite: 'Lax',
    }),
  ];
  reply.header('Set-Cookie', cookies);
}

function clearAuthCookies(reply: FastifyReply): void {
  const secure = !config.isDev;
  const cookies = [
    serializeCookie(AUTH_COOKIE_NAMES.accessToken, '', {
      maxAge: 0,
      path: AUTH_COOKIE_PATHS.accessToken,
      httpOnly: true,
      secure,
      sameSite: 'Lax',
    }),
    serializeCookie(AUTH_COOKIE_NAMES.legacyAccessToken, '', {
      maxAge: 0,
      path: AUTH_COOKIE_PATHS.accessToken,
      httpOnly: true,
      secure,
      sameSite: 'Lax',
    }),
    serializeCookie(AUTH_COOKIE_NAMES.refreshToken, '', {
      maxAge: 0,
      path: AUTH_COOKIE_PATHS.refreshToken,
      httpOnly: true,
      secure,
      sameSite: 'Strict',
    }),
    serializeCookie(AUTH_COOKIE_NAMES.csrfToken, '', {
      maxAge: 0,
      path: AUTH_COOKIE_PATHS.csrfToken,
      httpOnly: false,
      secure,
      sameSite: 'Lax',
    }),
  ];
  reply.header('Set-Cookie', cookies);
}

function getClientIp(request: FastifyRequest): string {
  const forwarded = request.headers['x-forwarded-for'];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  if (typeof raw === 'string' && raw.trim()) {
    const first = raw.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.ip;
}

function getUserAgent(request: FastifyRequest): string | null {
  const value = request.headers['user-agent'];
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

function toWorkspaceRole(user: AuthUser): WorkspaceRole {
  if (user.role === 'admin' && user.workspaceRole !== 'owner') return 'admin';
  return user.workspaceRole;
}

function createAccessToken(user: AuthUser): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const expiresAt = nowSeconds + config.auth.accessTokenTtlSec;
  return createAuthToken({
    sub: user.id,
    workspaceId: user.workspaceId,
    role: toWorkspaceRole(user),
    accountRole: user.role,
    email: user.email,
    type: 'access',
    iat: nowSeconds,
    exp: expiresAt,
  }, config.auth.tokenSecret);
}

function getRefreshTokenCookie(request: FastifyRequest): string | null {
  const cookieBag = parseCookieHeader(
    typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined,
  );
  const raw = cookieBag[AUTH_COOKIE_NAMES.refreshToken];
  if (!raw) return null;
  const normalized = raw.trim();
  return normalized.length > 0 ? normalized : null;
}

function toUserResponse(user: AuthUser) {
  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    role: user.role,
    workspaceId: user.workspaceId,
    workspaceRole: user.workspaceRole,
    emailVerified: user.emailVerified,
    emailVerifiedAt: user.emailVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}

function makeAuthTokensPayload(user: AuthUser, refreshToken: string) {
  return {
    accessToken: createAccessToken(user),
    refreshToken,
    csrfToken: createOpaqueToken(24),
  };
}

function isUniqueViolation(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return code === '23505';
}

class InMemoryRateLimiter {
  private readonly buckets = new Map<string, { count: number; resetAt: number }>();

  allow(key: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const existing = this.buckets.get(key);
    if (!existing || now >= existing.resetAt) {
      this.buckets.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (existing.count >= max) {
      return false;
    }
    existing.count += 1;
    return true;
  }
}

const authRateLimiter = new InMemoryRateLimiter();

function rateLimit(max: number, windowMs: number, keyBuilder: (request: FastifyRequest) => string): preHandlerHookHandler {
  return async (request, reply) => {
    const key = keyBuilder(request);
    if (authRateLimiter.allow(key, max, windowMs)) return;
    await reply.status(429).send({
      error: 'Too Many Requests',
      code: 'AUTH_RATE_LIMIT',
      statusCode: 429,
      retryAfterSeconds: Math.ceil(windowMs / 1000),
    });
  };
}

export function registerAuthRoutes(app: FastifyInstance, deps: AuthRoutesDeps): void {
  const { authStore, auth } = deps;

  app.post('/api/auth/signup', {
    preHandler: [
      rateLimit(10, 60_000, (request) => `signup:${getClientIp(request)}`),
    ],
  }, async (request, reply) => {
    const parsed = signupSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Invalid signup payload',
        code: 'VALIDATION_ERROR',
        details: parsed.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      });
    }
    const payload = parsed.data;
    const passwordIssue = passwordStrengthError(payload.password);
    if (passwordIssue) {
      return reply.status(400).send({ error: passwordIssue, code: 'WEAK_PASSWORD' });
    }

    const normalizedEmail = normalizeEmail(payload.email);
    const passwordHash = await hashPassword(payload.password);
    let user: AuthUser;
    try {
      user = await authStore.createUser({
        fullName: payload.fullName,
        email: normalizedEmail,
        passwordHash,
        role: 'user',
        workspaceRole: 'owner',
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        return reply.status(409).send({ error: 'Email already registered', code: 'EMAIL_EXISTS' });
      }
      throw error;
    }

    const refreshToken = createOpaqueToken();
    const refreshSession = await authStore.createRefreshSession({
      userId: user.id,
      tokenHash: hashOpaqueToken(refreshToken, config.auth.tokenSecret),
      expiresAt: new Date(Date.now() + config.auth.refreshTokenTtlSec * 1000),
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });
    await authStore.touchLastLogin(user.id);

    const verificationToken = createOpaqueToken();
    const verificationExpiresAt = new Date(Date.now() + config.auth.verifyEmailTokenTtlSec * 1000);
    await authStore.createEmailVerificationToken({
      userId: user.id,
      tokenHash: hashOpaqueToken(verificationToken, config.auth.tokenSecret),
      expiresAt: verificationExpiresAt,
    });
    request.log.info({
      event: 'auth:verification-token-issued',
      userId: user.id,
      email: user.email,
      tokenPreview: verificationToken.slice(0, 6),
      expiresAt: verificationExpiresAt.toISOString(),
    }, 'Email verification token issued');

    setAuthCookies(reply, makeAuthTokensPayload(user, refreshToken));
    return reply.status(201).send({
      authenticated: true,
      user: toUserResponse(user),
      session: {
        refreshSessionId: refreshSession.id,
      },
      emailVerification: {
        required: !user.emailVerified,
        delivery: 'log',
        ...(config.isDev ? {
          token: verificationToken,
          expiresAt: verificationExpiresAt.toISOString(),
        } : {}),
      },
    });
  });

  app.post('/api/auth/signin', {
    preHandler: [
      rateLimit(20, 60_000, (request) => {
        const body = (request.body ?? {}) as { email?: string };
        return `signin:${getClientIp(request)}:${normalizeEmail(body.email ?? '')}`;
      }),
    ],
  }, async (request, reply) => {
    const parsed = signinSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid signin payload', code: 'VALIDATION_ERROR' });
    }
    const payload = parsed.data;
    const user = await authStore.findUserByEmail(payload.email);
    if (!user) {
      return reply.status(401).send({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }
    const validPassword = await verifyPassword(payload.password, user.passwordHash);
    if (!validPassword) {
      return reply.status(401).send({ error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }

    const refreshToken = createOpaqueToken();
    const refreshSession = await authStore.createRefreshSession({
      userId: user.id,
      tokenHash: hashOpaqueToken(refreshToken, config.auth.tokenSecret),
      expiresAt: new Date(Date.now() + config.auth.refreshTokenTtlSec * 1000),
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    });
    await authStore.touchLastLogin(user.id);
    const refreshedUser = await authStore.findUserById(user.id);
    if (!refreshedUser) {
      clearAuthCookies(reply);
      return reply.status(500).send({ error: 'Account not found after signin', code: 'AUTH_STATE_ERROR' });
    }

    setAuthCookies(reply, makeAuthTokensPayload(refreshedUser, refreshToken));
    return reply.status(200).send({
      authenticated: true,
      user: toUserResponse(refreshedUser),
      session: { refreshSessionId: refreshSession.id },
    });
  });

  app.post('/api/auth/refresh', {
    preHandler: [
      rateLimit(40, 60_000, (request) => `refresh:${getClientIp(request)}`),
    ],
  }, async (request, reply) => {
    const refreshToken = getRefreshTokenCookie(request);
    if (!refreshToken) {
      clearAuthCookies(reply);
      return reply.status(401).send({ error: 'Refresh token missing', code: 'REFRESH_TOKEN_MISSING' });
    }

    const nextRefreshToken = createOpaqueToken();
    const rotated = await authStore.rotateRefreshSession({
      currentTokenHash: hashOpaqueToken(refreshToken, config.auth.tokenSecret),
      nextTokenHash: hashOpaqueToken(nextRefreshToken, config.auth.tokenSecret),
      nextExpiresAt: new Date(Date.now() + config.auth.refreshTokenTtlSec * 1000),
      ipAddress: getClientIp(request),
      userAgent: getUserAgent(request),
    }).catch((error) => {
      request.log.warn({ error: error instanceof Error ? error.message : String(error) }, 'Refresh rotation failed');
      return null;
    });

    if (!rotated) {
      clearAuthCookies(reply);
      return reply.status(401).send({ error: 'Invalid refresh token', code: 'REFRESH_TOKEN_INVALID' });
    }

    setAuthCookies(reply, makeAuthTokensPayload(rotated.user, nextRefreshToken));
    return reply.status(200).send({
      authenticated: true,
      user: toUserResponse(rotated.user),
    });
  });

  app.post('/api/auth/signout', { preHandler: [auth.requireRole('viewer')] }, async (request, reply) => {
    const refreshToken = getRefreshTokenCookie(request);
    if (refreshToken) {
      await authStore.revokeRefreshSessionByHash(hashOpaqueToken(refreshToken, config.auth.tokenSecret));
    }
    clearAuthCookies(reply);
    return reply.status(200).send({ signedOut: true });
  });

  app.get('/api/auth/session', { preHandler: [auth.requireRole('viewer')] }, async (request, reply) => {
    const principal = getAuthPrincipal(request);
    const user = await authStore.findUserById(principal.userId);
    if (!user) {
      clearAuthCookies(reply);
      return reply.status(401).send({ error: 'Session is invalid', code: 'SESSION_INVALID' });
    }
    return reply.status(200).send({
      authenticated: true,
      user: toUserResponse(user),
      session: {
        expiresAt: principal.tokenExpiresAt
          ? new Date(principal.tokenExpiresAt * 1000).toISOString()
          : null,
      },
    });
  });

  app.get('/api/auth/profile', { preHandler: [auth.requireRole('viewer')] }, async (request, reply) => {
    const principal = getAuthPrincipal(request);
    const user = await authStore.findUserById(principal.userId);
    if (!user) {
      clearAuthCookies(reply);
      return reply.status(401).send({ error: 'Session is invalid', code: 'SESSION_INVALID' });
    }
    return reply.status(200).send({ user: toUserResponse(user) });
  });

  app.post('/api/auth/forgot-password', {
    preHandler: [
      rateLimit(10, 60_000, (request) => {
        const body = (request.body ?? {}) as { email?: string };
        return `forgot:${getClientIp(request)}:${normalizeEmail(body.email ?? '')}`;
      }),
    ],
  }, async (request, reply) => {
    const parsed = forgotPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid forgot-password payload', code: 'VALIDATION_ERROR' });
    }
    const email = normalizeEmail(parsed.data.email);
    const user = await authStore.findUserByEmail(email);
    let token: string | null = null;
    let expiresAt: string | null = null;
    if (user) {
      token = createOpaqueToken();
      const expiration = new Date(Date.now() + config.auth.passwordResetTokenTtlSec * 1000);
      expiresAt = expiration.toISOString();
      await authStore.createPasswordResetToken({
        userId: user.id,
        tokenHash: hashOpaqueToken(token, config.auth.tokenSecret),
        expiresAt: expiration,
      });
      request.log.info({
        event: 'auth:password-reset-token-issued',
        userId: user.id,
        email: user.email,
        tokenPreview: token.slice(0, 6),
        expiresAt,
      }, 'Password reset token issued');
    }
    return reply.status(200).send({
      success: true,
      message: 'If the account exists, a password reset link has been generated.',
      delivery: 'log',
      ...(config.isDev && token ? { token, expiresAt } : {}),
    });
  });

  app.post('/api/auth/reset-password', {
    preHandler: [
      rateLimit(10, 60_000, (request) => `reset:${getClientIp(request)}`),
    ],
  }, async (request, reply) => {
    const parsed = resetPasswordSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid reset payload', code: 'VALIDATION_ERROR' });
    }
    const passwordIssue = passwordStrengthError(parsed.data.password);
    if (passwordIssue) {
      return reply.status(400).send({ error: passwordIssue, code: 'WEAK_PASSWORD' });
    }
    const consumed = await authStore.consumePasswordResetToken(
      hashOpaqueToken(parsed.data.token, config.auth.tokenSecret),
    );
    if (!consumed) {
      return reply.status(400).send({ error: 'Reset token is invalid or expired', code: 'RESET_TOKEN_INVALID' });
    }
    const passwordHash = await hashPassword(parsed.data.password);
    await authStore.markUserPassword(consumed.user.id, passwordHash);
    await authStore.revokeRefreshSessionsForUser(consumed.user.id);
    clearAuthCookies(reply);
    return reply.status(200).send({
      success: true,
      message: 'Password updated successfully. Sign in with your new password.',
    });
  });

  app.post('/api/auth/verify-email/confirm', {
    preHandler: [
      rateLimit(20, 60_000, (request) => `verify:${getClientIp(request)}`),
    ],
  }, async (request, reply) => {
    const parsed = verifyEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid verification payload', code: 'VALIDATION_ERROR' });
    }
    const consumed = await authStore.consumeEmailVerificationToken(
      hashOpaqueToken(parsed.data.token, config.auth.tokenSecret),
    );
    if (!consumed) {
      return reply.status(400).send({ error: 'Verification token is invalid or expired', code: 'VERIFY_TOKEN_INVALID' });
    }
    await authStore.markEmailVerified(consumed.user.id);
    const refreshedUser = await authStore.findUserById(consumed.user.id);
    return reply.status(200).send({
      success: true,
      user: refreshedUser ? toUserResponse(refreshedUser) : toUserResponse(consumed.user),
    });
  });

  app.post('/api/auth/verify-email/resend', {
    preHandler: [
      rateLimit(10, 60_000, (request) => {
        const body = (request.body ?? {}) as { email?: string };
        return `verify-resend:${getClientIp(request)}:${normalizeEmail(body.email ?? '')}`;
      }),
    ],
  }, async (request, reply) => {
    const parsed = resendVerifyEmailSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid resend payload', code: 'VALIDATION_ERROR' });
    }
    const user = await authStore.findUserByEmail(parsed.data.email);
    let token: string | null = null;
    let expiresAt: string | null = null;
    if (user && !user.emailVerified) {
      token = createOpaqueToken();
      const expiration = new Date(Date.now() + config.auth.verifyEmailTokenTtlSec * 1000);
      expiresAt = expiration.toISOString();
      await authStore.createEmailVerificationToken({
        userId: user.id,
        tokenHash: hashOpaqueToken(token, config.auth.tokenSecret),
        expiresAt: expiration,
      });
      request.log.info({
        event: 'auth:verification-token-reissued',
        userId: user.id,
        email: user.email,
        tokenPreview: token.slice(0, 6),
        expiresAt,
      }, 'Email verification token reissued');
    }
    return reply.status(200).send({
      success: true,
      message: 'If the account exists, a verification link has been generated.',
      delivery: 'log',
      ...(config.isDev && token ? { token, expiresAt } : {}),
    });
  });
}
