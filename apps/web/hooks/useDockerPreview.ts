'use client';

/**
 * Docker preview lifecycle hook.
 *
 * Owns the state machine of a single project's running preview container:
 *
 *   idle ──▶ checking ──▶ unavailable        (Docker not running on host)
 *               │
 *               ▼
 *           starting ──▶ ready  ──▶ stopped  (manual stop / unmount)
 *               │           │
 *               └─▶ failed ◀┘                (build error or boot timeout)
 *
 * Behaviour notes:
 *   • POST /preview/start blocks until the dev server is healthy. We treat
 *     it as "fire-and-forget" plus polling — we kick the request off and
 *     poll /status every 2 s so the UI can show progress (downloading the
 *     base image, installing deps, compiling) instead of a blank spinner.
 *   • If `enabled` flips to false (project deselected, navigation away),
 *     we cancel polling and STOP the container. Containers are not free —
 *     we don't leave them running just because a tab was open earlier.
 *   • Component unmount → same cleanup as enabled=false.
 *   • Refresh = stop + restart (forces fresh build context with any new
 *     source files written since the previous start).
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getPreviewHealth, getPreviewStatus, startPreview, stopPreview,
  previewIframeUrl, ApiError,
  type PreviewStatus,
} from '../lib/api';

export type DockerPreviewPhase =
  | 'idle'         // not enabled yet
  | 'checking'     // probing Docker availability
  | 'unavailable'  // Docker not present — caller should fall back
  | 'starting'     // build+boot in flight
  | 'ready'        // container healthy, iframe URL valid
  | 'failed'       // boot failed
  | 'stopped';     // intentionally stopped (manual / unmount)

/**
 * Public preview state — independent of `project.status`. UI components
 * MUST drive preview-related labels off this enum, not the generation
 * status, so we don't leak "still building" while the preview is live.
 */
export type PreviewState =
  | 'idle'
  | 'preparing'    // checking Docker / waiting for project files
  | 'installing'   // backend reports state='building' (npm install + image build)
  | 'building'     // backend reports state='building' (compile)
  | 'starting'    // dev server launching
  | 'ready'
  | 'failed';

export interface UseDockerPreviewResult {
  phase: DockerPreviewPhase;
  /** Decoupled preview lifecycle state (drives UI labels). */
  previewState: PreviewState;
  /** True the moment the iframe has a non-null `src` it can attempt to load. */
  previewReady: boolean;
  status: PreviewStatus | null;
  url: string | null;
  error: string | null;
  /** Force a clean restart (stop → start). */
  refresh: () => void;
  /** Stop the container without restarting. */
  stop: () => void;
}

const POLL_INTERVAL_MS = 2_000;

export function useDockerPreview(
  projectId: string | null,
  enabled: boolean,
): UseDockerPreviewResult {
  const [phase,  setPhase]  = useState<DockerPreviewPhase>('idle');
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [error,  setError]  = useState<string | null>(null);
  const [bumpKey, setBumpKey] = useState(0);

  // Refs survive re-renders so polling closures see latest values.
  const cancelledRef = useRef(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startInFlightRef = useRef(false);

  const clearPoll = () => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  // Main effect: react to projectId / enabled / refresh-bump changes.
  useEffect(() => {
    cancelledRef.current = false;

    if (!enabled || !projectId) {
      setPhase('idle');
      setStatus(null);
      setError(null);
      return () => { cancelledRef.current = true; clearPoll(); };
    }

    let mounted = true;
    setError(null);
    setPhase('checking');

    (async () => {
      // 1. Is Docker available on the API host at all?
      const health = await getPreviewHealth();
      if (cancelledRef.current || !mounted) return;
      // Either Docker OR the local-runner fallback works — only flip to
      // 'unavailable' if neither is available.
      if (!health.any) {
        setPhase('unavailable');
        return;
      }
      // 2. Kick off start (idempotent — backend short-circuits if already
      //    ready) without awaiting; poll status meanwhile.
      setPhase('starting');
      if (!startInFlightRef.current) {
        startInFlightRef.current = true;
        startPreview(projectId)
          .then(() => { /* status will reflect in polling loop */ })
          .catch((err) => {
            if (cancelledRef.current || !mounted) return;
            // 5xx with a status payload still means we should poll to see
            // the real error. Network failures we surface immediately.
            if (err instanceof ApiError && err.kind === 'http') return;
            setPhase('failed');
            setError(err instanceof Error ? err.message : String(err));
          })
          .finally(() => { startInFlightRef.current = false; });
      }

      // 3. Poll until ready / failed / cancelled.
      const poll = async () => {
        if (cancelledRef.current || !mounted) return;
        try {
          const s = await getPreviewStatus(projectId);
          if (cancelledRef.current || !mounted) return;
          setStatus(s);
          if (s.state === 'ready') {
            setPhase('ready');
            return; // stop polling
          }
          if (s.state === 'fallback') {
            // API reported Docker unavailable mid-flight — switch to
            // frontend-only static preview.
            setPhase('unavailable');
            return;
          }
          if (s.state === 'failed') {
            setPhase('failed');
            setError(s.error ?? 'Preview failed to start');
            return;
          }
          // detecting / building / starting / idle / stopped → keep polling.
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
        } catch (err) {
          if (cancelledRef.current || !mounted) return;
          // Transient network blips during a long build are common — keep
          // polling instead of bailing.
          pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS * 2);
        }
      };
      poll();
    })().catch((err) => {
      if (!mounted) return;
      setPhase('failed');
      setError(err instanceof Error ? err.message : String(err));
    });

    return () => {
      mounted = false;
      cancelledRef.current = true;
      clearPoll();
    };
  }, [projectId, enabled, bumpKey]);

  // Best-effort container cleanup when the user disables / unmounts.
  useEffect(() => {
    return () => {
      if (projectId) {
        // Fire-and-forget — we don't care about the response.
        stopPreview(projectId).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const refresh = useCallback(() => {
    if (!projectId) return;
    setError(null);
    setStatus(null);
    setPhase('starting');
    // Stop first so the next start gets a fresh build context.
    stopPreview(projectId).catch(() => {}).finally(() => {
      setBumpKey((k) => k + 1);
    });
  }, [projectId]);

  const stop = useCallback(() => {
    if (!projectId) return;
    cancelledRef.current = true;
    clearPoll();
    stopPreview(projectId).catch(() => {});
    setPhase('stopped');
  }, [projectId]);

  // The iframe URL is exposed the MOMENT the backend allocates a host port
  // (i.e. while state is still 'starting'). The dev server inside the
  // container often becomes responsive before our 2s poll catches up — we
  // therefore let the iframe attempt to load eagerly. The "Booting…" overlay
  // is cleared by the iframe's onLoad handler in the consumer.
  const url = projectId && status?.hostPort != null
    ? previewIframeUrl(projectId, status.hostPort)
    : null;

  // Derived public preview state — decoupled from project.status.
  const previewState: PreviewState = (() => {
    if (phase === 'ready') return 'ready';
    if (phase === 'failed' || phase === 'unavailable') return 'failed';
    if (phase === 'idle' || phase === 'stopped') return 'idle';
    if (phase === 'checking') return 'preparing';
    // phase === 'starting' — refine using backend status if known.
    const s = status?.state;
    if (s === 'detecting') return 'preparing';
    if (s === 'building')  return 'installing';
    if (s === 'starting')  return 'starting';
    if (s === 'failed')    return 'failed';
    return 'preparing';
  })();

  // Verbose logging on every phase / preview-state / url transition. Keeps
  // a debug trail for the "blank iframe for a minute" class of bugs.
  const lastLogRef = useRef<string>('');
  useEffect(() => {
    const fingerprint = `${phase}|${previewState}|${status?.state ?? 'n/a'}|url=${url ? 'set' : 'null'}|err=${error ? '1' : '0'}`;
    if (fingerprint !== lastLogRef.current) {
      // eslint-disable-next-line no-console
      console.info('[preview]', fingerprint, status?.hostPort ? `port=${status.hostPort}` : '');
      lastLogRef.current = fingerprint;
    }
  }, [phase, previewState, status?.state, status?.hostPort, url, error]);

  return {
    phase,
    previewState,
    previewReady: previewState === 'ready' || (url !== null && previewState !== 'failed'),
    status,
    url,
    error,
    refresh,
    stop,
  };
}
