import type {
  GenerateResponse,
  GeneratedProject,
  ProjectFileContent,
  ProjectFileEntry,
  SessionProgress,
} from '../types/dashboard';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

/** Default per-request timeout. The backend can be slow during a build but anything
 *  over 20 s for a simple GET is almost certainly unreachable. */
const DEFAULT_TIMEOUT_MS = 20_000;

/** Sentinel on thrown errors so callers can tell "the backend is down" apart
 *  from "the backend returned 4xx". Callers that want mock-fallback behaviour
 *  check this flag. */
export class ApiError extends Error {
  public readonly kind: 'network' | 'timeout' | 'http' | 'parse';
  public readonly status?: number;
  constructor(message: string, kind: ApiError['kind'], status?: number) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = status;
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
    response = await fetch(`${API_BASE}${path}`, {
      ...rest,
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...(rest.headers ?? {}),
      },
      cache: 'no-store',
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
    try {
      const ct = response.headers.get('content-type') ?? '';
      if (ct.includes('application/json')) {
        const payload = await response.json() as { message?: string; error?: string };
        detail = payload?.message ?? payload?.error ?? detail;
      } else {
        const text = await response.text();
        if (text && text.length < 500) detail = text;
      }
    } catch {
      /* keep default detail */
    }
    throw new ApiError(detail, 'http', response.status);
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

export async function generateProject(prompt: string): Promise<GenerateResponse> {
  const result = await request<{ project: GenerateResponse['project']; pipeline: { sessionId: string } }>('/api/projects', {
    method: 'POST',
    body: JSON.stringify({ prompt }),
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
  const statusRaw = str(p['status'], 'generating');
  const status: GeneratedProject['status'] =
    statusRaw === 'completed' ? 'completed' :
    statusRaw === 'failed'    ? 'failed' :
    'generating';
  const promptLegacy = typeof p['prompt'] === 'string' ? [p['prompt'] as string] : [];
  return {
    id:             str(p['id'], `unknown-${Date.now()}`),
    sessionId:      str(p['sessionId']),
    name:           str(p['name'], 'Untitled project'),
    status,
    prompts:        arr<string>(p['prompts']).filter((x) => typeof x === 'string').concat(promptLegacy).slice(0, 32),
    promptHistory:  arr(p['promptHistory']) as GeneratedProject['promptHistory'],
    versions:       arr(p['versions']) as GeneratedProject['versions'],
    totalTokens:    num(p['totalTokens'] ?? p['tokensUsed']),
    totalCostUsd:   num(p['totalCostUsd'] ?? p['costUsd']),
    durationMs:     num(p['durationMs']),
    createdAt:      str(p['createdAt'], new Date().toISOString()),
    completedAt:    typeof p['completedAt'] === 'string' ? p['completedAt'] : undefined,
  };
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
  try {
    const result = await request<{ projects: Raw[] } | Raw[]>('/api/projects');
    const raw = Array.isArray(result) ? result : arr<Raw>((result as { projects: Raw[] }).projects);
    return raw.map(normalizeProject).filter((p) => p.id && !p.id.startsWith('unknown-'));
  } catch (err) {
    // If the backend is unreachable we fall back to an empty list instead of
    // crashing the dashboard. Live-backend consumers already tolerate an
    // empty list (shows the welcome/empty-state), so this is a true no-op
    // from the UI's point of view.
    if (err instanceof ApiError && err.isUnreachable) {
      console.warn('[api] listProjects: backend unreachable, returning empty list');
      return [];
    }
    throw err;
  }
}

export async function getProjectFiles(projectId: string): Promise<ProjectFileEntry[]> {
  try {
    const result = await request<ProjectFileEntry[] | { files: ProjectFileEntry[] }>(`/api/projects/${projectId}/files`);
    const raw = Array.isArray(result) ? result : arr((result as { files: unknown[] }).files);
    return raw.map(normalizeFileEntry).filter((f) => f.path);
  } catch (err) {
    if (err instanceof ApiError && err.isUnreachable) {
      console.warn(`[api] getProjectFiles(${projectId}): backend unreachable, returning empty list`);
      return [];
    }
    throw err;
  }
}

export async function getProjectFile(projectId: string, filePath: string): Promise<ProjectFileContent> {
  const encodedPath = encodeURIComponent(filePath);
  try {
    const raw = await request<Raw>(`/api/projects/${projectId}/file?path=${encodedPath}`);
    return normalizeFileContent(raw, filePath);
  } catch (err) {
    if (err instanceof ApiError && err.isUnreachable) {
      console.warn(`[api] getProjectFile(${projectId},${filePath}): backend unreachable, returning empty content`);
      return { path: filePath, content: '' };
    }
    throw err;
  }
}

export async function updateProject(projectId: string, prompt: string): Promise<GenerateResponse> {
  const result = await request<{ project: GenerateResponse['project']; pipeline: { sessionId: string } }>(`/api/projects/${projectId}/prompts`, {
    method: 'POST',
    body: JSON.stringify({ prompt }),
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
    if (err instanceof ApiError && (err.isUnreachable || err.status === 404)) return [];
    throw err;
  }
}

export async function getProjectVersions(projectId: string): Promise<import('../types/dashboard').ProjectVersion[]> {
  try {
    const result = await request<{ versions: import('../types/dashboard').ProjectVersion[] }>(`/api/projects/${projectId}/versions`);
    return arr(result?.versions) as import('../types/dashboard').ProjectVersion[];
  } catch (err) {
    if (err instanceof ApiError && (err.isUnreachable || err.status === 404)) return [];
    throw err;
  }
}

/**
 * Roll the project back to a previously-snapshotted version.
 * The server takes a pre-restore snapshot first, so the restore is undoable.
 */
export async function restoreProjectVersion(projectId: string, versionId: string): Promise<void> {
  await request<{ project: unknown }>(`/api/projects/${projectId}/versions/${versionId}/restore`, {
    method: 'POST',
  });
}

export async function getContainerInfo(projectId: string): Promise<{ available: boolean; status: string; url: string | null }> {
  try {
    return await request<{ available: boolean; status: string; url: string | null }>(`/api/projects/${projectId}/container`);
  } catch (err) {
    if (err instanceof ApiError && (err.isUnreachable || err.status === 404)) {
      return { available: false, status: 'unavailable', url: null };
    }
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

export type PreviewState = 'idle' | 'detecting' | 'building' | 'starting' | 'ready' | 'failed' | 'stopped';

export interface PreviewStatus {
  projectId: string;
  state: PreviewState;
  stack: 'nextjs' | 'vite-react' | 'plain-react' | 'node-express' | 'unknown' | null;
  url: string | null;
  hostPort: number | null;
  error: string | null;
  log: string;
  uptimeMs: number;
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

export async function getPreviewHealth(): Promise<{ docker: boolean }> {
  try {
    // Server returns { dockerAvailable: boolean, running: [...] } — normalise
    // to a stable shape for the UI.
    const raw = await request<{ dockerAvailable?: boolean; docker?: boolean }>('/api/preview/health', { timeoutMs: 4_000 });
    return { docker: !!(raw.dockerAvailable ?? raw.docker) };
  } catch {
    return { docker: false };
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

export async function stopPreview(projectId: string): Promise<{ stopped: boolean }> {
  return request<{ stopped: boolean }>(`/api/projects/${projectId}/preview/stop`, {
    method: 'POST',
    body: '{}',
    timeoutMs: 15_000,
  });
}

/**
 * Trigger a ZIP export download for the given project.
 * The backend strips all mock/preview-only code; what you get is production-ready.
 */
export async function exportProject(projectId: string, projectName?: string): Promise<void> {
  const url = `${API_BASE}/api/projects/${projectId}/export`;
  const response = await fetch(url, { cache: 'no-store' });
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

export function openSessionSocket(
  sessionId: string,
  onProgress: (progress: SessionProgress) => void,
  onDone: (status: string) => void,
  onError: (message: string) => void,
): WebSocket {
  const base = API_BASE.replace('http://', 'ws://').replace('https://', 'wss://');
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
