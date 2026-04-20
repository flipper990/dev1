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
  return request<GenerateResponse>('/api/projects/generate', {
    method: 'POST',
    body: JSON.stringify({ prompts: [prompt] }),
  });
}

export async function listProjects(): Promise<GeneratedProject[]> {
  return request<GeneratedProject[]>('/api/projects');
}

export async function getProjectFiles(projectId: string): Promise<ProjectFileEntry[]> {
  return request<ProjectFileEntry[]>(`/api/projects/${projectId}/files`);
}

export async function getProjectFile(projectId: string, filePath: string): Promise<ProjectFileContent> {
  const encoded = filePath.split('/').map(encodeURIComponent).join('/');
  return request<ProjectFileContent>(`/api/projects/${projectId}/files/${encoded}`);
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

  socket.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data as string) as {
        type: 'progress' | 'done' | 'error';
        data?: SessionProgress;
        message?: string;
      };

      if (payload.type === 'progress' && payload.data) {
        onProgress(payload.data);
      } else if (payload.type === 'done' && payload.data) {
        onDone((payload.data as unknown as { status: string }).status);
      } else if (payload.type === 'error') {
        onError(payload.message ?? 'WebSocket error');
      }
    } catch {
      onError('Invalid WebSocket payload');
    }
  };

  socket.onerror = () => onError('WebSocket connection error');

  return socket;
}
