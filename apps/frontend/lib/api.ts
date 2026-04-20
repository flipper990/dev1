import type { Project, PipelineState } from '../types/index';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';
const WS_BASE = process.env.NEXT_PUBLIC_WS_BASE ?? 'ws://localhost:3001';

// ─── HTTP client ──────────────────────────────────────────────────────────────

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((err as { error?: string }).error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export const api = {
  projects: {
    create: (prompt: string, preferences?: Record<string, unknown>) =>
      request<{ project: Project; pipeline: PipelineState }>('/api/projects', {
        method: 'POST',
        body: JSON.stringify({ prompt, preferences }),
      }),

    list: (limit = 20, offset = 0) =>
      request<{ projects: Project[]; total: number }>(
        `/api/projects?limit=${limit}&offset=${offset}`,
      ),

    get: (id: string) =>
      request<{ project: Project }>(`/api/projects/${id}`),

    delete: (id: string) =>
      request<void>(`/api/projects/${id}`, { method: 'DELETE' }),
  },

  agents: {
    cost: () => request<Record<string, unknown>>('/api/agents/cost'),
    models: () => request<Record<string, unknown>>('/api/agents/models'),
    circuit: () => request<Record<string, unknown>>('/api/agents/circuit'),
  },

  health: () => request<{ status: string; uptime: number; activeSessions: number }>('/health'),
};

// ─── WebSocket ────────────────────────────────────────────────────────────────

export function openSessionSocket(
  sessionId: string,
  onEvent: (type: string, data: unknown) => void,
): () => void {
  const ws = new WebSocket(`${WS_BASE}/ws/session/${sessionId}`);

  ws.onmessage = (e) => {
    try {
      const { type, data } = JSON.parse(e.data as string) as { type: string; data: unknown };
      onEvent(type, data);
    } catch {
      // Ignore malformed messages
    }
  };

  ws.onerror = () => onEvent('error', { message: 'WebSocket error' });

  return () => {
    if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
      ws.close();
    }
  };
}
