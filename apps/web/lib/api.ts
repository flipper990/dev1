import type {
  GenerateResponse,
  GeneratedProject,
  ProjectFileContent,
  ProjectFileEntry,
  SessionProgress,
} from '../types/dashboard';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const payload = await response.json();
      detail = payload?.message ?? payload?.error ?? detail;
    } catch {
      // keep default detail
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
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

export async function listProjects(): Promise<GeneratedProject[]> {
  const result = await request<{ projects: Record<string, unknown>[] } | Record<string, unknown>[]>('/api/projects');
  const raw = Array.isArray(result) ? result : (result as { projects: Record<string, unknown>[] }).projects ?? [];
  return raw.map((p) => ({
    id: p['id'] as string,
    sessionId: (p['sessionId'] ?? '') as string,
    name: p['name'] as string,
    status: (p['status'] === 'completed' ? 'completed' : p['status'] === 'failed' ? 'failed' : 'generating') as GeneratedProject['status'],
    prompts: [p['prompt'] as string],
    totalTokens: (p['tokensUsed'] ?? 0) as number,
    totalCostUsd: (p['costUsd'] ?? 0) as number,
    durationMs: 0,
    createdAt: p['createdAt'] as string,
  }));
}

export async function getProjectFiles(projectId: string): Promise<ProjectFileEntry[]> {
  return request<ProjectFileEntry[]>(`/api/projects/${projectId}/files`);
}

export async function getProjectFile(projectId: string, filePath: string): Promise<ProjectFileContent> {
  const encodedPath = encodeURIComponent(filePath);
  return request<ProjectFileContent>(`/api/projects/${projectId}/file?path=${encodedPath}`);
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
  const result = await request<{ prompts: import('../types/dashboard').PromptHistoryEntry[] }>(`/api/projects/${projectId}/prompts`);
  return result.prompts;
}

export async function getProjectVersions(projectId: string): Promise<import('../types/dashboard').ProjectVersion[]> {
  const result = await request<{ versions: import('../types/dashboard').ProjectVersion[] }>(`/api/projects/${projectId}/versions`);
  return result.versions;
}

export async function getContainerInfo(projectId: string): Promise<{ available: boolean; status: string; url: string | null }> {
  return request<{ available: boolean; status: string; url: string | null }>(`/api/projects/${projectId}/container`);
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
  const socket = new WebSocket(`${base}/ws/session/${sessionId}`);
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
