'use client';

import { Code2, Database, FileText, Loader2, Monitor, Play, RefreshCw, Smartphone, Tablet, Terminal } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { cn } from '../../lib/cn';
import {
  ApiError,
  getProject,
  getProjectFile,
  getProjectFiles,
  getPreviewStatus,
  previewIframeUrl,
  startPreview,
  type PreviewStatus,
} from '../../lib/api';
import { useStore } from '../../lib/store';
import type { GeneratedProject, ProjectFileEntry } from '@devteam/types';
import type { DeviceType, PreviewTab } from './types';
import { ProjectIdChip } from './ProjectIdChip';

const TABS: { id: PreviewTab; label: string; icon: React.ComponentType<{ size?: number }> }[] = [
  { id: 'preview',  label: 'Preview',   icon: Play },
  { id: 'code',     label: 'Code',      icon: Code2 },
  { id: 'api',      label: 'API Docs',  icon: FileText },
  { id: 'database', label: 'Database',  icon: Database },
  { id: 'logs',     label: 'Logs',      icon: Terminal },
];

export interface PreviewStageProps {
  project: GeneratedProject | null;
  /**
   * Authoritative selection key. The preview panel uses THIS as the
   * single source of truth for which project's preview to drive — not
   * `project.id`. They are normally identical, but during the brief
   * window between a `selectProject` call and the list-cache reconciler
   * settling, `project` can momentarily lag. Driving everything off
   * `selectedProjectId` (and re-keying mounts on it) prevents the
   * "preview wakes up for project A while header still says project B"
   * cross-project bug.
   */
  selectedProjectId: string | null;
}

export function PreviewStage({ project, selectedProjectId }: PreviewStageProps) {
  const [tab, setTab] = useState<PreviewTab>('preview');
  const [device, setDevice] = useState<DeviceType>('desktop');

  // If the prop disagrees with the resolved record, prefer the explicit
  // selection key for everything preview-related. The header still uses
  // `project` for name/status pills (already routed through the same id
  // by useDevteamData).
  const effectiveProject =
    selectedProjectId && project && project.id === selectedProjectId ? project : null;

  return (
    <div
      className="flex flex-col flex-1 min-h-0 rounded-xl border bg-[var(--bg-surface)] overflow-hidden"
      style={{ borderColor: 'var(--border-subtle)' }}
    >
      <div
        className="flex items-center justify-between gap-3 px-3 h-11 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <div role="tablist" className="flex items-center gap-0.5 -mb-px">
          {TABS.map((t) => {
            const active = t.id === tab;
            const Icon = t.icon;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                type="button"
                onClick={() => setTab(t.id)}
                className={cn(
                  'flex items-center gap-1.5 h-11 px-3 text-[12.5px] font-medium border-b-2',
                  active
                    ? 'text-[var(--accent-amber)] border-[var(--accent-amber)]'
                    : 'text-[var(--text-secondary)] border-transparent hover:text-[var(--text-primary)]',
                )}
              >
                <Icon size={13} />
                {t.label}
              </button>
            );
          })}
        </div>
        {tab === 'preview' && <DeviceToggle value={device} onChange={setDevice} />}
      </div>

      <div className="flex-1 min-h-0 overflow-auto devteam-scroll">
        {/* Re-key all panes on selectedProjectId so React fully unmounts +
            remounts when the user switches projects. This guarantees no
            cross-project residue (state, timers, iframes, fetches). */}
        {tab === 'preview'  && (
          <PreviewPane
            key={`preview-${selectedProjectId ?? 'none'}`}
            device={device}
            project={effectiveProject}
            selectedProjectId={selectedProjectId}
          />
        )}
        {tab === 'code'     && <CodeViewer key={`code-${selectedProjectId ?? 'none'}`}  project={effectiveProject} />}
        {tab === 'api'      && <ApiDocs    key={`api-${selectedProjectId ?? 'none'}`}    project={effectiveProject} />}
        {tab === 'database' && <DatabaseView key={`db-${selectedProjectId ?? 'none'}`}   project={effectiveProject} />}
        {tab === 'logs'     && <LogConsole  key={`logs-${selectedProjectId ?? 'none'}`}  project={effectiveProject} />}
      </div>
    </div>
  );
}

function DeviceToggle({
  value,
  onChange,
}: {
  value: DeviceType;
  onChange: (v: DeviceType) => void;
}) {
  const opts: { id: DeviceType; icon: React.ComponentType<{ size?: number }> }[] = [
    { id: 'desktop', icon: Monitor    },
    { id: 'tablet',  icon: Tablet     },
    { id: 'mobile',  icon: Smartphone },
  ];
  return (
    <div
      className="flex items-center rounded-md border p-0.5"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
    >
      {opts.map((o) => {
        const Icon = o.icon;
        const active = o.id === value;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-label={o.id}
            className={cn(
              'h-7 w-8 rounded grid place-items-center',
              active
                ? 'bg-[var(--bg-surface)] text-[var(--accent-amber)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]',
            )}
          >
            <Icon size={13} />
          </button>
        );
      })}
    </div>
  );
}

/* ── Preview iframe (real Docker container) ────────────────────────────── */

function PreviewPane({
  device,
  project,
  selectedProjectId,
}: {
  device: DeviceType;
  project: GeneratedProject | null;
  selectedProjectId: string | null;
}) {
  const widths: Record<DeviceType, number> = { desktop: 1100, tablet: 768, mobile: 390 };
  const w = widths[device];
  const [status, setStatus] = useState<PreviewStatus | null>(null);
  const [err, setErr] = useState<string | null>(null);
  // Tracks projectIds we've already auto-started this session so we don't
  // hammer /preview/start on every poll while the container boots.
  const [autoStarted, setAutoStarted] = useState<Set<string>>(() => new Set());

  // SOURCE OF TRUTH for every preview HTTP call below. We deliberately do
  // NOT use `project.id` here — if `selectedProjectId` and `project.id`
  // ever briefly diverge (selection just changed, list cache lagging),
  // we still want to drive preview activity for the user's actual
  // selection, not a stale record.
  const previewProjectId = selectedProjectId ?? null;

  useEffect(() => {
    // Hard reset: any state from the previous project must be discarded
    // before we issue a fetch for the new id.
    setStatus(null);
    setErr(null);
    if (!previewProjectId) return;
    // Identity trace.
    // eslint-disable-next-line no-console
    console.info('[preview-stage] bound to project', {
      selectedProjectId,
      previewProjectId,
      projectRecordId: project?.id ?? null,
      buildStatus: project?.status ?? null,
      previewStatus: project?.preview?.previewStatus ?? null,
    });
    const ac = new AbortController();
    let cancelled = false;
    const tick = async () => {
      try {
        const s = await getPreviewStatus(previewProjectId);
        if (cancelled || ac.signal.aborted) return;
        // Defence-in-depth: if the in-flight response somehow returns
        // for a different id (mismatched server, dev-tools replay,
        // stale closure) drop it on the floor.
        if ((s as { projectId?: string }).projectId &&
            (s as { projectId?: string }).projectId !== previewProjectId) {
          // eslint-disable-next-line no-console
          console.warn('[preview-stage] ignoring cross-project status payload', {
            expected: previewProjectId,
            received: (s as { projectId?: string }).projectId,
          });
          return;
        }
        setStatus(s);
      } catch (e) {
        if (cancelled || ac.signal.aborted) return;
        setErr((e as Error).message);
      }
    };
    void tick();
    const id = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      ac.abort();
      clearInterval(id);
    };
  }, [previewProjectId, project?.id, project?.status, project?.preview?.previewStatus, selectedProjectId]);

  // Auto-start the preview the moment the project is ready and the container
  // isn't already up. No user click required — preview is "always on".
  useEffect(() => {
    if (!previewProjectId || !project || !status) return;
    // Belt-and-braces: refuse to auto-start if the record we're holding
    // doesn't match the selected id.
    if (project.id !== previewProjectId) return;
    if (project.status !== 'completed') return;
    const dockerOk = status.fallbackReason !== 'docker-unavailable';
    if (!dockerOk) return;
    // Never auto-start a preview that already failed — the user needs
    // to see the failure and decide. 'failed' previously sat in this
    // list which produced an infinite restart loop on broken builds.
    const idleStates = ['idle', 'stopped'];
    if (!idleStates.includes(status.state)) return;
    if (autoStarted.has(previewProjectId)) return;

    setAutoStarted((s) => new Set(s).add(previewProjectId));
    startPreview(previewProjectId).then(
      (s) => {
        if (previewProjectId !== selectedProjectId) return; // selection moved on
        setStatus(s);
      },
      (e) => {
        if (previewProjectId !== selectedProjectId) return;
        setErr((e as Error).message);
      },
    );
  }, [previewProjectId, project, status, autoStarted, selectedProjectId]);

  if (!project) {
    return (
      <div className="h-full grid place-items-center p-6">
        <div
          className="rounded-xl border h-full w-full max-h-[640px] grid place-items-center text-center"
          style={{
            maxWidth: w,
            borderColor: 'var(--border-subtle)',
            background: 'radial-gradient(ellipse at top, rgba(245,158,11,0.06), transparent 60%), var(--bg-elevated)',
          }}
        >
          <div className="px-6 max-w-md">
            <div
              className="mx-auto mb-4 h-14 w-14 rounded-2xl grid place-items-center"
              style={{ background: 'linear-gradient(135deg,#F59E0B,#3B82F6)', color: 'var(--bg-void)' }}
            >
              <Play size={22} />
            </div>
            <div className="text-[15px] font-semibold text-[var(--text-primary)]">
              No project selected
            </div>
            <div className="text-[12.5px] text-[var(--text-secondary)] mt-1.5">
              Pick a project on the right or describe a new one in the prompt to start a live build.
            </div>
          </div>
        </div>
      </div>
    );
  }

  // URL is derived strictly from the SELECTED id, not the (possibly
  // stale) project record id. hostPort comes from `status` which the
  // effect above has already validated against `previewProjectId`.
  const url = previewIframeUrl(previewProjectId!, status?.hostPort ?? null);
  const state = status?.state ?? 'idle';
  const running = state === 'ready' || state === 'fallback';
  const docker  = status?.fallbackReason !== 'docker-unavailable';
  // STRICT loading gate: the wake-up/loading overlay may ONLY appear
  // when the preview backend is actively transitioning toward 'ready'.
  // Anything else (idle, failed, stopped) must NOT trigger it — that
  // produced the "BUILD FAILED + Waking up preview…" contradiction.
  const starting = state === 'detecting' || state === 'building' || state === 'starting';
  // Project pipeline is still mid-build (separate from preview lifecycle).
  const projectBuilding = project.status === 'generating';
  // Hard build failure on the project itself — supersedes every preview
  // sub-state. We never auto-start, never show "waking up", just surface
  // the failure to the user.
  const projectFailed = project.status === 'failed';
  const previewFailed = state === 'failed';
  const previewIdle   = state === 'idle' || state === 'stopped';
  // The loading overlay is allowed if AND ONLY IF every one of these
  // holds — kept as a single boolean so the JSX can't accidentally show
  // it via a chained ternary.
  const showLoadingOverlay =
    !running &&
    !projectFailed &&
    !previewFailed &&
    docker &&
    (projectBuilding || starting);
  // Decoupled preview label — once the project is `completed`, we drop
  // "building project" entirely and use the preview state instead.
  const previewLabel: string = !docker
    ? 'docker unavailable'
    : projectFailed
      ? 'build failed'
      : projectBuilding
      ? 'generating'
      : state === 'detecting' ? 'preparing'
      : state === 'building'  ? 'installing'
      : state === 'starting'  ? 'starting'
      : state === 'ready'     ? 'ready'
      : state === 'failed'    ? 'failed'
      : state;

  // Format createdAt for the header. Falls back gracefully if the
  // timestamp is missing/invalid so a malformed record doesn't blank the
  // identity row.
  const createdAtLabel = (() => {
    if (!project.createdAt) return null;
    const t = Date.parse(project.createdAt);
    if (!Number.isFinite(t)) return null;
    const d = new Date(t);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  })();

  return (
    <div className="h-full p-3 flex flex-col gap-2">
      {/* IDENTITY HEADER ── single source of truth for "what am I looking at?".
          Row 1: name + status pills + actions. Row 2: full projectId
          (copyable) + identity badges + createdAt. */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2 text-[11.5px]">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="h-2 w-2 rounded-full shrink-0"
              style={{
                background:
                  running ? 'var(--success)' : !docker ? 'var(--error)' : 'var(--accent-amber)',
              }}
            />
            <span className="font-medium text-[13px] text-[var(--text-primary)] truncate">
              {project.name}
            </span>
            <StatusPill kind="build" label={project.status} />
            <StatusPill kind="preview" label={previewLabel} />
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={async () => {
                // Manual refresh of the AUTHORITATIVE project record from the
                // backend — reconciles a stale local FAILED with a freshly
                // completed remote, picks up records created via terminal/API,
                // etc. Distinct from the preview-status refresh below.
                // eslint-disable-next-line no-console
                console.info('[preview-stage] manual project refresh', { projectId: project.id });
                const fresh = await getProject(project.id);
                if (fresh) {
                  useStore.getState().upsertProject(fresh);
                }
                // Also refresh preview lifecycle while we're here.
                getPreviewStatus(project.id).then(setStatus).catch(() => undefined);
              }}
              className="h-7 px-2 grid place-items-center rounded-md text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)] border"
              style={{ borderColor: 'var(--border-subtle)' }}
              aria-label="Refresh project record from backend"
              title="Refresh project record from backend"
            >
              Sync
            </button>
            <button
              type="button"
              onClick={() => getPreviewStatus(project.id).then(setStatus)}
              className="h-7 w-7 grid place-items-center rounded-md text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
              aria-label="Refresh preview status"
            >
              <RefreshCw size={12} />
            </button>
          </div>
        </div>
        {/* Identity row ── full id + provenance badges + createdAt. */}
        <div className="flex items-center flex-wrap gap-1.5 text-[10.5px] text-[var(--text-secondary)]">
          <ProjectIdChip id={project.id} size="xs" />
          <span
            className="px-1.5 py-[1px] rounded font-semibold uppercase tracking-wider"
            style={{
              color: 'var(--success)',
              background: 'rgba(16,185,129,0.14)',
              border: '1px solid rgba(16,185,129,0.35)',
            }}
            title="This project record drives every panel below."
          >
            Selected project
          </span>
          {selectedProjectId === project.id && (
            <span
              className="px-1.5 py-[1px] rounded font-semibold uppercase tracking-wider"
              style={{
                color: '#93C5FD',
                background: 'rgba(59,130,246,0.14)',
                border: '1px solid rgba(59,130,246,0.35)',
              }}
              title={`Preview iframe and lifecycle are bound to ${project.id}`}
            >
              Preview bound to this projectId
            </span>
          )}
          {createdAtLabel && (
            <span className="text-[var(--text-secondary)]">
              created <span className="text-[var(--text-primary)] font-medium">{createdAtLabel}</span>
            </span>
          )}
        </div>
      </div>

      {err && (
        <div
          className="text-[11.5px] px-3 py-1.5 rounded border"
          style={{
            background: 'rgba(239,68,68,0.1)',
            borderColor: 'rgba(239,68,68,0.4)',
            color: '#FCA5A5',
          }}
        >
          {err}
        </div>
      )}

      {/* Dev-only identity overlay. Surfaces the four ids the bug report
          asks for so cross-project drift is visible at a glance without
          opening devtools. Stripped from production builds. */}
      {process.env.NODE_ENV !== 'production' && (
        <div
          data-testid="preview-debug"
          className="text-[10.5px] font-mono px-2 py-1 rounded border flex flex-wrap gap-x-3 gap-y-0.5"
          style={{
            background: 'rgba(59,130,246,0.06)',
            borderColor: 'rgba(59,130,246,0.25)',
            color: 'var(--text-secondary)',
          }}
        >
          <span>selectedProjectId: <b className="text-[var(--text-primary)]">{selectedProjectId ?? '∅'}</b></span>
          <span>previewProjectId: <b className="text-[var(--text-primary)]">{previewProjectId ?? '∅'}</b></span>
          <span>previewStatus: <b className="text-[var(--text-primary)]">{status?.state ?? '∅'}</b></span>
          <span>previewUrl: <b className="text-[var(--text-primary)] break-all">{running ? url : '∅'}</b></span>
          {project && project.id !== selectedProjectId && (
            <span style={{ color: '#FCA5A5' }}>
              ⚠ project.id mismatch ({project.id})
            </span>
          )}
        </div>
      )}

      <div className="flex-1 grid place-items-center min-h-[420px]">
        <div
          className="rounded-xl border h-full w-full overflow-hidden"
          style={{ maxWidth: w, borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
        >
          {running ? (
            <iframe
              key={`iframe-${previewProjectId}-${status?.hostPort ?? 'na'}`}
              src={url}
              title={`Preview ${project.name}`}
              className="w-full h-full bg-white"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={() => {
                // eslint-disable-next-line no-console
                console.info('[preview-stage] iframe loaded', { previewProjectId, url });
              }}
            />
          ) : (
            <div className="h-full grid place-items-center text-center px-6">
              <div className="max-w-sm">
                {!docker ? (
                  <>
                    <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                      Docker not available
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] mt-1">
                      Start Docker Desktop and reload to enable live previews.
                    </div>
                  </>
                ) : projectFailed ? (
                  <>
                    <div
                      className="mx-auto mb-3 h-10 w-10 rounded-full grid place-items-center"
                      style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--error)' }}
                    >
                      <span aria-hidden className="text-[16px] font-semibold">!</span>
                    </div>
                    <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                      Build failed
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] mt-1 break-words">
                      {project.preview?.previewError
                        ?? 'The generation pipeline reported a failure. Open the logs panel for details.'}
                    </div>
                  </>
                ) : previewFailed ? (
                  <>
                    <div
                      className="mx-auto mb-3 h-10 w-10 rounded-full grid place-items-center"
                      style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--error)' }}
                    >
                      <span aria-hidden className="text-[16px] font-semibold">!</span>
                    </div>
                    <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                      Preview failed
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] mt-1 break-words">
                      {project.preview?.previewError
                        ?? 'The preview container exited unexpectedly. Click Restart to try again.'}
                    </div>
                  </>
                ) : showLoadingOverlay ? (
                  <>
                    <div className="mx-auto mb-3 h-10 w-10 rounded-full grid place-items-center"
                         style={{ background: 'rgba(245,158,11,0.15)', color: 'var(--accent-amber)' }}>
                      <Loader2 size={18} className="devteam-pulse-slow" />
                    </div>
                    <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                      {projectBuilding ? 'Generating project…' : 'Preview starting…'}
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] mt-1">
                      {projectBuilding
                        ? 'The agents are still building the code. Live preview will start automatically as soon as it’s ready.'
                        : 'Spinning up a sandboxed container. This usually takes 10–30 seconds.'}
                    </div>
                  </>
                ) : previewIdle ? (
                  <>
                    <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                      Preview idle
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] mt-1">
                      The container isn’t running. It will start automatically once the project finishes building.
                    </div>
                  </>
                ) : (
                  <>
                    <div className="text-[14px] font-semibold text-[var(--text-primary)]">
                      Preview unavailable
                    </div>
                    <div className="text-[12px] text-[var(--text-secondary)] mt-1">
                      State: {previewLabel}
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Real code viewer ──────────────────────────────────────────────────── */

function CodeViewer({ project }: { project: GeneratedProject | null }) {
  const [files, setFiles] = useState<ProjectFileEntry[] | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [content, setContent] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!project) { setFiles(null); setActive(null); setContent(''); return; }
    let cancelled = false;
    setLoading(true); setErr(null);
    getProjectFiles(project.id).then(
      (list) => {
        if (cancelled) return;
        setFiles(list);
        const pick =
          list.find((f) => /(^|\/)README/i.test(f.path))
          ?? list.find((f) => /\.(md|txt)$/i.test(f.path))
          ?? list[0];
        setActive(pick?.path ?? null);
      },
      (e) => { if (!cancelled) setErr((e as Error).message); },
    ).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [project?.id]);

  useEffect(() => {
    if (!project || !active) { setContent(''); return; }
    let cancelled = false;
    getProjectFile(project.id, active).then(
      (f) => { if (!cancelled) setContent(f.content); },
      (e) => { if (!cancelled) setContent(`// Error loading ${active}\n// ${(e as Error).message}`); },
    );
    return () => { cancelled = true; };
  }, [project?.id, active]);

  if (!project) {
    return (
      <EmptyState message="Select a project to browse its source." />
    );
  }
  if (loading && !files) {
    return <EmptyState message="Loading file tree…" busy />;
  }
  if (err) {
    return <EmptyState message={`Could not load files: ${err}`} kind="error" />;
  }
  if (!files || files.length === 0) {
    return <EmptyState message="This project has no files yet — generation may still be in progress." />;
  }

  return (
    <div className="flex h-full min-h-[480px]">
      <aside
        className="w-56 shrink-0 border-r overflow-y-auto devteam-scroll p-2"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        {files.map((f) => (
          <button
            key={f.path}
            type="button"
            onClick={() => setActive(f.path)}
            className={cn(
              'w-full text-left text-[12px] py-1 px-2 rounded-md font-mono truncate',
              active === f.path
                ? 'bg-[var(--bg-elevated)] text-[var(--accent-amber)]'
                : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]',
            )}
            title={f.path}
          >
            {f.path}
          </button>
        ))}
      </aside>
      <div className="flex-1 overflow-auto devteam-scroll">
        <pre className="text-[12.5px] leading-[1.6] p-4 font-mono text-[var(--text-primary)] whitespace-pre">
{content}
        </pre>
      </div>
    </div>
  );
}

/* ── API docs derived from real source ─────────────────────────────────── */

function ApiDocs({ project }: { project: GeneratedProject | null }) {
  const [routes, setRoutes] = useState<{ method: string; path: string; file: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!project) { setRoutes(null); return; }
    let cancelled = false;
    setErr(null); setRoutes(null);
    (async () => {
      try {
        const files = await getProjectFiles(project.id);
        const candidates = files.filter((f) =>
          /\.(ts|js|tsx|jsx)$/.test(f.path) &&
          /(routes?|api|server|index)/i.test(f.path),
        ).slice(0, 30);
        const found: { method: string; path: string; file: string }[] = [];
        for (const f of candidates) {
          try {
            const c = await getProjectFile(project.id, f.path);
            const re = /\b(?:app|router|fastify|server|express)\.(get|post|put|patch|delete|head|options)\s*\(\s*['"`]([^'"`]+)['"`]/gi;
            let m: RegExpExecArray | null;
            while ((m = re.exec(c.content)) !== null) {
              found.push({ method: m[1].toUpperCase(), path: m[2], file: f.path });
              if (found.length > 60) break;
            }
            // Next.js route handlers: app/api/**/route.ts → derive path from file
            const rh = /^app\/api\/(.+)\/route\.(ts|tsx|js|jsx)$/i.exec(f.path) ?? /^src\/app\/api\/(.+)\/route\.(ts|tsx|js|jsx)$/i.exec(f.path);
            if (rh) {
              const exportRe = /\bexport\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\b/g;
              let em: RegExpExecArray | null;
              while ((em = exportRe.exec(c.content)) !== null) {
                found.push({ method: em[1].toUpperCase(), path: '/api/' + rh[1], file: f.path });
              }
            }
            if (found.length > 60) break;
          } catch { /* skip unreadable file */ }
        }
        if (!cancelled) setRoutes(found);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [project?.id]);

  if (!project)         return <EmptyState message="Select a project to inspect its API surface." />;
  if (err)              return <EmptyState message={`Could not analyse routes: ${err}`} kind="error" />;
  if (routes === null)  return <EmptyState message="Scanning project for routes…" busy />;
  if (routes.length === 0) return <EmptyState message="No HTTP route definitions detected in this project." />;

  const colors: Record<string, string> = {
    GET: '#10B981', POST: '#3B82F6', PUT: '#F59E0B', PATCH: '#F59E0B', DELETE: '#EF4444',
    HEAD: '#94A3B8', OPTIONS: '#94A3B8',
  };
  return (
    <div className="p-4 space-y-2">
      {routes.map((e, i) => (
        <div
          key={i}
          className="flex items-center gap-3 rounded-lg border bg-[var(--bg-elevated)] px-3 py-2.5"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <span
            className="text-[10.5px] font-bold rounded px-2 py-1 min-w-[58px] text-center"
            style={{ background: (colors[e.method] ?? '#94A3B8') + '22', color: colors[e.method] ?? '#94A3B8' }}
          >
            {e.method}
          </span>
          <span className="font-mono text-[12.5px] text-[var(--text-primary)] truncate">{e.path}</span>
          <span className="ml-auto text-[10.5px] text-[var(--text-secondary)] font-mono truncate max-w-[40%]">
            {e.file}
          </span>
        </div>
      ))}
    </div>
  );
}

/* ── Database derived from real schema.prisma / *.sql ──────────────────── */

function DatabaseView({ project }: { project: GeneratedProject | null }) {
  const [files, setFiles] = useState<{ path: string; content: string }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!project) { setFiles(null); return; }
    let cancelled = false;
    setErr(null); setFiles(null);
    (async () => {
      try {
        const list = await getProjectFiles(project.id);
        const matches = list.filter((f) =>
          /(prisma\/schema\.prisma|drizzle\/schema|\.sql$|models?\/[^\/]+\.(ts|js))/i.test(f.path),
        ).slice(0, 5);
        const out: { path: string; content: string }[] = [];
        for (const m of matches) {
          try {
            const c = await getProjectFile(project.id, m.path);
            out.push({ path: m.path, content: c.content });
          } catch { /* skip */ }
        }
        if (!cancelled) setFiles(out);
      } catch (e) {
        if (!cancelled) setErr((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, [project?.id]);

  if (!project)        return <EmptyState message="Select a project to inspect its data model." />;
  if (err)             return <EmptyState message={`Could not load schema: ${err}`} kind="error" />;
  if (files === null)  return <EmptyState message="Scanning for schema files…" busy />;
  if (files.length === 0)
    return <EmptyState message="No schema files found (schema.prisma, .sql, or models/*) in this project." />;

  // Extract Prisma-style models
  const models: { name: string; from: string }[] = [];
  for (const f of files) {
    const re = /\bmodel\s+(\w+)\s*\{/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(f.content)) !== null) models.push({ name: m[1], from: f.path });
    const re2 = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"']?(\w+)[`"']?/gi;
    while ((m = re2.exec(f.content)) !== null) models.push({ name: m[1], from: f.path });
  }

  return (
    <div className="p-4 grid lg:grid-cols-2 gap-4">
      <pre
        className="rounded-lg border p-3 text-[11.5px] font-mono leading-[1.55] text-[var(--text-primary)] overflow-auto devteam-scroll max-h-[400px]"
        style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
      >
{files.map((f) => `// ${f.path}\n${f.content}\n\n`).join('')}
      </pre>
      <div className="space-y-3">
        {models.length === 0 && (
          <div className="text-[11.5px] text-[var(--text-secondary)]">
            Schema files found, but no <code>model</code> or <code>CREATE TABLE</code> entries detected.
          </div>
        )}
        {models.map((t, i) => (
          <div
            key={i}
            className="rounded-lg border bg-[var(--bg-elevated)] p-3"
            style={{ borderColor: 'var(--border-subtle)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[12.5px] font-semibold">{t.name}</span>
              <span className="text-[10px] text-[var(--text-secondary)] font-mono truncate ml-2">{t.from}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Real log console (from store.logs) ────────────────────────────────── */

function LogConsole({ project }: { project: GeneratedProject | null }) {
  const logs = useStore((s) => s.logs);
  const header = project ? (
    <div
      className="flex items-center gap-2 px-4 py-2 border-b text-[11px]"
      style={{ borderColor: 'var(--border-subtle)', background: 'var(--bg-elevated)' }}
    >
      <span className="text-[var(--text-secondary)] uppercase tracking-wider">Logs for</span>
      <span className="font-medium text-[var(--text-primary)] truncate max-w-[180px]">
        {project.name}
      </span>
      <ProjectIdChip id={project.id} size="xs" />
      <StatusPill kind="build" label={project.status} />
      <StatusPill kind="preview" label={(project.preview?.previewStatus ?? 'idle')} />
    </div>
  ) : null;
  if (logs.length === 0) {
    return (
      <div className="h-full flex flex-col">
        {header}
        <EmptyState message="No logs yet. Submit a prompt to start a build and watch the live pipeline output." />
      </div>
    );
  }
  const colors: Record<'info' | 'warn' | 'error', string> = { info: '#94A3B8', warn: '#F59E0B', error: '#EF4444' };
  return (
    <div className="h-full flex flex-col">
      {header}
      <div className="flex-1 overflow-auto devteam-scroll font-mono text-[12px] leading-[1.7] p-4 space-y-0.5">
        {logs.slice(-200).map((l) => {
          const t = (() => {
            const d = new Date(l.ts);
            return isFinite(d.getTime()) ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
          })();
          return (
            <div key={l.id} className="flex gap-3">
              <span className="text-[var(--text-secondary)] opacity-70 shrink-0">{t}</span>
              <span
                style={{ color: colors[l.level] }}
                className="uppercase tracking-wider w-12 text-[10.5px] pt-[3px] shrink-0"
              >
                {l.level}
              </span>
              <span className="text-[var(--text-secondary)] shrink-0">[{l.source}]</span>
              <span className="text-[var(--text-primary)] break-words">{l.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ── Helpers ───────────────────────────────────────────────────────────── */

/** Compact, color-coded pill for {build, preview} status labels in the
 *  active-project header. Uses semantic colours so users can tell at a
 *  glance whether the build is healthy and whether the preview is live. */
function StatusPill({
  kind,
  label,
}: {
  kind: 'build' | 'preview';
  label: string;
}) {
  const palette = (() => {
    const l = label.toLowerCase();
    if (kind === 'build') {
      if (l === 'completed') return { fg: 'var(--success)', bg: 'rgba(16,185,129,0.15)' };
      if (l === 'failed')    return { fg: 'var(--error)',   bg: 'rgba(239,68,68,0.15)'  };
      return { fg: 'var(--accent-amber)', bg: 'rgba(245,158,11,0.15)' };
    }
    if (l === 'ready')                                  return { fg: 'var(--success)', bg: 'rgba(16,185,129,0.15)' };
    if (l === 'failed' || l === 'docker unavailable')   return { fg: 'var(--error)',   bg: 'rgba(239,68,68,0.15)'  };
    return { fg: 'var(--text-secondary)', bg: 'var(--bg-elevated)' };
  })();
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wider"
      style={{ color: palette.fg, background: palette.bg }}
      title={`${kind === 'build' ? 'Build status' : 'Preview status'}: ${label}`}
    >
      <span className="opacity-70">{kind === 'build' ? 'build' : 'preview'}</span>
      <span>{label}</span>
    </span>
  );
}

function EmptyState({
  message,
  busy = false,
  kind = 'info',
}: {
  message: string;
  busy?: boolean;
  kind?: 'info' | 'error';
}) {
  return (
    <div className="h-full grid place-items-center p-6 text-center">
      <div className="max-w-sm flex flex-col items-center gap-2">
        {busy && <Loader2 size={18} className="devteam-pulse-slow text-[var(--accent-amber)]" />}
        <div
          className="text-[12.5px]"
          style={{ color: kind === 'error' ? '#FCA5A5' : 'var(--text-secondary)' }}
        >
          {message}
        </div>
      </div>
    </div>
  );
}

// ApiError import is intentional: makes failures from api.ts surfaceable
// later if we decide to discriminate on .kind.
void ApiError;
