// ─────────────────────────────────────────────────────────────
// Preview runner types
// ─────────────────────────────────────────────────────────────

export type StackKind = 'nextjs' | 'vite-react' | 'plain-react' | 'node-express' | 'fullstack' | 'unknown';

export interface StackInfo {
  kind: StackKind;
  /** Container port the dev server listens on. */
  port: number;
  /** Optional path to GET for health (defaults to '/'). */
  healthPath: string;
  /** Reason / hint surfaced in the UI when kind === 'unknown'. */
  detectionNote: string;
  /** True if package.json exists at root and has a "dev" script. */
  hasDevScript: boolean;
}

export type PreviewState =
  | 'idle'
  | 'detecting'
  | 'preparing'    // staging files, evicting old containers, choosing backend
  | 'installing'   // npm install (local-runner) or image build deps phase
  | 'building'      // docker build (npm install runs inside)
  | 'starting'     // docker run, awaiting health
  | 'ready'
  | 'failed'
  | 'fallback'     // Docker not available — caller should render frontend-only preview
  | 'stopped';

/**
 * Discrete timeline event emitted by the PreviewManager. The set of event
 * names is fixed so downstream UIs / log scrapers can build a deterministic
 * timeline. Pair semantics:
 *   - install-end pairs with install-start (durationMs = end-start)
 *   - build-end   pairs with build-start
 *   - http-probe-ok pairs with devserver-start
 *   - url-published pairs with runner-start (whole-flow duration)
 */
export type PreviewTimelineEventName =
  | 'runner-start'
  | 'install-start'
  | 'install-end'
  | 'build-start'
  | 'build-end'
  | 'devserver-start'
  | 'port-assigned'
  | 'http-probe-ok'
  | 'url-published'
  | 'iframe-ready'
  | 'failed';

export interface PreviewTimelineEvent {
  /** Event name from the fixed vocabulary. */
  event: PreviewTimelineEventName;
  /** ISO timestamp of the event. */
  at: string;
  /** Owning project. */
  projectId: string;
  /** Snapshot of the public preview status at the moment of the event. */
  previewStatus: 'idle' | 'preparing' | 'installing' | 'building' | 'starting' | 'ready' | 'failed';
  /** For "-end" events: ms since the matching "-start". For url-published: ms since runner-start. */
  durationMs?: number;
  /** Free-form structured detail (port, imageTag, error message, etc.). */
  details?: Record<string, unknown>;
  /** Tail of stdout captured during the step (max 2 KB). */
  stdoutTail?: string;
  /** Tail of stderr captured during the step (max 2 KB). */
  stderrTail?: string;
}

export interface PreviewRecord {
  projectId: string;
  state: PreviewState;
  stack: StackInfo | null;
  imageTag: string | null;
  containerId: string | null;
  hostPort: number | null;
  startedAt: number;
  lastAccessedAt: number;
  error: string | null;
  /** Captured build/run stderr — surfaced to UI on failure. */
  log: string;
  /** Fullstack only: docker compose project name (scopes containers/networks/volumes). */
  composeProject?: string | null;
  /** Fullstack only: host port the api service is published on. */
  apiHostPort?: number | null;
  /** Which backend produced this preview — used by stop() to know what to clean up. */
  mode?: 'docker' | 'local';
  /** ISO timestamp when start() was first invoked for this record. */
  startedAtIso?: string;
  /** ISO timestamp the moment state first transitioned to 'ready'. */
  readyAtIso?: string | null;
  /** Free-form description of the most recent lifecycle event (mirrors
   *  ProjectRecord.progress.lastMeaningfulStep semantics). */
  lastMeaningfulStep?: string;
  /** Monotonically increasing list of (stateOrStep, isoTimestamp) tuples
   *  for post-mortem debugging. Trimmed to the last 32 entries. */
  history?: Array<{ step: string; at: string }>;
  /** Discrete timeline events (runner-start, install-start, build-end, …)
   *  used by the dashboard to explain the gap between generation completion
   *  and a visible iframe. Trimmed to the last 64 entries. */
  timeline?: PreviewTimelineEvent[];
}

export interface PreviewStatus {
  projectId: string;
  state: PreviewState;
  stack: StackKind | null;
  url: string | null;
  hostPort: number | null;
  /** Fullstack only: host port the api service is published on. */
  apiHostPort?: number | null;
  error: string | null;
  log: string;
  uptimeMs: number;
  /** True when state === 'fallback' — caller should render frontend-only static preview. */
  fallback?: boolean;
  /** Reason for fallback (e.g. 'docker-unavailable'). */
  fallbackReason?: 'docker-unavailable' | 'boot-failed' | null;
  /** User-facing notice to display in the preview UI. */
  notice?: string;
  /** Which backend served this preview. Absent for stale/idle records. */
  mode?: 'docker' | 'local';
  /** ISO timestamp when start() was first invoked. */
  startedAtIso?: string;
  /** ISO timestamp the moment state transitioned to 'ready' (null until then). */
  readyAtIso?: string | null;
  /** Most recent lifecycle event description. */
  lastMeaningfulStep?: string;
  /** Last 32 lifecycle transitions (oldest → newest). */
  history?: Array<{ step: string; at: string }>;
  /** Last 64 discrete timeline events. */
  timeline?: PreviewTimelineEvent[];
}
