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
  | 'building'      // docker build (npm install runs inside)
  | 'starting'     // docker run, awaiting health
  | 'ready'
  | 'failed'
  | 'stopped';

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
}
