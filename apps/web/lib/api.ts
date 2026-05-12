import type {
  GenerateResponse,
  GeneratedProject,
  PreviewHealthStatus,
  PreviewLifecycleStatus,
  ProjectFileContent,
  ProjectFileEntry,
  SessionProgress,
} from '../types/dashboard';
import { API_BASE, wsBaseFromApiBase } from './api-base';

/** Default per-request timeout. The backend can be slow during a build but anything
 *  over 20 s for a simple GET is almost certainly unreachable. */
const DEFAULT_TIMEOUT_MS = 20_000;

const AUTH_TOKEN_STORAGE_KEYS = [
  'devteam:authToken',
  'devteam.authToken',
  'authToken',
  'accessToken',
  'auth_token',
  'token',
  'jwt',
] as const;

const DEV_AUTH_BYPASS_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS ?? process.env.DEV_AUTH_BYPASS ?? '',
);
const DEV_AUTH_USER_ID =
  process.env.NEXT_PUBLIC_DEV_USER_ID
  ?? process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_USER_ID
  ?? 'dev-user';
const DEV_AUTH_USER_EMAIL =
  process.env.NEXT_PUBLIC_DEV_USER_EMAIL
  ?? process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_USER_EMAIL
  ?? 'dev@local.test';
const DEV_AUTH_WORKSPACE_ID =
  process.env.NEXT_PUBLIC_DEV_WORKSPACE_ID
  ?? process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_WORKSPACE_ID
  ?? 'dev-workspace';
const DEV_AUTH_ROLE =
  process.env.NEXT_PUBLIC_DEV_USER_ROLE
  ?? process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS_ROLE
  ?? 'owner';
const AUTH_TOKEN_COOKIE_NAME = 'devteam_auth_token';

let runtimeAuthToken: string | null = null;

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}

function normalizeToken(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^bearer\s+/i.test(trimmed)) return trimmed.replace(/^bearer\s+/i, '').trim() || null;
  return trimmed;
}

function readStorageToken(storage: Storage | undefined): string | null {
  if (!storage) return null;
  try {
    for (const key of AUTH_TOKEN_STORAGE_KEYS) {
      const token = normalizeToken(storage.getItem(key));
      if (token) return token;
    }
  } catch {
    return null;
  }
  return null;
}

function readAuthToken(): string | null {
  const override = normalizeToken(runtimeAuthToken);
  if (override) return override;

  const envToken = normalizeToken(process.env.NEXT_PUBLIC_AUTH_TOKEN);
  if (envToken) return envToken;

  if (!isBrowser()) return null;
  return readStorageToken(window.localStorage) ?? readStorageToken(window.sessionStorage);
}

function syncAuthCookie(token: string | null): void {
  if (!isBrowser()) return;
  try {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    if (token) {
      document.cookie = `${AUTH_TOKEN_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; SameSite=Lax${secure}`;
      return;
    }
    document.cookie = `${AUTH_TOKEN_COOKIE_NAME}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
  } catch {
    // Best-effort only. Auth still works via Authorization header when present.
  }
}

function applyAuthHeaders(headers: Headers): void {
  if (headers.has('Authorization')) return;
  const token = readAuthToken();
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
    syncAuthCookie(token);
    return;
  }

  syncAuthCookie(null);
  const allowDevHeaders = DEV_AUTH_BYPASS_ENABLED || process.env.NODE_ENV !== 'production';
  if (!allowDevHeaders) return;
  if (!headers.has('x-devteam-user-id')) headers.set('x-devteam-user-id', DEV_AUTH_USER_ID);
  if (!headers.has('x-devteam-user-email')) headers.set('x-devteam-user-email', DEV_AUTH_USER_EMAIL);
  if (!headers.has('x-devteam-workspace-id')) headers.set('x-devteam-workspace-id', DEV_AUTH_WORKSPACE_ID);
  if (!headers.has('x-devteam-role')) headers.set('x-devteam-role', DEV_AUTH_ROLE);
}

function buildRequestHeaders(
  source: HeadersInit | undefined,
  includeJsonHeaders: boolean,
): Headers {
  const headers = new Headers(source ?? {});
  if (includeJsonHeaders) {
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  }
  applyAuthHeaders(headers);
  return headers;
}

async function fetchWithAuth(
  url: string,
  init: RequestInit,
  options?: { includeJsonHeaders?: boolean },
): Promise<Response> {
  const includeJsonHeaders = options?.includeJsonHeaders ?? true;
  const headers = buildRequestHeaders(init.headers, includeJsonHeaders);
  const usesHeaderAuth =
    headers.has('Authorization') ||
    headers.has('x-devteam-user-id') ||
    headers.has('x-devteam-user-email') ||
    headers.has('x-devteam-workspace-id') ||
    headers.has('x-devteam-role');
  return fetch(url, {
    ...init,
    headers,
    cache: init.cache ?? 'no-store',
    credentials: init.credentials ?? (usesHeaderAuth ? 'same-origin' : 'include'),
  });
}

/** Optional runtime injection point for auth/session layers.
 *  When unset, the client falls back to env + storage discovery. */
export function setApiAuthToken(token: string | null): void {
  runtimeAuthToken = normalizeToken(token);
  syncAuthCookie(runtimeAuthToken);
}

/** Sentinel on thrown errors so callers can tell "the backend is down" apart
 *  from "the backend returned 4xx". Callers that want mock-fallback behaviour
 *  check this flag. */
export class ApiError extends Error {
  public readonly kind: 'network' | 'timeout' | 'http' | 'parse';
  public readonly status?: number;
  /** Parsed JSON body of an HTTP-error response, when present. Lets
   *  callers read structured error codes (e.g. `code: 'PROJECT_RECORD_CORRUPT'`)
   *  without re-reading the response. */
  public readonly body?: unknown;
  constructor(message: string, kind: ApiError['kind'], status?: number, body?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
    this.body = body;
  }
  /** True when the backend is unreachable (network down, CORS, DNS, offline). */
  get isUnreachable(): boolean {
    return this.kind === 'network' || this.kind === 'timeout';
  }
}

/**
 * Core request wrapper. Wraps fetch with:
 *   - hard timeout (AbortController)
 *   - branded ApiError (network vs http vs timeout vs parse)
 *   - content-type aware parsing (won't crash on HTML / empty responses)
 *
 * NEVER resolves with undefined. Always either a valid T or throws ApiError.
 */
async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, ...rest } = init ?? {};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchWithAuth(`${API_BASE}${path}`, {
      ...rest,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if ((err as { name?: string })?.name === 'AbortError') {
      throw new ApiError(`Request timed out after ${timeoutMs}ms`, 'timeout');
    }
    // TypeError is the browser's signal for network failure / CORS / DNS
    const msg = err instanceof Error ? err.message : String(err);
    throw new ApiError(`Backend unreachable: ${msg}`, 'network');
  }
  clearTimeout(timer);

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    let body: unknown;
    try {
      const ct = response.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const payload = await response.json() as { message?: string; error?: string } & Record<string, unknown>;
        body = payload;
        detail = payload?.message ?? payload?.error ?? detail;
      } else {
        const text = await response.text();
        if (text && text.length < 500) detail = text;
      }
    } catch {
      /* keep default detail */
    }
    throw new ApiError(detail, 'http', response.status, body);
  }

  // Empty body (204 etc.) → return empty object cast to T; callers expecting
  // a concrete shape must validate. Prevents `await response.json()` from
  // throwing on empty bodies.
  const text = await response.text();
  if (!text) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (err) {
    throw new ApiError(`Invalid JSON from ${path}`, 'parse');
  }
}

export async function generateProject(
  prompt: string,
  preferences?: Record<string, unknown>,
): Promise<GenerateResponse> {
  const result = await request<GenerateProjectResponse>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(preferences ? { prompt, preferences } : { prompt }),
  });
  return {
    projectId: result.project.id,
    sessionId: result.pipeline.sessionId,
    project: result.project,
  } as GenerateResponse;
}

// ─────────────────────────────────────────────────────────────────────────────
//   Normalizers
//   ─────────────
//   Every value coming from the network is treated as untyped. These pure
//   functions convert raw JSON into a fully-populated domain object where
//   every required field has a safe default. That way a backend response
//   missing a field (e.g. legacy row without `tokensUsed`) can never cause a
//   `.toFixed()` / `.length` on undefined in the UI.
// ─────────────────────────────────────────────────────────────────────────────

type Raw = Record<string, unknown>;
type ProjectListResponse = { projects: Raw[] } | Raw[];
type ProjectDetailResponse = Raw | { project: Raw };
type GenerateProjectResponse = { project: GenerateResponse['project']; pipeline: { sessionId: string } };

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function arr<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Normalize a raw project row into a fully-populated GeneratedProject. */
export function normalizeProject(raw: unknown): GeneratedProject {
  const p = (raw ?? {}) as Raw;
  const statusRaw = str(p['projectStatus'] ?? p['status'], 'generating');
  const status: GeneratedProject['status'] =
    statusRaw === 'generated' || statusRaw === 'completed' ? 'generated' :
    statusRaw === 'failed' ? 'failed' :
    'generating';
  const runtimeValidation = (p['runtimeValidation'] && typeof p['runtimeValidation'] === 'object')
    ? (p['runtimeValidation'] as GeneratedProject['runtimeValidation'])
    : undefined;
  const executionValidation = (p['executionValidation'] && typeof p['executionValidation'] === 'object')
    ? (p['executionValidation'] as GeneratedProject['executionValidation'])
    : undefined;
  const preview = (p['preview'] && typeof p['preview'] === 'object')
    ? (p['preview'] as GeneratedProject['preview'])
    : undefined;
  const verificationStatusRaw = str(p['verificationStatus']);
  const verificationStatus: NonNullable<GeneratedProject['verificationStatus']> =
    verificationStatusRaw === 'running' || verificationStatusRaw === 'passed' || verificationStatusRaw === 'failed' || verificationStatusRaw === 'warning'
      ? verificationStatusRaw
      : verificationStatusRaw === 'pending'
        ? 'pending'
        : (() => {
          if (status === 'failed') return 'failed' as const;
          if (runtimeValidation?.status === 'failed' || executionValidation?.status === 'failed') return 'failed' as const;
          if (runtimeValidation?.status === 'warning' || executionValidation?.status === 'warning') return 'warning' as const;
          if (runtimeValidation?.status === 'running' || executionValidation?.status === 'running') return 'running' as const;
          if (runtimeValidation?.status === 'passed' && executionValidation?.status === 'passed') return 'passed' as const;
          return 'pending' as const;
        })();
  const previewHealthStatusRaw = str(p['previewHealthStatus']);
  const previewHealthStatus: NonNullable<GeneratedProject['previewHealthStatus']> =
    previewHealthStatusRaw === 'healthy' || previewHealthStatusRaw === 'placeholder' || previewHealthStatusRaw === 'broken'
      ? previewHealthStatusRaw
      : preview?.previewHealth === 'healthy' || preview?.previewHealth === 'placeholder' || preview?.previewHealth === 'broken'
        ? preview.previewHealth
      : 'unknown';
  const promptLegacy = typeof p['prompt'] === 'string' ? [p['prompt'] as string] : [];
  const normalized = {
    id:             str(p['id'], `unknown-${Date.now()}`),
    sessionId:      str(p['sessionId']),
    name:           str(p['name'], 'Untitled project'),
    status,
    projectStatus:  status,
    verificationStatus,
    previewHealthStatus,
    prompts:        arr<string>(p['prompts']).filter((x) => typeof x === 'string').concat(promptLegacy).slice(0, 32),
    promptHistory:  arr(p['promptHistory']) as GeneratedProject['promptHistory'],
    versions:       arr(p['versions']) as GeneratedProject['versions'],
    totalTokens:    num(p['totalTokens'] ?? p['tokensUsed']),
    totalCostUsd:   num(p['totalCostUsd'] ?? p['costUsd']),
    durationMs:     num(p['durationMs']),
    createdAt:      str(p['createdAt'], new Date().toISOString()),
    completedAt:    typeof p['completedAt'] === 'string' ? p['completedAt'] : undefined,
    preview,
    runtimeValidation,
    executionValidation,
    stackSelectionMode:
      p['stackSelectionMode'] === 'manual' || p['stackSelectionMode'] === 'auto'
        ? (p['stackSelectionMode'] as 'auto' | 'manual')
        : undefined,
    techStack:      (p['techStack'] && typeof p['techStack'] === 'object')
      ? (p['techStack'] as Record<string, string>)
      : undefined,
  } satisfies GeneratedProject;

  return {
    ...normalized,
    ...Object.fromEntries(
      ['projectContract', 'requirementCoverage', 'gateResults', 'warnings', 'fileCount', 'updatedAt']
        .filter((key) => key in p)
        .map((key) => [key, p[key]]),
    ),
  } as GeneratedProject;
}

/** Normalize a raw file-entry row into a fully-populated ProjectFileEntry. */
export function normalizeFileEntry(raw: unknown): ProjectFileEntry {
  const p = (raw ?? {}) as Raw;
  return {
    path: str(p['path']),
    size: num(p['size']),
  };
}

/** Normalize raw file-content into a fully-populated ProjectFileContent. */
export function normalizeFileContent(raw: unknown, fallbackPath = ''): ProjectFileContent {
  const p = (raw ?? {}) as Raw;
  return {
    path:    str(p['path'], fallbackPath),
    content: str(p['content']),
  };
}

export async function listProjects(): Promise<GeneratedProject[]> {
  const result = await request<ProjectListResponse>('/api/projects');
  const raw = Array.isArray(result) ? result : arr<Raw>((result as { projects: Raw[] }).projects);
  return raw.map(normalizeProject).filter((p) => p.id && !p.id.startsWith('unknown-'));
}

export async function checkBackendReachable(): Promise<void> {
  await request<unknown>('/api/projects', { timeoutMs: 5_000 });
}

/**
 * Fetch the authoritative project record for a single id.
 *
 * Bypasses the dashboard's local cache so callers (focus-resync, manual
 * refresh, post-select hydration) can reconcile against the backend's
 * latest state — important for projects that were created/completed
 * outside the UI (e.g. terminal diagnostics) where the cached list may
 * still report a stale FAILED status.
 */
export async function getProject(projectId: string): Promise<GeneratedProject | null> {
  try {
    const raw = await request<ProjectDetailResponse>(`/api/projects/${projectId}`);
    const proj = (raw && typeof raw === 'object' && 'project' in (raw as object))
      ? (raw as { project: Raw }).project
      : (raw as Raw);
    if (!proj) return null;
    const normalized = normalizeProject(proj);
    if (!normalized.id || normalized.id.startsWith('unknown-')) return null;
    return normalized;
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/**
 * Structured outcome variant of {@link getProject}. Distinguishes:
 *   - ok          : record loaded successfully
 *   - not-found   : 404 (project genuinely doesn't exist)
 *   - corrupt     : backend reported PROJECT_RECORD_CORRUPT (project.json
 *                   failed to parse and recovery from .bak failed/was
 *                   unavailable). The preview iframe + cached list row
 *                   may still be usable; callers should NOT discard the
 *                   selection — surface a banner instead.
 *   - transient   : any other failure (network, timeout, 5xx without
 *                   the corrupt code). Caller should retry with backoff.
 */
export type GetProjectDetailOutcome =
  | { kind: 'ok'; project: GeneratedProject }
  | { kind: 'not-found' }
  | { kind: 'corrupt'; projectId: string; recovery: 'unavailable' | 'failed'; message: string }
  | { kind: 'transient'; message: string; status?: number };

export async function getProjectDetail(projectId: string): Promise<GetProjectDetailOutcome> {
  try {
    const raw = await request<Raw | { project: Raw }>(`/api/projects/${projectId}`);
    const proj = (raw && typeof raw === 'object' && 'project' in (raw as object))
      ? (raw as { project: Raw }).project
      : (raw as Raw);
    if (!proj) return { kind: 'not-found' };
    const normalized = normalizeProject(proj);
    if (!normalized.id || normalized.id.startsWith('unknown-')) return { kind: 'not-found' };
    return { kind: 'ok', project: normalized };
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return { kind: 'not-found' };
    if (err instanceof ApiError && err.isUnreachable) {
      return { kind: 'transient', message: 'Backend unreachable' };
    }
    if (err instanceof ApiError) {
      const body = (err.body ?? {}) as { code?: string; recovery?: 'unavailable' | 'failed'; corruption?: boolean };
      if (body?.code === 'PROJECT_RECORD_CORRUPT' || body?.corruption) {
        return {
          kind: 'corrupt',
          projectId,
          recovery: body.recovery ?? 'unavailable',
          message: err.message,
        };
      }
      return { kind: 'transient', message: err.message, status: err.status };
    }
    return { kind: 'transient', message: (err as Error).message };
  }
}

export async function getProjectFiles(projectId: string): Promise<ProjectFileEntry[]> {
  const result = await request<ProjectFileEntry[] | { files: ProjectFileEntry[] }>(`/api/projects/${projectId}/files`);
  const raw = Array.isArray(result) ? result : arr((result as { files: unknown[] }).files);
  return raw.map(normalizeFileEntry).filter((f) => f.path);
}

export async function getProjectFile(projectId: string, filePath: string): Promise<ProjectFileContent> {
  const encodedPath = filePath.split('/').map((segment) => encodeURIComponent(segment)).join('/');
  const raw = await request<Raw>(`/api/projects/${projectId}/files/${encodedPath}`);
  return normalizeFileContent(raw, filePath);
}

export async function updateProject(
  projectId: string,
  prompt: string,
  preferences?: Record<string, unknown>,
): Promise<GenerateResponse> {
  const result = await request<GenerateProjectResponse>(`/api/projects/${projectId}/prompts`, {
    method: 'POST',
    body: JSON.stringify(preferences ? { prompt, preferences } : { prompt }),
  });
  return {
    projectId: result.project.id,
    sessionId: result.pipeline.sessionId,
    project: result.project,
  } as GenerateResponse;
}

export async function getProjectPromptHistory(projectId: string): Promise<import('../types/dashboard').PromptHistoryEntry[]> {
  try {
    const result = await request<{ prompts: import('../types/dashboard').PromptHistoryEntry[] }>(`/api/projects/${projectId}/prompts`);
    return arr(result?.prompts) as import('../types/dashboard').PromptHistoryEntry[];
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

export async function getProjectVersions(projectId: string): Promise<import('../types/dashboard').ProjectVersion[]> {
  try {
    const result = await request<{
      projectId: string;
      currentVersion: number;
      history: Array<{
        version?: number;
        createdAt?: string;
        prompts?: string[];
        diffs?: Array<{ path?: string }>;
      }>;
    }>(`/api/projects/${projectId}/versions`);
    return arr<Record<string, unknown>>(result?.history).map((raw, index) => {
      const version = num(raw['version'], index + 1);
      const prompts = arr<string>(raw['prompts']).filter((value) => typeof value === 'string');
      const diffs = arr<{ path?: string }>(raw['diffs']);
      return {
        id: String(version),
        createdAt: str(raw['createdAt'], new Date().toISOString()),
        promptText: prompts[0] ?? `Version ${version}`,
        summary: prompts.length > 1 ? `${prompts.length} prompts` : undefined,
        fileCount: diffs.length > 0 ? diffs.length : undefined,
      } satisfies import('../types/dashboard').ProjectVersion;
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return [];
    throw err;
  }
}

/* ── Docker preview API ────────────────────────────────────────
 * Companion to apps/api/src/routes/preview-routes.ts. The API
 * builds & runs each project as a real container on demand and
 * reverse-proxies it under /preview/:id/. We treat it as best-
 * effort: if any of these calls fail or Docker is unavailable,
 * the UI falls back to the in-browser srcDoc preview.
 * ───────────────────────────────────────────────────────────── */

export type PreviewState = PreviewLifecycleStatus;

export interface PreviewStatus {
  projectId: string;
  state: PreviewState;
  health: PreviewHealthStatus;
  stack: 'nextjs' | 'vite-react' | 'plain-react' | 'node-express' | 'fullstack' | 'unknown' | null;
  url: string | null;
  hostPort: number | null;
  error: string | null;
  log: string;
  uptimeMs: number;
  /** True when no preview backend is available and UI should render static fallback. */
  fallback?: boolean;
  /** Reason for fallback (e.g. 'docker-unavailable'). */
  fallbackReason?: 'docker-unavailable' | 'boot-failed' | null;
  /** User-facing notice to display in the preview UI. */
  notice?: string;
  /** Which backend served this preview. */
  mode?: 'docker' | 'local' | 'local-fallback' | 'fullstack';
  /** ISO timestamp when start() was first invoked. */
  startedAtIso?: string;
  /** ISO timestamp the moment state transitioned to 'ready' (null until then). */
  readyAtIso?: string | null;
  /** Most recent lifecycle event description. */
  lastMeaningfulStep?: string;
  /** Last 32 lifecycle transitions (oldest \u2192 newest). */
  history?: Array<{ step: string; at: string }>;
}

/**
 * Public absolute URL for the preview iframe.
 *
 * When the container's host port is known we point the iframe directly at
 * `http://localhost:<hostPort>/`. This is critical for Next.js previews:
 * Next emits absolute URLs like `/_next/static/css/app/layout.css`, and the
 * api `/preview/<id>/*` reverse proxy can't rewrite them — so going through
 * the proxy results in 404s for every CSS/JS asset (page renders unstyled).
 * Loading directly from the host port lets those absolute paths resolve to
 * the same origin the HTML came from. Falls back to the proxied path if no
 * port is provided (backward-compatible callers).
 */
export function previewIframeUrl(projectId: string, hostPort?: number | null): string {
  if (typeof hostPort === 'number' && hostPort > 0) {
    // Use the same hostname the dashboard is loaded from — usually
    // localhost, but works when the dev API is bound to a LAN IP.
    const host = typeof window !== 'undefined' && window.location.hostname
      ? window.location.hostname
      : 'localhost';
    return `http://${host}:${hostPort}/`;
  }
  return `${API_BASE}/preview/${projectId}/`;
}

export async function getPreviewHealth(): Promise<{ docker: boolean; local: boolean; any: boolean }> {
  try {
    // Server returns { dockerAvailable, localAvailable, anyAvailable, running } — normalise
    // to a stable shape for the UI.
    const raw = await request<{
      dockerAvailable?: boolean; docker?: boolean;
      localAvailable?: boolean; local?: boolean;
      anyAvailable?: boolean;
    }>('/api/preview/health', { timeoutMs: 4_000 });
    const docker = !!(raw.dockerAvailable ?? raw.docker);
    const local = !!(raw.localAvailable ?? raw.local);
    return { docker, local, any: !!(raw.anyAvailable ?? (docker || local)) };
  } catch {
    return { docker: false, local: false, any: false };
  }
}

export async function getPreviewStatus(projectId: string): Promise<PreviewStatus> {
  return request<PreviewStatus>(`/api/projects/${projectId}/preview/status`, { timeoutMs: 6_000 });
}

/**
 * Kick off a build+run cycle. The backend blocks until the dev server reports
 * healthy, which on a cold cache can take 60-180 s. We use a generous timeout
 * but the caller should still show progress UI to the user.
 */
export async function startPreview(projectId: string): Promise<PreviewStatus> {
  return request<PreviewStatus>(`/api/projects/${projectId}/preview/start`, {
    method: 'POST',
    body: '{}',
    timeoutMs: 240_000,
  });
}

/**
 * Notify the API that the preview iframe successfully fired `onLoad` —
 * closes the timeline loop so the dashboard can show true wall-clock from
 * runner-start to a visible UI in the browser. Best-effort, fire-and-forget.
 */
export async function reportIframeReady(
  projectId: string,
  details: { url?: string; viewport?: string; loadDurationMs?: number },
): Promise<void> {
  try {
    await request<void>(`/api/projects/${projectId}/preview/iframe-ready`, {
      method: 'POST',
      body: JSON.stringify(details),
      timeoutMs: 4_000,
    });
  } catch {
    // Non-fatal: timeline event is purely diagnostic.
  }
}

export async function stopPreview(projectId: string): Promise<{ stopped: boolean }> {
  return request<{ stopped: boolean }>(`/api/projects/${projectId}/preview/stop`, {
    method: 'POST',
    body: '{}',
    timeoutMs: 15_000,
  });
}

/**
 * Trigger a ZIP export download for the given project.
 * Export reflects generated source availability, not production-readiness.
 */
export async function exportProject(projectId: string, projectName?: string): Promise<void> {
  const url = `${API_BASE}/api/projects/${projectId}/export`;
  const response = await fetchWithAuth(
    url,
    { method: 'GET' },
    { includeJsonHeaders: false },
  );
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json() as { error?: string };
      detail = payload?.error ?? detail;
    } catch { /* keep default */ }
    throw new Error(detail);
  }

  // Stream the blob into a browser download
  const blob = await response.blob();
  const anchor = document.createElement('a');
  anchor.href = URL.createObjectURL(blob);
  const safeName = (projectName ?? projectId).replace(/[^a-z0-9-_]/gi, '-').toLowerCase();
  anchor.download = `${safeName}-export.zip`;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(anchor.href);
}

export async function getSessionProgress(sessionId: string): Promise<SessionProgress> {
  return request<SessionProgress>(`/api/sessions/${sessionId}/progress`);
}

export interface ActiveSessionSummary {
  sessionId?: string;
  id?: string;
  status?: string;
  progress?: number;
  currentStep?: unknown;
  durationMs?: number;
}

export async function listActiveSessions(): Promise<ActiveSessionSummary[]> {
  return request<ActiveSessionSummary[]>('/api/sessions/active');
}

export function openSessionSocket(
  sessionId: string,
  onProgress: (progress: SessionProgress) => void,
  onDone: (status: string) => void,
  onError: (message: string) => void,
): WebSocket {
  // Browser WebSocket does not support custom auth headers.
  // We mirror the discovered token into a SameSite cookie so the WS
  // handshake carries session credentials consistently.
  syncAuthCookie(readAuthToken());
  const base = wsBaseFromApiBase(API_BASE);
  const socket = new WebSocket(`${base}/ws/sessions/${sessionId}/progress`);
  let finished = false;
  const finish = (status: string) => {
    if (finished) return;
    finished = true;
    onDone(status);
  };

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data as string) as {
        type: string;
        data?: SessionProgress & { status?: string };
        message?: string;
      };

      if (payload.type === 'progress' && payload.data) {
        onProgress(payload.data);
      } else if (payload.type === 'session.snapshot' && payload.data) {
        // Map pipeline snapshot to a SessionProgress-like shape for display
        onProgress(payload.data);
      } else if ((payload.type === 'done' || payload.type === 'session.completed') && payload.data) {
        finish(payload.data.status ?? 'completed');
      } else if (payload.type === 'session.failed') {
        finish('failed');
      } else if (payload.type === 'error') {
        onError(payload.message ?? 'WebSocket error');
      }
    } catch {
      onError('Invalid WebSocket payload');
    }
  };

  socket.onerror = () => onError('WebSocket connection error');
  // Graceful close handler: if the server closes the socket without an explicit
  // completion message (e.g. network drop or backend restart) surface a
  // terminal state to the UI so it doesn't hang in "generating..." forever.
  socket.onclose = () => {
    if (!finished) finish('disconnected');
  };

  return socket;
}
