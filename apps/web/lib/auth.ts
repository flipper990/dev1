import { API_BASE } from './api-base';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface AuthUser {
  id: string;
  email: string;
  fullName: string;
  role: 'user' | 'admin';
  workspaceId: string;
  workspaceRole: 'owner' | 'admin' | 'member' | 'viewer';
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionResponse {
  authenticated: boolean;
  user: AuthUser;
  session?: {
    expiresAt: string | null;
  };
}

export class AuthClientError extends Error {
  status?: number;
  code?: string;
  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.name = 'AuthClientError';
    this.status = status;
    this.code = code;
  }
}

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const target = `${name}=`;
  const parts = document.cookie.split(';');
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed.startsWith(target)) continue;
    const raw = trimmed.slice(target.length);
    if (!raw) return null;
    try {
      return decodeURIComponent(raw);
    } catch {
      return raw;
    }
  }
  return null;
}

function withJsonHeaders(headers: Headers): Headers {
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  return headers;
}

function attachCsrfIfNeeded(headers: Headers, method: string): Headers {
  if (SAFE_METHODS.has(method.toUpperCase())) return headers;
  if (headers.has('x-csrf-token')) return headers;
  const csrf = readCookie('devteam_csrf_token');
  if (csrf) headers.set('x-csrf-token', csrf);
  return headers;
}

async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const method = init?.method ?? 'GET';
  const headers = attachCsrfIfNeeded(withJsonHeaders(new Headers(init?.headers ?? {})), method);
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    method,
    headers,
    credentials: 'include',
    cache: 'no-store',
  });

  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }

  if (!response.ok) {
    const payload = (parsed ?? {}) as { error?: string; message?: string; code?: string };
    const message = payload.error ?? payload.message ?? `Request failed with status ${response.status}`;
    throw new AuthClientError(message, response.status, payload.code);
  }

  return (parsed ?? {}) as T;
}

export async function signUp(input: {
  fullName: string;
  email: string;
  password: string;
}): Promise<SessionResponse & {
  emailVerification?: {
    required: boolean;
    delivery: string;
    token?: string;
    expiresAt?: string;
  };
}> {
  return authRequest('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function signIn(input: {
  email: string;
  password: string;
}): Promise<SessionResponse> {
  return authRequest('/api/auth/signin', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function signOut(): Promise<void> {
  await authRequest<{ signedOut: boolean }>('/api/auth/signout', {
    method: 'POST',
    body: '{}',
  });
}

export async function getSession(): Promise<SessionResponse> {
  return authRequest('/api/auth/session');
}

export async function refreshSession(): Promise<SessionResponse> {
  return authRequest('/api/auth/refresh', {
    method: 'POST',
    body: '{}',
  });
}

export async function getSessionWithRefresh(): Promise<SessionResponse> {
  try {
    return await getSession();
  } catch (error) {
    const authError = error as AuthClientError;
    if (authError?.status !== 401) throw error;
  }
  await refreshSession();
  return getSession();
}

export async function forgotPassword(email: string): Promise<{
  success: boolean;
  message: string;
  delivery: string;
  token?: string;
  expiresAt?: string;
}> {
  return authRequest('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function resetPassword(input: {
  token: string;
  password: string;
}): Promise<{
  success: boolean;
  message: string;
}> {
  return authRequest('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function verifyEmailToken(token: string): Promise<{
  success: boolean;
  user: AuthUser;
}> {
  return authRequest('/api/auth/verify-email/confirm', {
    method: 'POST',
    body: JSON.stringify({ token }),
  });
}

export async function resendVerificationEmail(email: string): Promise<{
  success: boolean;
  message: string;
  delivery: string;
  token?: string;
  expiresAt?: string;
}> {
  return authRequest('/api/auth/verify-email/resend', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

