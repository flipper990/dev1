'use client';

/**
 * React hook that builds frontend-only preview HTML for the given project.
 *
 *   1. Fetches the file list (path + size) via the existing storage endpoint.
 *   2. Fetches each file's contents in parallel (with a hard concurrency cap).
 *   3. Hands the result to `buildPreviewHtml` which always returns a valid
 *      HTML string — even when the project is empty or has no entry point.
 *
 * The hook NEVER throws. On any failure (network, parse, build) it returns
 * `status: 'error'` plus a fallback HTML so the iframe can still render.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getProjectFiles, getProjectFile } from '../lib/api';
import { buildPreviewHtml, type PreviewFile } from '../lib/preview-build';

export type PreviewStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error';

export interface UsePreviewHtml {
  html: string;
  status: PreviewStatus;
  mode: 'index-html' | 'react-synth' | 'fallback' | null;
  note?: string;
  error?: string;
  /** Incrementing counter — use as iframe key to force a fresh render. */
  buildId: number;
  refresh: () => void;
}

const MAX_PARALLEL_FETCHES = 8;
const EXCLUDE_PATTERN = /(?:^|\/)(?:node_modules|\.git|dist|build|coverage)\//i;

async function fetchInBatches<T, R>(
  items: T[],
  batchSize: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(worker));
    out.push(...results);
  }
  return out;
}

export function usePreviewHtml(
  projectId: string | null,
  projectName: string,
  opts: { enabled: boolean },
): UsePreviewHtml {
  const [state, setState] = useState<Omit<UsePreviewHtml, 'refresh'>>({
    html: '',
    status: 'idle',
    mode: null,
    buildId: 0,
  });
  const [tick, setTick] = useState(0);
  const runIdRef = useRef(0);

  useEffect(() => {
    if (!opts.enabled || !projectId) {
      setState((s) => ({ ...s, html: '', status: 'idle', mode: null }));
      return;
    }

    const runId = ++runIdRef.current;
    let cancelled = false;
    setState((s) => ({ ...s, status: 'loading' }));

    (async () => {
      try {
        const entries = await getProjectFiles(projectId);
        if (cancelled || runId !== runIdRef.current) return;

        const wanted = entries.filter((e) => !EXCLUDE_PATTERN.test(e.path));
        if (wanted.length === 0) {
          const result = buildPreviewHtml([], projectName);
          setState((s) => ({
            html: result.html,
            mode: result.mode,
            note: result.note,
            status: 'empty',
            buildId: s.buildId + 1,
            error: undefined,
          }));
          return;
        }

        const files: PreviewFile[] = await fetchInBatches(wanted, MAX_PARALLEL_FETCHES, async (e) => {
          try {
            const file = await getProjectFile(projectId, e.path);
            return { path: file.path, content: file.content };
          } catch {
            return { path: e.path, content: '' };
          }
        });

        if (cancelled || runId !== runIdRef.current) return;

        const nonEmpty = files.filter((f) => f.content.length > 0);
        const built = buildPreviewHtml(nonEmpty, projectName);

        setState((s) => ({
          html: built.html,
          mode: built.mode,
          note: built.note,
          status: nonEmpty.length === 0 ? 'empty' : 'ready',
          buildId: s.buildId + 1,
          error: undefined,
        }));
      } catch (err) {
        if (cancelled || runId !== runIdRef.current) return;
        const msg = err instanceof Error ? err.message : String(err);
        const fallback = buildPreviewHtml([], projectName);
        setState((s) => ({
          html: fallback.html,
          mode: 'fallback',
          status: 'error',
          error: msg,
          buildId: s.buildId + 1,
        }));
      }
    })();

    return () => { cancelled = true; };
  }, [projectId, projectName, opts.enabled, tick]);

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  return { ...state, refresh };
}
