'use client';

/**
 * Real data hook for the DEVteam dashboard.
 *
 * Owns the live data lifecycle:
 *  - polls /api/projects every 8 s
 *  - opens a websocket on the latest in-flight `generating` project
 *  - derives view-models for AgentFeed / BuildPipeline / TokenDashboard /
 *    AgentProgression / RecentProjects / ChatHistory from real responses
 *
 * Components are 100% data-driven: this hook is the only mock-free source of
 * truth. No static arrays anywhere.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../../lib/store';
import { reconcileProjectStatus } from '../../lib/project-status';
import type { StatusReconciliation } from '../../lib/project-status';
import {
  ApiError,
  generateProject,
  getPreviewHealth,
  getProjectDetail,
  listProjects,
  openSessionSocket,
  updateProject,
} from '../../lib/api';
import type {
  GeneratedProject,
  PipelineStep as ApiPipelineStep,
  SessionProgress,
} from '@devteam/types';
import type {
  Agent,
  AgentRole,
  AgentStatus,
  ChatMessage,
  PipelineState,
  PipelineStep as UiPipelineStep,
  PipelineStepState,
  Project,
  SkillBar,
  TechStackItem,
} from './types';

/* ── helpers ─────────────────────────────────────────────────────────── */

const ROLE_ORDER: AgentRole[] = ['spec', 'build', 'qa', 'polish'];
const ROLE_AVATAR: Record<AgentRole, string> = {
  spec: '📋',
  build: '🔨',
  qa: '🧪',
  polish: '✨',
};
const ROLE_NAME: Record<AgentRole, string> = {
  spec: 'Spec Architect',
  build: 'Builder',
  qa: 'QA Sentinel',
  polish: 'Polish',
};

/** API task `agentRole` is one of: spec, builder, qa, polish, validator. Map to UI roles. */
function apiAgentToUiRole(agent: string): AgentRole | null {
  const a = agent.toLowerCase();
  if (a.startsWith('spec'))    return 'spec';
  if (a.startsWith('build'))   return 'build';
  if (a.startsWith('qa'))      return 'qa';
  if (a.startsWith('polish'))  return 'polish';
  return null;
}

function fmtRelative(iso?: string | null): string {
  if (!iso) return '—';
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return '—';
  const diff = Date.now() - t;
  const sec = Math.round(diff / 1000);
  if (sec < 60)         return `${sec}s ago`;
  const min = Math.round(sec / 60);
  if (min < 60)         return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr  < 24)         return `${hr}h ago`;
  const days = Math.round(hr / 24);
  return `${days}d ago`;
}

function tokensCompact(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/* ── derivations ─────────────────────────────────────────────────────── */

function deriveProjects(list: GeneratedProject[]): Project[] {
  return list.slice(0, 8).map((p) => {
    // Render the RAW backend project.status verbatim. The recent-card
    // and the live preview pane are now allowed to disagree (e.g.
    // BUILD FAILED + PREVIEW READY) — the inconsistency banner
    // surfaces this and the data hook re-hydrates. We never invent
    // success here.
    const status: Project['status'] =
      p.status === 'generating' ? 'building'
      : p.status === 'failed'   ? 'failed'
      :                            'ready';
    const colorDot =
      status === 'failed'   ? '#EF4444' :
      status === 'building' ? '#F59E0B' :
                              '#10B981';
    return {
      id: p.id,
      name: p.name || 'Untitled Project',
      status,
      updatedLabel: fmtRelative(p.completedAt ?? p.createdAt),
      tokens: p.totalTokens ?? 0,
      colorDot,
    };
  });
}

/**
 * Build the 4 agent cards from either:
 *   - a live `SessionProgress` (preferred — has currentStep, attempts)
 *   - or the latest project's `tasks[]` (post-completion)
 */
function deriveAgents(
  progress: SessionProgress | null,
  latest: GeneratedProject | null,
): Agent[] {
  // Map role → API task aggregate
  const taskByRole: Partial<Record<AgentRole, { tokens: number; status: string; attempts: number }>> = {};

  if (latest && Array.isArray((latest as unknown as { tasks?: unknown[] }).tasks)) {
    const tasks = (latest as unknown as { tasks: { agentRole: string; status: string; tokensUsed?: number }[] }).tasks;
    for (const t of tasks) {
      const role = apiAgentToUiRole(t.agentRole);
      if (!role) continue;
      const cur = taskByRole[role] ?? { tokens: 0, status: 'waiting', attempts: 0 };
      cur.tokens += t.tokensUsed ?? 0;
      cur.attempts += 1;
      cur.status = t.status;
      taskByRole[role] = cur;
    }
  }

  const liveAgentRole: AgentRole | null = progress?.currentStep
    ? apiAgentToUiRole(progress.currentStep.agent)
    : null;
  const liveAttempt = progress?.currentStep?.attempt ?? 1;

  // Pre-derive per-step status from live progress.steps[]
  const liveStepByRole: Partial<Record<AgentRole, ApiPipelineStep>> = {};
  if (progress?.steps) {
    for (const s of progress.steps) {
      const role = apiAgentToUiRole(s.agent);
      if (!role) continue;
      // Keep the most recent record per role.
      liveStepByRole[role] = s;
    }
  }

  return ROLE_ORDER.map<Agent>((role) => {
    const liveStep = liveStepByRole[role];
    const taskAgg  = taskByRole[role];
    const isLive   = liveAgentRole === role;

    let status: AgentStatus = 'waiting';
    let progressPct = 0;
    let statusText = 'Awaiting upstream';
    let logs: string[] = [];
    let loopCount: number | undefined;

    if (isLive) {
      status = liveAttempt > 1 ? 'looping' : 'working';
      statusText = progress?.currentStep?.description ?? progress?.currentStep?.name ?? 'Working';
      progressPct = Math.max(8, Math.round((progress?.progress ?? 0) * 100));
      if (liveAttempt > 1) loopCount = liveAttempt;
      logs = [`Attempt #${liveAttempt}`, statusText];
    } else if (liveStep) {
      if (liveStep.status === 'completed') {
        status = 'done'; progressPct = 100; statusText = 'Done';
      } else if (liveStep.status === 'failed') {
        status = 'blocked'; progressPct = 100; statusText = liveStep.error ?? 'Failed';
      } else if (liveStep.status === 'running') {
        status = 'working'; progressPct = 50; statusText = liveStep.name;
      } else {
        status = 'waiting'; statusText = 'Pending';
      }
      logs = [
        `${liveStep.name} — ${liveStep.status}`,
        liveStep.durationMs ? `${liveStep.durationMs}ms` : '',
        liveStep.error ?? '',
      ].filter(Boolean);
    } else if (taskAgg) {
      const s = taskAgg.status;
      if (s === 'completed' || s === 'success') {
        status = 'done'; progressPct = 100; statusText = `Completed · ${tokensCompact(taskAgg.tokens)} tok`;
      } else if (s === 'failed' || s === 'error') {
        status = 'blocked'; progressPct = 100; statusText = 'Failed';
      } else if (s === 'running' || s === 'in_progress') {
        status = 'working'; progressPct = 60; statusText = 'In progress';
      }
      logs = [
        `Tasks: ${taskAgg.attempts}`,
        `Tokens: ${tokensCompact(taskAgg.tokens)}`,
        `Status: ${taskAgg.status}`,
      ];
      if (taskAgg.attempts > 1) loopCount = taskAgg.attempts;
    } else if (latest) {
      // Latest project finished and this role had no tasks recorded — assume skipped.
      if (latest.status === 'completed') {
        status = 'done'; progressPct = 100; statusText = 'Skipped (no work needed)';
      }
    }

    return {
      id: `agent-${role}`,
      role,
      name: ROLE_NAME[role],
      avatar: ROLE_AVATAR[role],
      status,
      statusText,
      progress: progressPct,
      loopCount,
      logs: logs.length > 0 ? logs : ['No activity yet.'],
    };
  });
}

function derivePipeline(
  progress: SessionProgress | null,
  latest: GeneratedProject | null,
  agents: Agent[],
): PipelineState {
  const ROLE_TO_STEP: Record<AgentRole, UiPipelineStep> = {
    spec: 'spec', build: 'build', qa: 'qa', polish: 'polish',
  };
  const stepStateByRole = new Map<UiPipelineStep, PipelineStepState>();
  for (const a of agents) {
    const step = ROLE_TO_STEP[a.role];
    const st: PipelineStepState =
      a.status === 'done'    ? 'completed' :
      a.status === 'blocked' ? 'failed'    :
      a.status === 'working' || a.status === 'looping' ? 'active' :
                               'pending';
    stepStateByRole.set(step, st);
  }
  // Deploy: completed if latest project status is completed and not currently building.
  const deployState: PipelineStepState =
    latest && latest.status === 'completed' && !progress ? 'completed'
    : latest && latest.status === 'failed' ? 'failed'
    : 'pending';

  const builderAgent = agents.find((a) => a.role === 'build');
  const isLooping = !!builderAgent && builderAgent.status === 'looping';
  const loopCount = builderAgent?.loopCount ?? 0;

  const labels: Record<UiPipelineStep, string> = {
    spec: 'Spec', build: 'Build', qa: 'QA', polish: 'Polish', deploy: 'Deploy',
  };
  const steps: PipelineState['steps'] = (['spec', 'build', 'qa', 'polish', 'deploy'] as UiPipelineStep[]).map((s) => ({
    id: s,
    label: labels[s],
    state: s === 'deploy' ? deployState : (stepStateByRole.get(s) ?? 'pending'),
  }));
  return { steps, isLooping, loopCount };
}

function deriveSkills(list: GeneratedProject[]): SkillBar[] {
  // Skill = recent success ratio per role across last 10 projects.
  const recent = list.slice(0, 10);
  const tally: Record<AgentRole, { ok: number; total: number }> = {
    spec:   { ok: 0, total: 0 },
    build:  { ok: 0, total: 0 },
    qa:     { ok: 0, total: 0 },
    polish: { ok: 0, total: 0 },
  };
  for (const p of recent) {
    const tasks = (p as unknown as { tasks?: { agentRole: string; status: string }[] }).tasks ?? [];
    for (const t of tasks) {
      const role = apiAgentToUiRole(t.agentRole);
      if (!role) continue;
      tally[role].total += 1;
      if (t.status === 'completed' || t.status === 'success') tally[role].ok += 1;
    }
  }
  return ROLE_ORDER.map((role) => {
    const { ok, total } = tally[role];
    if (total === 0) return { id: role, label: ROLE_NAME[role].split(' ')[0], value: 0, waiting: true };
    return { id: role, label: ROLE_NAME[role].split(' ')[0], value: Math.round((ok / total) * 100) };
  });
}

function deriveChat(latest: GeneratedProject | null): ChatMessage[] {
  if (!latest) return [];
  const out: ChatMessage[] = [];
  const prompts = (latest.promptHistory ?? []).map((h) => ({ text: h.text, ts: h.createdAt }))
    .concat((latest.prompts ?? []).map((t) => ({ text: t, ts: latest.createdAt })))
    .filter((p, i, arr) => arr.findIndex((x) => x.text === p.text) === i)
    .slice(-6);
  for (const p of prompts) {
    const time = (() => {
      const d = new Date(p.ts);
      return isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—';
    })();
    out.push({
      id: 'u-' + out.length,
      author: 'user',
      authorName: 'You',
      text: p.text,
      timestamp: time,
    });
  }
  // Append per-role agent recap from real tasks.
  const tasks = (latest as unknown as { tasks?: { agentRole: string; status: string; tokensUsed?: number; durationMs?: number }[] }).tasks ?? [];
  const seen = new Set<AgentRole>();
  for (const t of tasks) {
    const role = apiAgentToUiRole(t.agentRole);
    if (!role || seen.has(role)) continue;
    seen.add(role);
    const tokens = tasks.filter((x) => apiAgentToUiRole(x.agentRole) === role).reduce((s, x) => s + (x.tokensUsed ?? 0), 0);
    out.push({
      id: 'a-' + role,
      author: role,
      authorName: ROLE_NAME[role],
      avatar: ROLE_AVATAR[role],
      text:
        t.status === 'completed' ? `Done · ${tokensCompact(tokens)} tokens.`
        : t.status === 'failed'  ? 'Hit a snag — see logs.'
        :                          `Status: ${t.status}.`,
      timestamp: latest.completedAt ? new Date(latest.completedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '—',
    });
  }
  return out;
}

function deriveSparkline(list: GeneratedProject[]): number[] {
  // Tokens per project for the last 16 entries (oldest first → newest last).
  const recent = [...list].slice(0, 16).reverse();
  return recent.map((p) => Math.max(1, p.totalTokens ?? 0));
}

/**
 * Metadata-error state surfaced when GET /api/projects/:id fails. Kept
 * separate from the hard `error` field so the dashboard can keep the
 * preview iframe + cached list row mounted while it retries — a
 * temporary 5xx on the detail endpoint should never tear down a
 * working preview.
 */
export interface MetadataErrorState {
  projectId: string;
  /** 'corrupt' = backend says project.json is corrupt and recovery
   *  failed/unavailable. 'transient' = network/5xx; will retry. */
  kind: 'corrupt' | 'transient';
  recovery?: 'unavailable' | 'failed';
  message: string;
  /** Last attempt timestamp (ms). Used to display "retrying in N s" or
   *  trigger a manual retry. */
  lastAttemptAt: number;
  /** Number of consecutive failed attempts (1 = first failure). */
  attempts: number;
}

// ── Module-level pub/sub so the hook (which is mounted once) can subscribe
// to outcomes published by the module-level hydrateActiveProject helper.
type MetadataListener = (next: MetadataErrorState | null) => void;
const metadataListeners = new Set<MetadataListener>();
function publishMetadataState(next: MetadataErrorState | null): void {
  for (const fn of metadataListeners) fn(next);
}

/**
 * Fetch the authoritative backend record for a project and reconcile it
 * into the Zustand store. Module-level (not a hook) so it can be invoked
 * from event handlers, useEffect bodies, and WS callbacks without
 * dependency-array juggling. Always returns void; logs divergence when
 * the cached entry disagrees with the backend so cross-project /
 * stale-state regressions are visible in the console.
 *
 * Resilience contract:
 *   - 404                     → clear metadata error (project deleted)
 *   - corrupt (PROJECT_RECORD_CORRUPT)
 *                             → publish metadataError(kind=corrupt).
 *                               Do NOT clear selectedProjectId. Cached
 *                               list row + preview iframe stay mounted.
 *   - transient (5xx, network, timeout)
 *                             → publish metadataError(kind=transient).
 *                               Caller's backoff retry will republish
 *                               with attempts++ until success.
 *   - ok                      → clear metadataError; upsertProject.
 *
 * `attemptHint` lets the caller (the backoff retry loop) report which
 * attempt this is so the published state is monotonic.
 */
async function hydrateActiveProject(
  projectId: string | null | undefined,
  attemptHint = 1,
): Promise<'ok' | 'corrupt' | 'transient' | 'not-found' | 'skipped'> {
  if (!projectId || projectId === '__new__') return 'skipped';
  const outcome = await getProjectDetail(projectId);
  if (outcome.kind === 'ok') {
    const fresh = outcome.project;
    const st = useStore.getState();
    const cached = st.projects.find((p) => p.id === projectId) ?? null;
    if (cached && cached.status !== fresh.status) {
      // eslint-disable-next-line no-console
      console.info('[devteam] active record diverged from list cache; preferring backend', {
        projectId,
        cachedStatus: cached.status,
        backendStatus: fresh.status,
      });
    } else {
      // eslint-disable-next-line no-console
      console.info('[devteam] hydrateActiveProject', {
        projectId,
        status: fresh.status,
        previewStatus: fresh.preview?.previewStatus ?? null,
      });
    }
    st.upsertProject(fresh);
    publishMetadataState(null);
    return 'ok';
  }
  if (outcome.kind === 'not-found') {
    // 404 — no metadata error to surface; the list-poll reconciler
    // handles selection rebinding.
    publishMetadataState(null);
    return 'not-found';
  }
  if (outcome.kind === 'corrupt') {
    // eslint-disable-next-line no-console
    console.warn('[devteam] hydrateActiveProject: project record is corrupt', {
      projectId, recovery: outcome.recovery, message: outcome.message,
    });
    publishMetadataState({
      projectId,
      kind: 'corrupt',
      recovery: outcome.recovery,
      message: outcome.message,
      lastAttemptAt: Date.now(),
      attempts: attemptHint,
    });
    return 'corrupt';
  }
  // transient
  // eslint-disable-next-line no-console
  console.warn('[devteam] hydrateActiveProject failed (transient)', {
    projectId, attempt: attemptHint, error: outcome.message, status: outcome.status,
  });
  publishMetadataState({
    projectId,
    kind: 'transient',
    message: outcome.message,
    lastAttemptAt: Date.now(),
    attempts: attemptHint,
  });
  return 'transient';
}

/* ── public hook ─────────────────────────────────────────────────────── */

export interface UseDevteamData {
  projects: Project[];
  rawProjects: GeneratedProject[];
  agents: Agent[];
  pipeline: PipelineState;
  skills: SkillBar[];
  chat: ChatMessage[];
  sparkline: number[];
  totals: { tokens: number; costUsd: number; lifetimeLabel: string; activeCount: number };
  techStack: TechStackItem[];
  isGenerating: boolean;
  isLoading: boolean;
  error: string | null;
  selectedProject: GeneratedProject | null;
  /** Authoritative selection key. Always reflects the user's intent
   *  even when `selectedProject` is briefly null/lagging. Pass this to
   *  any panel whose behaviour must follow selection (preview, code,
   *  logs) so it can re-bind on every change. */
  selectedProjectId: string | null;
  submitPrompt: (text: string, preferences?: Record<string, unknown>) => Promise<void>;
  selectProject: (id: string) => void;
  newProject: () => void;
  refresh: () => Promise<void>;
  /** Fetch the active project's authoritative record and reconcile state. */
  refreshActiveProject: () => Promise<void>;
  /** Diagnostic: refetch the project list, sort newest-first, select the
   *  newest id, and hydrate it. Used to confirm the dashboard is bound
   *  to the project the backend just created. */
  openLatestProject: () => Promise<void>;
  /** Non-fatal project-detail fetch failure for the active project.
   *  When set, the dashboard renders a banner but KEEPS the preview
   *  iframe + cached list row mounted. A backoff retry runs in the
   *  background; success clears this field automatically. */
  metadataError: MetadataErrorState | null;
  /** Force an immediate retry of the project-detail fetch (bypasses
   *  the backoff timer). Bound to the banner's "Retry now" button. */
  retryMetadata: () => Promise<void>;
  /** Reconciliation summary for the currently-selected project: the
   *  raw backend `project.status`, the raw `preview.previewStatus`,
   *  and a derived `consistency` flag (`in_sync` | `conflicting`).
   *  Pills always render the raw values verbatim; the consistency
   *  flag is used ONLY to decide whether to render the small
   *  "status out of sync" banner. */
  statusReconciliation: StatusReconciliation;
}

export function useDevteamData(): UseDevteamData {
  // Subscribe only to the slices we render with — each is a stable reference
  // unless that exact slice changes. Avoids the "select whole store" pitfall
  // that re-renders (and re-creates callbacks) on every unrelated set().
  const list              = useStore((s) => s.projects);
  const selectedProjectId = useStore((s) => s.selectedProjectId);
  const progress          = useStore((s) => s.progress);
  const isGenerating      = useStore((s) => s.isGenerating);

  const socketRef = useRef<WebSocket | null>(null);
  const attachedSessionRef = useRef<string | null>(null);
  // Project id correlated with the currently-attached session, so WS
  // updates can be logged against a stable identity even though the wire
  // payload only carries `sessionId`.
  const attachedProjectIdRef = useRef<string | null>(null);
  // Monotonic poll counter — used to discard out-of-order list responses
  // that could otherwise clobber a fresh `completed` with a stale `failed`.
  const pollSeqRef = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [dockerReady, setDockerReady] = useState<boolean | null>(null);
  const [metadataError, setMetadataError] = useState<MetadataErrorState | null>(null);
  // Mirror metadataError into a ref so non-React callbacks (the
  // listProjects poller, focus/visibility handler) can read the latest
  // value without forcing themselves to recreate on every change.
  const metadataErrorRef = useRef<MetadataErrorState | null>(null);
  useEffect(() => { metadataErrorRef.current = metadataError; }, [metadataError]);

  // Subscribe to metadata-state outcomes published by hydrateActiveProject.
  // Single subscriber for the lifetime of the hook instance; cleanup on
  // unmount lets the next mount take over without leaking.
  useEffect(() => {
    const listener: MetadataListener = (next) => setMetadataError(next);
    metadataListeners.add(listener);
    return () => { metadataListeners.delete(listener); };
  }, []);

  // Backoff retry: when project-detail fetch fails (transient OR corrupt),
  // re-attempt at 2s, 4s, 8s, 16s (capped at 30s). Resets on selection
  // change or success. Keeps `selectedProjectId` untouched throughout —
  // the failure only affects metadata, not preview iframe routing.
  useEffect(() => {
    if (!metadataError) return;
    if (metadataError.projectId !== selectedProjectId) return;
    const delay = Math.min(30_000, 2_000 * Math.pow(2, Math.max(0, metadataError.attempts - 1)));
    // eslint-disable-next-line no-console
    console.info('[devteam] metadata-error retry scheduled', {
      projectId: metadataError.projectId,
      kind: metadataError.kind,
      attempt: metadataError.attempts,
      delayMs: delay,
    });
    const t = setTimeout(() => {
      void hydrateActiveProject(metadataError.projectId, metadataError.attempts + 1);
    }, delay);
    return () => clearTimeout(t);
  }, [metadataError, selectedProjectId]);

  // Clear stale metadata error if the user navigates to a different
  // project (the new selection's hydrate will publish its own state).
  useEffect(() => {
    setMetadataError((prev) => (prev && prev.projectId !== selectedProjectId ? null : prev));
  }, [selectedProjectId]);

  /** Pull project list and store it. Uses getState() so identity is stable. */
  const loadProjects = useCallback(async () => {
    const seq = ++pollSeqRef.current;
    try {
      const data = await listProjects();
      // Drop responses that arrived after a newer poll already returned.
      if (seq < pollSeqRef.current) {
        // eslint-disable-next-line no-console
        console.info('[devteam] dropped stale poll response', { seq, latest: pollSeqRef.current });
        return;
      }
      // Always sort newest-first by createdAt. Identity is by `id` only;
      // duplicate names are allowed (different ids, different rows).
      const sorted = [...data].sort((a, b) => {
        const ta = Date.parse(a.createdAt ?? '') || 0;
        const tb = Date.parse(b.createdAt ?? '') || 0;
        return tb - ta;
      });
      const s = useStore.getState();
      // eslint-disable-next-line no-console
      console.info('[devteam] loadProjects', {
        seq,
        count: sorted.length,
        topId: sorted[0]?.id ?? null,
        topStatus: sorted[0]?.status ?? null,
        topName: sorted[0]?.name ?? null,
        ids: sorted.slice(0, 8).map((p) => ({ id: p.id, status: p.status, name: p.name })),
        selectedProjectId: s.selectedProjectId,
      });
      s.setProjects(sorted);
      setError(null);
      // First-load auto-pick: if nothing is selected (and we're not in
      // "__new__" compose mode), bind to the newest record by id.
      if (!s.selectedProjectId && sorted.length > 0) {
        s.setSelectedProjectId(sorted[0].id);
      }
      // If the selected id no longer exists in the backend list (deleted
      // out-of-band), fall back to the newest. NEVER attempt to match by
      // name — different ids with the same name are different projects.
      // EXCEPT when the project-detail fetch is currently failing for
      // that id: a corrupt project.json can also be skipped by the
      // list endpoint, and the user must not be silently teleported to
      // a different project while the metadata-error banner + backoff
      // retry are still trying to recover.
      if (
        s.selectedProjectId &&
        s.selectedProjectId !== '__new__' &&
        !sorted.some((p) => p.id === s.selectedProjectId)
      ) {
        const stickyForMetadataError =
          metadataErrorRef.current &&
          metadataErrorRef.current.projectId === s.selectedProjectId;
        if (stickyForMetadataError) {
          // eslint-disable-next-line no-console
          console.info('[devteam] keeping selectedProjectId stable through transient metadata error', {
            selectedProjectId: s.selectedProjectId,
            kind: metadataErrorRef.current?.kind,
            attempts: metadataErrorRef.current?.attempts,
          });
        } else {
          // eslint-disable-next-line no-console
          console.warn('[devteam] selected projectId no longer in backend list; rebinding to newest', {
            previousSelected: s.selectedProjectId,
            newestId: sorted[0]?.id ?? null,
          });
          if (sorted[0]) s.setSelectedProjectId(sorted[0].id);
        }
      }
    } catch (e) {
      const msg = e instanceof ApiError && e.isUnreachable
        ? 'Backend offline — retrying…'
        : (e as Error).message;
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Initial load + 8s poll
  useEffect(() => {
    loadProjects();
    const id = setInterval(loadProjects, 8000);
    return () => clearInterval(id);
  }, [loadProjects]);

  // Re-fetch when the dashboard regains focus or visibility — catches
  // projects that were created/completed in another tab or via
  // terminal/API while this tab was backgrounded.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const onWake = () => {
      // eslint-disable-next-line no-console
      console.info('[devteam] focus/visibility resync');
      loadProjects();
      // Also force a fresh detail fetch for the active project so a
      // stale cached `failed` is replaced even before the next poll.
      const sel = useStore.getState().selectedProjectId;
      if (sel && sel !== '__new__') {
        void hydrateActiveProject(sel);
      }
    };
    const onVisibility = () => { if (!document.hidden) onWake(); };
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [loadProjects]);

  // Docker / preview health probe
  useEffect(() => {
    let cancelled = false;
    getPreviewHealth().then(
      (h) => { if (!cancelled) setDockerReady(h.docker); },
      () =>  { if (!cancelled) setDockerReady(false); },
    );
    return () => { cancelled = true; };
  }, []);

  // Auto-attach websocket to in-flight generations.
  // Also reconcile `isGenerating`: the project list is the source of truth.
  // If no project is in 'generating' state, force-clear the flag and tear
  // down any stale socket so the UI doesn't keep saying "Building…" after
  // the agents finished.
  useEffect(() => {
    // Prefer the SELECTED project's in-flight session; only fall back
    // to "any in-flight" if nothing is selected. Without this, two
    // simultaneous generations (e.g. an older same-named project still
    // running while the user selects a newer one) would race for the
    // single global `progress` slot and leak agent state across ids.
    const isInflight = (p: GeneratedProject): boolean =>
      p.status === 'generating' && typeof p.sessionId === 'string' && p.sessionId.length > 0;
    const selectedInflight =
      selectedProjectId && selectedProjectId !== '__new__'
        ? list.find((p) => p.id === selectedProjectId && isInflight(p))
        : undefined;
    const anyInflight = list.find(isInflight);
    const inflight = selectedInflight ?? (selectedProjectId ? undefined : anyInflight);

    // If a different session is currently attached than the one we now
    // want, tear it down before re-attaching. This prevents `progress`
    // updates from a previous selection's session bleeding into the
    // newly-selected project.
    if (
      attachedSessionRef.current &&
      (!inflight || attachedSessionRef.current !== inflight.sessionId)
    ) {
      // eslint-disable-next-line no-console
      console.info('[devteam:ws] detaching (selection changed or finished)', {
        previousSession: attachedSessionRef.current,
        previousProjectId: attachedProjectIdRef.current,
        nextSession: inflight?.sessionId ?? null,
        nextProjectId: inflight?.id ?? null,
      });
      if (socketRef.current && socketRef.current.readyState < 2) {
        socketRef.current.close();
      }
      socketRef.current = null;
      attachedSessionRef.current = null;
      attachedProjectIdRef.current = null;
      // Wipe progress so the UI doesn't render the previous session's
      // last-known agent state under the new selection.
      const st = useStore.getState();
      st.setProgress(null);
      st.setWsConnected(false);
    }

    // No inflight work → clear flags + close any open socket from a prior run.
    if (!inflight) {
      const st = useStore.getState();
      if (st.isGenerating)  st.setIsGenerating(false);
      if (st.wsConnected)   st.setWsConnected(false);
      if (socketRef.current && socketRef.current.readyState < 2) {
        socketRef.current.close();
      }
      socketRef.current = null;
      attachedSessionRef.current = null;
      return;
    }

    if (attachedSessionRef.current === inflight.sessionId) return;
    if (socketRef.current && socketRef.current.readyState < 2) return;

    const s = useStore.getState();
    attachedSessionRef.current = inflight.sessionId!;
    attachedProjectIdRef.current = inflight.id;
    s.setIsGenerating(true);
    // eslint-disable-next-line no-console
    console.info('[devteam:ws] attaching', {
      sessionId: inflight.sessionId,
      projectId: inflight.id,
      status: inflight.status,
    });
    socketRef.current = openSessionSocket(
      inflight.sessionId!,
      (next) => {
        const st = useStore.getState();
        // eslint-disable-next-line no-console
        console.info('[devteam:ws] progress', {
          sessionId: next.sessionId,
          projectId: attachedProjectIdRef.current,
          status: next.status,
          progress: next.progress,
        });
        st.setProgress(next);
        st.setWsConnected(true);
      },
      (status) => {
        const st = useStore.getState();
        // eslint-disable-next-line no-console
        console.info('[devteam:ws] done', {
          sessionId: attachedSessionRef.current,
          projectId: attachedProjectIdRef.current,
          finalStatus: status,
        });
        st.setIsGenerating(false);
        st.setWsConnected(false);
        const finishedProjectId = attachedProjectIdRef.current;
        attachedSessionRef.current = null;
        // Invalidate any cached entries: re-fetch authoritative list. The
        // store's setProjects reconciler discards stale `failed` for ids
        // the backend reports as `completed`/`generating`.
        loadProjects();
        // Hydrate the just-finished project's authoritative record so the
        // active panel switches from `generating` straight to whatever
        // the backend says (completed/failed) without waiting for the
        // next poll.
        if (finishedProjectId) void hydrateActiveProject(finishedProjectId);
        attachedProjectIdRef.current = null;
      },
      (msg) => {
        useStore.getState().pushLog('ws', msg, 'warn');
      },
    );
    return () => {
      // Note: do not close on every render — only on unmount.
    };
  }, [list, loadProjects, selectedProjectId]);

  useEffect(() => () => {
    socketRef.current?.close();
  }, []);

  // ── Submit a prompt. If a finished project is selected, route to update;
  // otherwise create a brand new project.
  const submitPrompt = useCallback(async (text: string, preferences?: Record<string, unknown>) => {
    const t = text.trim();
    if (!t) return;
    const s = useStore.getState();
    const currentId = s.selectedProjectId;
    const currentList = s.projects;
    const target = currentId && currentId !== '__new__'
      ? currentList.find((p) => p.id === currentId)
      : undefined;
    const isUpdate =
      !!target && (target.status === 'completed' || target.status === 'failed');
    // ── Stale-preview reset ──────────────────────────────────
    // For UPDATE flow: the previous generation may have left
    // previewStatus='failed' / previewError set. If we don't wipe
    // these BEFORE flipping to generating, the preview panel will
    // render the old "Preview failed" card while the agents rebuild.
    // For CREATE flow: there's no record yet, so nothing to reset
    // locally — but we still log the intent so the dev console
    // shows a single trail per submission.
    // eslint-disable-next-line no-console
    console.info('[devteam] submitPrompt → reset preview state', {
      mode: isUpdate ? 'update' : 'create',
      selectedProjectId: currentId,
      targetId: target?.id ?? null,
      prevPreviewStatus: target?.preview?.previewStatus ?? null,
      prevPreviewError: target?.preview?.previewError ?? null,
      prevPreviewUrl: target?.preview?.previewUrl ?? null,
    });
    if (isUpdate && target) {
      s.resetPreviewState(target.id);
    }
    s.setIsGenerating(true);
    s.setProgress(null);
    try {
      const result = isUpdate
        ? await updateProject(target!.id, t)
        : await generateProject(t, preferences);
      const st = useStore.getState();
      // IDENTITY-FIRST: bind selection to the EXACT id the backend
      // returned, never to a record matched by name. This is the
      // critical fix for "new project created but dashboard still
      // shows the older failed one with the same name".
      // eslint-disable-next-line no-console
      console.info('[devteam] submit→bind', {
        mode: isUpdate ? 'update' : 'create',
        previousSelected: currentId,
        newProjectId: result.projectId,
        sessionId: result.sessionId,
        name: result.project?.name ?? null,
      });
      // 1. Insert/replace the returned record in the cache by id BEFORE
      //    flipping selection — prevents the UI rendering an empty
      //    "unknown id" frame in the gap between selection and the next
      //    list poll. Reconciler in upsertProject is id-keyed.
      if (result.project) {
        st.upsertProject(result.project as GeneratedProject);
      }
      // 2. Authoritative selection.
      st.setSelectedProjectId(result.projectId);
      st.addToast({
        type: 'info',
        title: isUpdate ? 'Updating project' : 'Building project',
        message: result.project?.name || 'New project',
      });
      // 3. Refresh full list (newest-first sort) and force a backend
      //    detail fetch for the new id so any fields the create response
      //    omitted are filled in.
      await loadProjects();
      void hydrateActiveProject(result.projectId);
    } catch (e) {
      const st = useStore.getState();
      st.setIsGenerating(false);
      st.addToast({
        type: 'error',
        title: isUpdate ? 'Update failed' : 'Build failed',
        message: (e as Error).message,
      });
    }
  }, [loadProjects]);

  const selectProject = useCallback((id: string) => {
    // eslint-disable-next-line no-console
    console.info('[devteam] selectProject', { projectId: id });
    useStore.getState().setSelectedProjectId(id);
    if (id && id !== '__new__') {
      // Hydrate from backend so the active record is authoritative even if
      // the list cache is stale (e.g. project completed via terminal).
      void hydrateActiveProject(id);
    }
  }, []);

  /** Manually refresh ONLY the active project. Bound to a UI button. */
  const refreshActiveProject = useCallback(async () => {
    const sel = useStore.getState().selectedProjectId;
    if (!sel || sel === '__new__') return;
    // eslint-disable-next-line no-console
    console.info('[devteam] refreshActiveProject', { projectId: sel });
    await hydrateActiveProject(sel);
  }, []);

  /** Manually retry the project-detail fetch for the active selection,
   *  bypassing the backoff timer. Used by the metadata-error banner's
   *  "Retry now" affordance so the user can recover faster than the
   *  exponential schedule. */
  const retryMetadata = useCallback(async () => {
    const sel = useStore.getState().selectedProjectId;
    if (!sel || sel === '__new__') return;
    // eslint-disable-next-line no-console
    console.info('[devteam] retryMetadata (manual)', { projectId: sel });
    await hydrateActiveProject(sel, (metadataError?.attempts ?? 0) + 1);
  }, [metadataError]);

  /** Diagnostic: jump to whatever project the backend most recently
   *  created. Bypasses any stale local cache by re-fetching the list,
   *  sorting strictly by createdAt desc, and binding selection to the
   *  top entry by id (never by name). */
  const openLatestProject = useCallback(async () => {
    try {
      const data = await listProjects();
      const sorted = [...data].sort((a, b) => {
        const ta = Date.parse(a.createdAt ?? '') || 0;
        const tb = Date.parse(b.createdAt ?? '') || 0;
        return tb - ta;
      });
      const newest = sorted[0];
      // eslint-disable-next-line no-console
      console.info('[devteam] openLatestProject', {
        previousSelected: useStore.getState().selectedProjectId,
        newestId: newest?.id ?? null,
        newestName: newest?.name ?? null,
        newestStatus: newest?.status ?? null,
        topIds: sorted.slice(0, 5).map((p) => ({ id: p.id, name: p.name, createdAt: p.createdAt })),
      });
      const st = useStore.getState();
      st.setProjects(sorted);
      if (!newest) return;
      // Insert the row first so the active panel renders immediately.
      st.upsertProject(newest);
      st.setSelectedProjectId(newest.id);
      // Hydrate authoritative detail and refresh preview lifecycle.
      await hydrateActiveProject(newest.id);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.warn('[devteam] openLatestProject failed', { error: (e as Error).message });
    }
  }, []);

  const newProject = useCallback(() => {
    const st = useStore.getState();
    st.setSelectedProjectId('__new__');
    st.setProgress(null);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('devteam:new-project'));
    }
  }, []);

  // ── Derived view models. Recomputed on every render but the inputs are
  // shallow-stable references from the store, so this is cheap.
  const selected = useMemo(
    () => {
      if (selectedProjectId === '__new__') return null;
      const match = list.find((p) => p.id === selectedProjectId);
      if (match) return match;
      // No match in the list cache. Two distinct cases:
      //   1. No selection yet → fall back to the newest record.
      //   2. The selection IS set but the row is missing (e.g. record
      //      corruption made list() skip it). Returning list[0] here
      //      would silently render a DIFFERENT project's data under
      //      the user's selection — a cross-project leak. Return null
      //      instead so PreviewStage falls through to its "metadata
      //      unavailable" placeholder while the preview iframe (which
      //      keys off selectedProjectId, not project) keeps running.
      if (!selectedProjectId) return list[0] ?? null;
      return null;
    },
    [list, selectedProjectId],
  );
  // Identity-trace: emitted whenever the resolved active record changes.
  // Keeps preview / agent feed / logs panel synchronised against the same
  // backend record (single source of truth, keyed by projectId only).
  useEffect(() => {
    if (process.env.NODE_ENV === 'production') return;
    // eslint-disable-next-line no-console
    console.info('[devteam] identity', {
      selectedProjectId,
      activePreviewProjectId: selected?.id ?? null,
      recentListTopId: list[0]?.id ?? null,
      recentListTopName: list[0]?.name ?? null,
      activeStatus: selected?.status ?? null,
      previewStatus: selected?.preview?.previewStatus ?? null,
      recentListIds: list.slice(0, 8).map((p) => ({ id: p.id, name: p.name, status: p.status })),
    });
  }, [selectedProjectId, selected, list]);

  // ── Active preview hydration loop ──────────────────────────
  // Once a project transitions to `completed`, the preview lifecycle
  // (install → build → starting → ready/failed) runs ENTIRELY on the
  // backend and is reported on the `preview.previewStatus` field of
  // the persisted ProjectRecord. The 8s list poll and the WS-done
  // single hydrate both miss the window: the list poll is too slow
  // (preview can flip ready in 2s after install completes) and the
  // single WS-done hydrate fires once and stops. Without an active
  // poll the dashboard's selected.preview block stays at whatever
  // value happened to be persisted at the moment of WS done — usually
  // 'starting' / 'building' — and never advances to 'ready'.
  //
  // Fix: when the selected project is `completed` AND its
  // preview.previewStatus is non-terminal (anything except 'ready' /
  // 'failed' / undefined-with-no-prior-start), poll the project
  // detail every 1.5s until a terminal preview state is seen. The
  // PreviewStage component still independently polls the in-memory
  // /preview/status for its own iframe-mount decision; this loop
  // exists specifically to keep the persisted block (which feeds the
  // recent-project cards, debug line, and inconsistency banner) up
  // to date.
  useEffect(() => {
    if (!selected) return;
    if (selected.status !== 'completed') return;
    const previewStatus = selected.preview?.previewStatus ?? null;
    // Terminal states — nothing more to wait for.
    if (previewStatus === 'ready' || previewStatus === 'failed') return;
    // Note: previewStatus may be undefined when no preview has been
    // started; in that case PreviewStage's auto-start effect kicks in
    // and the next persisted snapshot will show 'preparing' / etc.
    // We poll regardless so the first transition is observed quickly.
    const projectId = selected.id;
    let cancelled = false;
    let pollCount = 0;
    const tick = async () => {
      if (cancelled) return;
      pollCount += 1;
      const before = useStore.getState().projects.find((p) => p.id === projectId);
      const beforeStatus = before?.preview?.previewStatus ?? null;
      const beforeUrl = before?.preview?.previewUrl ?? null;
      try {
        const outcome = await getProjectDetail(projectId);
        if (cancelled) return;
        if (outcome.kind === 'ok') {
          const fresh = outcome.project;
          const nextStatus = fresh.preview?.previewStatus ?? null;
          const nextUrl = fresh.preview?.previewUrl ?? null;
          if (process.env.NODE_ENV !== 'production') {
            // eslint-disable-next-line no-console
            console.info('[devteam] preview-hydrate', {
              selectedProjectId: projectId,
              fetchedPreviewStatus: nextStatus,
              fetchedPreviewUrl: nextUrl,
              prevUiPreviewStatus: beforeStatus,
              nextUiPreviewStatus: nextStatus,
              prevUiPreviewUrl: beforeUrl,
              pollCount,
            });
          }
          if (
            beforeStatus !== nextStatus ||
            beforeUrl !== nextUrl ||
            (fresh.preview?.previewError ?? null) !==
              (before?.preview?.previewError ?? null)
          ) {
            useStore.getState().upsertProject(fresh);
          }
        }
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') {
          // eslint-disable-next-line no-console
          console.warn('[devteam] preview-hydrate fetch failed', {
            selectedProjectId: projectId,
            error: (err as Error).message,
          });
        }
      }
    };
    // Fire immediately so the user sees the transition without
    // waiting for the first interval tick.
    void tick();
    const id = setInterval(tick, 1500);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
    // Re-evaluate when the project switches, when its build status
    // flips into `completed`, or when a previous tick advanced
    // previewStatus toward (but not yet into) a terminal state.
  }, [selected?.id, selected?.status, selected?.preview?.previewStatus]);

  // ── Self-heal: project ↔ preview status inconsistency ──────
  // If the cached record for the selected project carries a
  // contradictory pair (project.status === 'failed' but
  // preview.previewStatus === 'ready'), fire an immediate detail
  // re-fetch so the dashboard converges on whichever value the
  // backend most recently persisted. Pills are NOT rewritten in
  // the meantime — they continue to render the raw backend values;
  // only the inconsistency banner is shown until backend confirms
  // or updates one of the two fields. We deliberately NEVER
  // promote `failed` to `completed` here — the UI must not invent
  // success.
  useEffect(() => {
    if (!selected) return;
    const r = reconcileProjectStatus(selected);
    if (r.consistency !== 'conflicting') return;
    // eslint-disable-next-line no-console
    console.warn('[devteam] status inconsistency detected — re-hydrating', {
      projectId: selected.id,
      projectStatus: r.projectStatus,
      previewStatus: r.previewStatus,
      reason: r.reason,
    });
    void hydrateActiveProject(selected.id);
  }, [selected?.id, selected?.status, selected?.preview?.previewStatus]);
  const projects   = useMemo(() => deriveProjects(list),                       [list]);
  const agents     = useMemo(() => deriveAgents(progress, selected),           [progress, selected]);
  const pipeline   = useMemo(() => derivePipeline(progress, selected, agents), [progress, selected, agents]);
  const skills     = useMemo(() => deriveSkills(list),                         [list]);
  const chat       = useMemo(() => deriveChat(selected),                       [selected]);
  const sparkline  = useMemo(() => deriveSparkline(list),                      [list]);

  const totals = useMemo(() => {
    const tokens = list.reduce((s, p) => s + (p.totalTokens ?? 0), 0);
    const costUsd = list.reduce((s, p) => s + (p.totalCostUsd ?? 0), 0);
    const activeCount = list.filter((p) => p.status === 'generating').length;
    const lifetimeLabel =
      tokens >= 1_000_000 ? (tokens / 1_000_000).toFixed(2) + 'M'
      : tokens >= 1_000   ? (tokens / 1_000).toFixed(1) + 'k'
      :                     String(tokens);
    return { tokens, costUsd, lifetimeLabel, activeCount };
  }, [list]);

  const techStack: TechStackItem[] = useMemo(() => {
    const apiOk = error === null && !isLoading;
    return [
      { id: 'next',    name: 'Next.js (Web)',   version: '16.x',  ready: true },
      { id: 'fastify', name: 'Fastify (API)',   version: '4.x',   ready: apiOk },
      { id: 'docker',  name: 'Docker Preview',  version: dockerReady ? 'available' : 'unavailable', ready: !!dockerReady },
      { id: 'codex',   name: 'Azure GPT-5.3-codex', version: 'preview', ready: apiOk },
    ];
  }, [error, isLoading, dockerReady]);

  // Reconciliation snapshot for the selected record. Recomputed only
  // when the two raw status fields change, so re-renders triggered
  // by unrelated slice updates don't churn this object.
  const statusReconciliation = useMemo(
    () => reconcileProjectStatus(selected),
    [selected?.id, selected?.status, selected?.preview?.previewStatus],
  );

  return {
    projects,
    rawProjects: list,
    agents,
    pipeline,
    skills,
    chat,
    sparkline,
    totals,
    techStack,
    isGenerating,
    isLoading,
    error,
    selectedProject: selected,
    selectedProjectId: selectedProjectId === '__new__' ? null : selectedProjectId,
    submitPrompt,
    selectProject,
    newProject,
    refresh: loadProjects,
    refreshActiveProject,
    openLatestProject,
    metadataError,
    retryMetadata,
    statusReconciliation,
  };
}
