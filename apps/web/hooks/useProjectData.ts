'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApiError,
  getPreviewStatus,
  getProject,
  getSessionProgress,
  listProjects,
  openSessionSocket,
  type PreviewStatus,
} from '../lib/api';
import type { GeneratedProject, SessionProgress } from '../types/dashboard';
import { sortProjectsByUpdated } from '../src/features/projects/model';

interface LiveStateBase {
  loading: boolean;
  error: string | null;
  stale: boolean;
  reconnecting: boolean;
  lastUpdatedAt: string | null;
}

interface PollingConfig<T> {
  enabled?: boolean;
  pollMs: number;
  minIntervalMs?: number;
  stopPollingWhen?: (data: T | null) => boolean;
  isEqual?: (previous: T | null, next: T) => boolean;
}

function useLivePolling<T>(
  fetcher: () => Promise<T>,
  config: PollingConfig<T>,
): LiveStateBase & {
  data: T | null;
  refresh: () => Promise<void>;
} {
  const { enabled = true, pollMs, minIntervalMs = 1_000, stopPollingWhen, isEqual } = config;
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState<boolean>(enabled);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const mountedRef = useRef(true);
  const lastRunAtRef = useRef(0);
  const dataRef = useRef<T | null>(null);
  const fetcherRef = useRef(fetcher);
  const stopPollingWhenRef = useRef(stopPollingWhen);
  const isEqualRef = useRef<(previous: T | null, next: T) => boolean>(isEqual ?? ((previous, next) => Object.is(previous, next)));

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    stopPollingWhenRef.current = stopPollingWhen;
  }, [stopPollingWhen]);

  useEffect(() => {
    isEqualRef.current = isEqual ?? ((previous, next) => Object.is(previous, next));
  }, [isEqual]);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const run = useCallback(async (options?: { force?: boolean }) => {
    if (!enabled || inFlightRef.current) return;
    const force = options?.force === true;
    if (!force) {
      const stop = stopPollingWhenRef.current;
      if (stop && stop(dataRef.current)) return;
      const now = Date.now();
      if (now - lastRunAtRef.current < minIntervalMs) return;
      lastRunAtRef.current = now;
    }
    inFlightRef.current = true;
    try {
      const next = await fetcherRef.current();
      if (!mountedRef.current) return;
      setData((previous) => (isEqualRef.current(previous, next) ? previous : next));
      setError(null);
      setStale(false);
      setReconnecting(false);
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      if (!mountedRef.current) return;
      const message = err instanceof Error ? err.message : 'Failed to fetch live data.';
      setError(message);
      if (dataRef.current !== null) {
        setStale(true);
        setReconnecting(true);
      }
    } finally {
      if (mountedRef.current) setLoading(false);
      inFlightRef.current = false;
    }
  }, [enabled, minIntervalMs]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    setLoading(dataRef.current === null);
    void run({ force: true });

    const interval = window.setInterval(() => { void run(); }, pollMs);
    const onFocus = () => { void run({ force: true }); };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void run({ force: true });
    };
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, pollMs, run]);

  return {
    data,
    loading,
    error,
    stale,
    reconnecting,
    lastUpdatedAt,
    refresh: run,
  };
}

export function useProjects() {
  const fetchProjects = useCallback(async () => sortProjectsByUpdated(await listProjects()), []);
  const live = useLivePolling(
    fetchProjects,
    {
      pollMs: 8_000,
      enabled: true,
      isEqual: (previous, next) => deepJsonEqual(previous, next),
    },
  );

  return {
    projects: live.data ?? [],
    loading: live.loading,
    error: live.error,
    stale: live.stale,
    reconnecting: live.reconnecting,
    lastUpdatedAt: live.lastUpdatedAt,
    refresh: live.refresh,
  };
}

export function useProject(projectId: string | null) {
  const fetchProject = useCallback(async () => {
    if (!projectId) return null;
    return await getProject(projectId);
  }, [projectId]);

  const live = useLivePolling(
    fetchProject,
    {
      pollMs: 4_000,
      enabled: Boolean(projectId),
      stopPollingWhen: (project) => isTerminalProject(project),
      isEqual: (previous, next) => deepJsonEqual(previous, next),
    },
  );

  return {
    project: projectId ? (live.data ?? null) : null,
    loading: Boolean(projectId) ? live.loading : false,
    error: live.error,
    stale: Boolean(projectId) ? live.stale : false,
    reconnecting: Boolean(projectId) ? live.reconnecting : false,
    lastUpdatedAt: live.lastUpdatedAt,
    refresh: live.refresh,
  };
}

export function useProjectPreview(projectId: string | null) {
  const fetchPreview = useCallback(async () => {
    if (!projectId) return null;
    return await getPreviewStatus(projectId);
  }, [projectId]);

  const live = useLivePolling(
    fetchPreview,
    {
      pollMs: 2_500,
      enabled: Boolean(projectId),
      stopPollingWhen: (status) => isTerminalPreviewStatus(status),
      isEqual: (previous, next) => deepJsonEqual(previous, next),
    },
  );

  return {
    previewStatus: projectId ? (live.data as PreviewStatus | null) : null,
    loading: Boolean(projectId) ? live.loading : false,
    error: live.error,
    stale: Boolean(projectId) ? live.stale : false,
    reconnecting: Boolean(projectId) ? live.reconnecting : false,
    lastUpdatedAt: live.lastUpdatedAt,
    refresh: live.refresh,
  };
}

type ActivitySource = 'none' | 'websocket' | 'polling';

export function useProjectActivity(projectId: string | null) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [progress, setProgress] = useState<SessionProgress | null>(null);
  const [loading, setLoading] = useState(Boolean(projectId));
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);
  const [reconnecting, setReconnecting] = useState(false);
  const [lastUpdatedAt, setLastUpdatedAt] = useState<string | null>(null);
  const [source, setSource] = useState<ActivitySource>('none');
  const socketRef = useRef<WebSocket | null>(null);
  const progressRef = useRef<SessionProgress | null>(null);
  const sessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  const closeSocket = useCallback(() => {
    const current = socketRef.current;
    if (current) {
      current.onclose = null;
      current.onerror = null;
      current.onmessage = null;
      current.close();
      socketRef.current = null;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!projectId) {
      setSessionId(null);
      setProgress(null);
      setLoading(false);
      setError(null);
      setStale(false);
      setReconnecting(false);
      setSource('none');
      closeSocket();
      return;
    }

    const loadProjectSession = async () => {
      try {
        const project = await getProject(projectId);
        if (cancelled) return;
        const nextSessionId = project?.sessionId ?? null;
        setSessionId((previous) => (previous === nextSessionId ? previous : nextSessionId));
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Unable to load project activity.');
      }
    };

    setLoading(true);
    void loadProjectSession();
    const interval = window.setInterval(() => {
      const hasLiveSession = Boolean(sessionIdRef.current) && !isTerminalSessionProgress(progressRef.current);
      if (hasLiveSession) return;
      void loadProjectSession();
    }, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [closeSocket, projectId]);

  useEffect(() => {
    let cancelled = false;
    closeSocket();
    if (!projectId || !sessionId) {
      setLoading(false);
      return;
    }

    const poll = async () => {
      const current = progressRef.current;
      if (current && current.sessionId === sessionId && isTerminalSessionProgress(current)) return;
      try {
        const next = await getSessionProgress(sessionId);
        if (cancelled) return;
        setProgress((previous) => (deepJsonEqual(previous, next) ? previous : next));
        setError(null);
        setStale(false);
        setReconnecting(false);
        setSource((prev) => (prev === 'websocket' ? prev : 'polling'));
        setLastUpdatedAt(new Date().toISOString());
      } catch (err) {
        if (cancelled) return;
        const apiErr = err as ApiError;
        if (apiErr instanceof ApiError && apiErr.status === 404) {
          setError(null);
          return;
        }
        setError(err instanceof Error ? err.message : 'Unable to refresh session progress.');
        if (progressRef.current) {
          setStale(true);
          setReconnecting(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    const socket = openSessionSocket(
      sessionId,
      (next) => {
        if (cancelled) return;
        setProgress(next);
        setError(null);
        setStale(false);
        setReconnecting(false);
        setSource('websocket');
        setLastUpdatedAt(new Date().toISOString());
      },
      (status) => {
        if (cancelled) return;
        if (status === 'disconnected') {
          setReconnecting(true);
          setSource('polling');
          return;
        }
        setReconnecting(false);
      },
      () => {
        if (cancelled) return;
        setReconnecting(true);
        setSource('polling');
      },
    );
    socketRef.current = socket;

    void poll();
    const poller = window.setInterval(() => { void poll(); }, 5_000);
    return () => {
      cancelled = true;
      window.clearInterval(poller);
      closeSocket();
    };
  }, [closeSocket, projectId, sessionId]);

  const refresh = useCallback(async () => {
    if (!projectId) return;
    try {
      const project = await getProject(projectId);
      const nextSessionId = project?.sessionId ?? null;
      setSessionId((previous) => (previous === nextSessionId ? previous : nextSessionId));
      if (!nextSessionId) {
        setProgress(null);
        setError(null);
        return;
      }
      const nextProgress = await getSessionProgress(nextSessionId);
      setProgress((previous) => (deepJsonEqual(previous, nextProgress) ? previous : nextProgress));
      setError(null);
      setStale(false);
      setReconnecting(false);
      setSource((prev) => (prev === 'websocket' ? prev : 'polling'));
      setLastUpdatedAt(new Date().toISOString());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to refresh session progress.');
    }
  }, [projectId]);

  return {
    sessionId,
    progress,
    loading: Boolean(projectId) ? loading : false,
    error,
    stale,
    reconnecting,
    source,
    lastUpdatedAt,
    refresh,
  };
}

function deepJsonEqual<T>(previous: T | null, next: T | null): boolean {
  if (previous === next) return true;
  if (previous == null || next == null) return previous === next;
  try {
    return JSON.stringify(previous) === JSON.stringify(next);
  } catch {
    return false;
  }
}

function isTerminalSessionProgress(progress: SessionProgress | null): boolean {
  if (!progress) return false;
  return progress.status === 'completed' || progress.status === 'failed' || progress.status === 'cancelled';
}

function isTerminalPreviewStatus(status: PreviewStatus | null): boolean {
  if (!status) return false;
  return status.state === 'ready' || status.state === 'failed';
}

function isTerminalProject(project: GeneratedProject | null): boolean {
  if (!project) return false;
  if (project.status === 'generating') return false;
  if (project.verificationStatus === 'pending' || project.verificationStatus === 'running') return false;
  const previewStatus = project.preview?.previewStatus;
  if (!previewStatus) return true;
  return previewStatus === 'ready' || previewStatus === 'failed';
}

export function mergeLivePreview(
  project: GeneratedProject | null,
  previewStatus: PreviewStatus | null,
): GeneratedProject | null {
  if (!project || !previewStatus) return project;

  const mapState = (value: PreviewStatus['state']) => {
    switch (value) {
      case 'idle':
      case 'preparing':
      case 'installing':
      case 'building':
      case 'starting':
      case 'reachable':
      case 'ready':
      case 'failed':
        return value;
      default:
        return assertNever(value);
    }
  };

  return {
    ...project,
    preview: {
      ...(project.preview ?? {}),
      previewStatus: mapState(previewStatus.state),
      previewHealth: previewStatus.health,
      previewReady: previewStatus.state === 'ready' && previewStatus.health === 'healthy',
      previewUrl: previewStatus.url ?? project.preview?.previewUrl ?? null,
      previewError: previewStatus.error ?? project.preview?.previewError ?? null,
      previewRuntime: previewStatus.mode ?? project.preview?.previewRuntime ?? null,
      previewStartedAt: previewStatus.startedAtIso ?? project.preview?.previewStartedAt ?? null,
      previewReadyAt: previewStatus.readyAtIso ?? project.preview?.previewReadyAt ?? null,
    },
  };
}

function assertNever(value: never): never {
  throw new Error(`Unhandled preview state: ${String(value)}`);
}

export function useSelectedProject(
  projectId: string | null,
  projects: GeneratedProject[],
  project: GeneratedProject | null,
): GeneratedProject | null {
  return useMemo(() => {
    if (!projectId) return null;
    if (project && project.id === projectId) return project;
    return projects.find((item) => item.id === projectId) ?? null;
  }, [project, projectId, projects]);
}
