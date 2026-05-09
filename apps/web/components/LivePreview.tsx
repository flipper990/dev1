'use client';

/**
 * Frontend-only preview.
 *
 *   - Fetches the project's source files once, builds a self-contained HTML
 *     document in the browser, and loads it via <iframe srcDoc>. No backend
 *     preview-rendering endpoint is involved at any point.
 *   - The iframe is isolated with `sandbox="allow-scripts"` (no
 *     allow-same-origin) — maximum isolation. localStorage/sessionStorage are
 *     polyfilled inside the iframe by the mock layer if the sandbox blocks them.
 *   - A mock fetch/XHR/WebSocket layer is installed inside the iframe so ALL
 *     network calls the previewed app makes resolve locally with plausible
 *     JSON — no real backend is ever reached at runtime.
 *   - Three layers of error handling:
 *       1. Inside the iframe: global window.onerror / unhandledrejection
 *          handlers render a visible fallback card on top of the app.
 *       2. React class <PreviewErrorBoundary> around the iframe itself.
 *       3. Host-side `status === 'error'` fallback UI if HTML can't even build.
 *   - Refresh button forces a full rebuild + iframe remount.
 *   - Device toggle switches max-width (desktop / tablet / mobile).
 */

import { Component, useCallback, useEffect, useRef, useState } from 'react';
import {
  Monitor, Tablet, Smartphone,
  RefreshCw, AlertTriangle, RotateCcw, Globe, Download, Loader2, CheckCircle2, ShieldCheck,
  Container, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { exportProject, reportIframeReady } from '../lib/api';
import { usePreviewHtml } from '../hooks/usePreviewHtml';
import { useDockerPreview } from '../hooks/useDockerPreview';

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: { id: Viewport; icon: typeof Monitor; label: string; maxW?: string }[] = [
  { id: 'desktop', icon: Monitor,    label: 'Desktop' },
  { id: 'tablet',  icon: Tablet,     label: 'Tablet',  maxW: '768px' },
  { id: 'mobile',  icon: Smartphone, label: 'Mobile',  maxW: '390px' },
];

/* ---- React error boundary around the iframe -------------------------------- */
interface EBState { error: Error | null }

class PreviewErrorBoundary extends Component<React.PropsWithChildren<{ onRetry: () => void }>, EBState> {
  state: EBState = { error: null };
  static getDerivedStateFromError(e: Error): EBState { return { error: e }; }
  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#07090f] text-center px-6">
          <AlertTriangle size={32} className="text-[#F59E0B]" />
          <div>
            <p className="text-[13px] font-semibold text-[#F1F5F9]">Preview error</p>
            <p className="text-[11px] text-[#64748B] mt-1 font-mono break-all">{this.state.error.message}</p>
          </div>
          <button
            onClick={() => { this.setState({ error: null }); this.props.onRetry(); }}
            className="flex items-center gap-2 bg-[#3B82F6]/20 border border-[#3B82F6]/30 text-[#60A5FA] rounded-lg px-4 py-2 text-[12px] font-semibold hover:bg-[#3B82F6]/30 transition-colors"
          >
            <RotateCcw size={13} /> Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

/* ---- Main component -------------------------------------------------------- */
export function LivePreview() {
  const { selectedProjectId, projects, isGenerating, progress, addToast, pushLog } = useStore();
  const [viewport,  setViewport]  = useState<Viewport>('desktop');
  const [iframeKey, setIframeKey] = useState(0);
  const [loading,   setLoading]   = useState(false);
  // Has the Docker iframe successfully fired `onLoad` for the current
  // mount? This is the SINGLE source of truth for "preview is visible".
  // We deliberately don't wait for `docker.phase === 'ready'` because the
  // dev server inside the container can become responsive seconds before
  // the 2s status poll catches up — leaving the user staring at a "Booting"
  // overlay covering an already-rendered iframe.
  const [dockerIframeLoaded, setDockerIframeLoaded] = useState(false);

  const project = projects.find((p) => p.id === selectedProjectId) ?? null;
  const projectStatus = project?.status ?? null;
  // The preview can render the moment the project has files — we don't require
  // "completed" since the mock layer + fallbacks cope with partial codebases.
  const enabled = !!selectedProjectId && projectStatus === 'completed';

  // Try to run the project as a real Docker container first. Falls back to
  // the in-browser srcDoc preview when Docker is unavailable or the build
  // fails. The Docker hook also issues a `stop` when this component unmounts
  // or the project deselects, so we don't leak containers.
  const docker = useDockerPreview(selectedProjectId, enabled);
  const useDocker = docker.phase === 'ready' || docker.phase === 'starting' || docker.phase === 'checking';
  const dockerFailed = docker.phase === 'failed' || docker.phase === 'unavailable';

  // Reset the iframe-loaded flag whenever we remount the iframe (key change),
  // switch project, or restart the container.
  useEffect(() => {
    setDockerIframeLoaded(false);
  }, [selectedProjectId, iframeKey, docker.url]);

  // Log preview lifecycle milestones to the host log panel so users can see
  // exactly when the iframe became live.
  const lastLifecycleRef = useRef<string>('');
  useEffect(() => {
    if (!enabled || !selectedProjectId) return;
    const tag = `${docker.previewState}|${docker.url ? 'url' : 'no-url'}|loaded=${dockerIframeLoaded}`;
    if (tag !== lastLifecycleRef.current) {
      pushLog('preview', `state=${docker.previewState}${docker.url ? ` url=${docker.url}` : ''}${dockerIframeLoaded ? ' iframe-loaded' : ''}`, 'info');
      lastLifecycleRef.current = tag;
    }
  }, [enabled, selectedProjectId, docker.previewState, docker.url, dockerIframeLoaded, pushLog]);

  // Fallback srcDoc preview — only build it when Docker isn't going to work,
  // otherwise we waste cycles fetching every file in the project.
  const preview = usePreviewHtml(selectedProjectId, project?.name ?? 'Project', { enabled: enabled && dockerFailed });

  // Force a fresh iframe mount every time the builder produces a new HTML doc.
  useEffect(() => {
    if (preview.status === 'ready' || preview.status === 'empty' || preview.status === 'error') {
      setIframeKey((k) => k + 1);
      setLoading(true);
    }
  }, [preview.buildId, preview.status]);

  // Listen for preview-side postMessage events (console + error forwarding).
  useEffect(() => {
    function onMessage(event: MessageEvent) {
      const data = event.data as { __devteamPreview?: boolean; kind?: string; level?: string; message?: string; title?: string };
      if (!data || !data.__devteamPreview) return;
      if (data.kind === 'console' && data.message) {
        const level = data.level === 'warn' || data.level === 'error' ? data.level : 'info';
        pushLog('preview', data.message, level);
      } else if (data.kind === 'error') {
        pushLog('preview', `${data.title ?? 'Runtime error'}: ${data.message ?? ''}`, 'error');
      }
    }
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [pushLog]);

  // ── Download Source Code (unchanged) ────────────────────────────────────
  const [isExporting, setIsExporting] = useState(false);
  const [exportDone,  setExportDone]  = useState(false);
  const handleExport = useCallback(async () => {
    if (!selectedProjectId || !project) return;
    setIsExporting(true);
    try {
      await exportProject(selectedProjectId, project.name);
      setExportDone(true);
      addToast({ type: 'success', title: 'Download started', message: `${(project.name ?? project.id).replace(/[^a-z0-9-_ ]/gi, '')}-export.zip` });
      setTimeout(() => setExportDone(false), 2500);
    } catch (err) {
      addToast({ type: 'error', title: 'Download failed', message: (err as Error).message });
    } finally { setIsExporting(false); }
  }, [selectedProjectId, project, addToast]);

  const handleRefresh = useCallback(() => {
    if (useDocker || dockerFailed) {
      docker.refresh();
    }
    preview.refresh();
    setIframeKey((k) => k + 1);
    setLoading(true);
  }, [docker, useDocker, dockerFailed, preview]);

  const pct         = progress?.progress ?? 0;
  const currentStep = progress?.currentStep?.name ?? null;
  const vp          = VIEWPORTS.find((v) => v.id === viewport)!;

  // ─── Unified preview readiness ─────────────────────────────────────────
  // Three independent signals can each say "preview is ready"; we trust
  // ANY of them and clear loading overlays accordingly:
  //   1. The iframe's own `onLoad` fired         → most authoritative
  //   2. The /preview/status poll says 'ready'   → backend confirms healthy
  //   3. ProjectRecord.preview.previewReady true → persisted mirror
  // Per UX rule: if iframe loads but backend status is stale, trust the
  // iframe — the user is already looking at a working app.
  const previewIsReady =
    dockerIframeLoaded
    || docker.previewState === 'ready'
    || project?.preview?.previewReady === true;

  const previewIsFailed =
    // While the project is regenerating, ignore any 'failed' state left
    // over from the previous run \u2014 the new preview hasn't been
    // attempted yet, so claiming failure is incorrect and produces the
    // \"Preview failed\" banner-on-fresh-build leak.
    projectStatus !== 'generating' && (
      docker.previewState === 'failed'
      || project?.preview?.previewStatus === 'failed'
    );

  // Single message string for the banner above the iframe. Mirrors the
  // user spec: "Project generated successfully" → "Preview starting…" →
  // "Preview ready". Failures + idle phases are handled separately.
  const previewMessage: { kind: 'generating' | 'generated' | 'starting' | 'ready' | 'failed' | 'idle'; text: string } | null =
    !selectedProjectId ? null
    : projectStatus === 'generating' ? { kind: 'generating', text: 'Generating project…' }
    : projectStatus === 'failed'     ? { kind: 'failed',     text: 'Generation failed' }
    : previewIsFailed                ? { kind: 'failed',     text: 'Preview failed to start' }
    : previewIsReady                 ? { kind: 'ready',      text: 'Preview ready' }
    : projectStatus === 'completed'  ? { kind: 'starting',   text:
        docker.previewState === 'preparing' ? 'Project generated successfully · preparing preview…'
        : docker.previewState === 'installing' ? 'Installing dependencies…'
        : docker.previewState === 'building'   ? 'Building image…'
        : docker.previewState === 'starting'   ? 'Starting dev server…'
        : 'Project generated successfully · preview starting…' }
    : { kind: 'idle', text: 'Idle' };

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 border-b border-white/[0.06] bg-[#0B0F19]/50 flex-shrink-0 min-h-[40px]">
        <div className="flex items-center gap-2 flex-1 min-w-0 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] flex-shrink-0">Preview</span>

          {/* Sandbox indicator — emphasises "frontend-only, no network" */}
          {enabled && (
            <div className="flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1 text-[10px] text-[#64748B] flex-shrink-0">
              {docker.phase === 'ready' ? (
                <>
                  <Container size={10} className="text-[#22C55E]" />
                  <span className="font-mono uppercase tracking-wider">Container · live</span>
                </>
              ) : (
                <>
                  <ShieldCheck size={10} className="text-[#22C55E]" />
                  <span className="font-mono uppercase tracking-wider">Sandboxed · mocks on</span>
                </>
              )}
            </div>
          )}

          {project && (() => {
            // Decoupled status pill. Project lifecycle on the left half,
            // preview lifecycle on the right half — never conflate the two.
            const projDone = projectStatus === 'completed';
            const projGen  = projectStatus === 'generating';
            const previewLabel: string =
              !projDone ? (projGen ? 'Generating' : 'Idle')
              : previewIsReady ? 'Live'
              : previewIsFailed ? 'Failed'
              : docker.previewState === 'preparing' ? 'Preparing'
              : docker.previewState === 'installing' ? 'Installing'
              : docker.previewState === 'building' ? 'Building'
              : docker.previewState === 'starting' ? 'Starting'
              : 'Waiting';
            const live = previewLabel === 'Live';
            const isPending = projGen || (projDone && !live && !previewIsFailed);
            const colorClass = live
              ? 'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/[0.08]'
              : previewLabel === 'Failed'
                ? 'text-[#EF4444] border-[#EF4444]/30 bg-[#EF4444]/[0.08]'
                : isPending
                  ? 'text-[#3B82F6] border-[#3B82F6]/30 bg-[#3B82F6]/[0.08]'
                  : 'text-[#64748B] border-white/[0.06] bg-white/[0.03]';
            const dot = live ? '#22C55E' : previewLabel === 'Failed' ? '#EF4444' : isPending ? '#3B82F6' : '#64748B';
            return (
              <div className={cn(
                'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border flex-shrink-0',
                colorClass,
              )}>
                <span className="w-1.5 h-1.5 rounded-full" style={{
                  background: dot,
                  animation: isPending || live ? 'pulse-dot 1.8s ease-in-out infinite' : undefined,
                }} />
                {previewLabel}
              </div>
            );
          })()}

          {/* Mode badge (react-synth / index-html / fallback) */}
          {preview.mode && enabled && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#64748B] bg-white/[0.03] border border-white/[0.06] rounded px-1.5 py-0.5 flex-shrink-0">
              {preview.mode}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 ml-auto flex-shrink-0">
          {/* Device toggle */}
          <div className="flex bg-white/[0.04] border border-white/[0.06] rounded p-0.5 gap-0.5 flex-shrink-0">
            {VIEWPORTS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  onClick={() => setViewport(item.id)}
                  title={item.label}
                  className={cn(
                    'flex items-center justify-center w-6 h-6 rounded text-[#64748B] transition-colors',
                    viewport === item.id ? 'bg-white/[0.10] text-[#3B82F6]' : 'hover:text-[#F1F5F9]',
                  )}
                >
                  <Icon size={13} />
                </button>
              );
            })}
          </div>

          <button
            onClick={handleRefresh}
            disabled={!enabled}
            title="Refresh — rebuild preview from source"
            className="flex items-center justify-center w-7 h-7 rounded border border-transparent text-[#64748B] hover:bg-white/[0.06] hover:border-white/[0.06] hover:text-[#F1F5F9] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw size={13} className={preview.status === 'loading' ? 'animate-spin' : undefined} />
          </button>

          <button
            onClick={handleExport}
            disabled={!enabled || isExporting}
            title="Download Source Code — production-ready ZIP (mocks excluded)"
            className={cn(
              'flex items-center gap-1.5 px-2.5 h-7 rounded-md border text-[11px] font-semibold transition-all duration-200 disabled:opacity-30 disabled:cursor-not-allowed select-none',
              exportDone
                ? 'border-[#22C55E]/50 text-[#22C55E] bg-[#22C55E]/[0.12] shadow-[0_0_8px_rgba(34,197,94,0.25)]'
                : 'border-[#33e6be]/40 text-[#33e6be] bg-[#33e6be]/[0.08] hover:bg-[#33e6be]/[0.18] hover:border-[#33e6be]/60 hover:shadow-[0_0_10px_rgba(51,230,190,0.2)] active:scale-95',
            )}
          >
            {isExporting ? <Loader2 size={11} className="animate-spin" />
              : exportDone ? <CheckCircle2 size={11} />
              : <Download size={11} />}
            {isExporting ? 'Downloading…' : exportDone ? 'Downloaded!' : 'Download Source Code'}
          </button>
        </div>
      </div>

      {/* Stage */}
      <div className="flex-1 relative flex flex-col overflow-hidden rounded-b-2xl sm:rounded-b-[20px]" style={{ background: '#07090f' }}>
        {/* Status-message banner — single source of truth for the user-
            facing copy ("Project generated successfully", "Preview
            starting…", "Preview ready"). Auto-hides on idle so it
            doesn't add noise when no project is selected. */}
        {previewMessage && previewMessage.kind !== 'idle' && (
          <div
            className={cn(
              'flex items-center gap-2 px-3 py-1.5 border-b text-[11px] flex-shrink-0',
              previewMessage.kind === 'ready'
                ? 'bg-[#22C55E]/[0.08] border-[#22C55E]/30 text-[#86EFAC]'
                : previewMessage.kind === 'failed'
                  ? 'bg-[#EF4444]/[0.08] border-[#EF4444]/30 text-[#FCA5A5]'
                  : 'bg-[#3B82F6]/[0.08] border-[#3B82F6]/30 text-[#93C5FD]',
            )}
          >
            {previewMessage.kind === 'ready' ? (
              <CheckCircle2 size={12} className="flex-shrink-0" />
            ) : previewMessage.kind === 'failed' ? (
              <AlertTriangle size={12} className="flex-shrink-0" />
            ) : (
              <Loader2 size={12} className="flex-shrink-0 animate-spin" />
            )}
            <span className="flex-1 min-w-0 truncate font-semibold">{previewMessage.text}</span>
            {previewMessage.kind === 'starting' && project?.preview?.previewStartedAt && (
              <span className="text-[#64748B] font-mono">
                {Math.max(0, Math.round((Date.now() - new Date(project.preview.previewStartedAt).getTime()) / 1000))}s
              </span>
            )}
          </div>
        )}

        {/* Fallback mode banner — in normal flow above the iframe. Persistent
            so users always know which mode they are seeing. Rendered first so
            it gets layout space instead of overlapping content. */}
        {enabled && dockerFailed && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-[#F59E0B]/10 border-b border-[#F59E0B]/30 text-[11px] text-[#FCD34D] flex-shrink-0">
            <AlertTriangle size={12} className="flex-shrink-0 text-[#F59E0B]" />
            <span className="flex-1 min-w-0 truncate">
              <span className="font-semibold">Full preview unavailable</span>
              <span className="opacity-75">
                {' — showing frontend only ('}
                {docker.phase === 'unavailable' ? 'Docker not running on host' : 'container failed to boot'}
                {')'}
              </span>
            </span>
            <button
              onClick={handleRefresh}
              title="Retry full Docker preview"
              className="flex items-center gap-1 px-2 py-0.5 rounded border border-[#F59E0B]/40 text-[#FCD34D] hover:bg-[#F59E0B]/15 flex-shrink-0"
            >
              <RotateCcw size={10} /> Retry
            </button>
          </div>
        )}

        {/* Inner content area — flex column wrapper for overlays + iframe */}
        <div className="flex-1 relative flex items-start justify-center min-h-0 overflow-hidden">
        {/* Pipeline overlay while a session is running */}
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              key="building"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-[#07090f]/60 backdrop-blur-sm z-10"
            >
              <div className="flex flex-col items-center gap-4 bg-[#1E293B]/90 border border-white/10 rounded-2xl p-6 sm:p-8 w-[min(92vw,420px)] text-center">
                <div className="w-11 h-11 rounded-full border-[3px] border-[#3B82F6]/20 border-t-[#3B82F6]" style={{ animation: 'spin 0.7s linear infinite' }} />
                <div className="text-[2.2rem] font-bold text-[#3B82F6] font-mono leading-none">{pct}%</div>
                <div className="text-[12px] text-[#CBD5E1]">{currentStep ?? 'Initialising pipeline...'}</div>
                <div className="w-full h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
                  <motion.div className="h-full rounded-full" style={{ background: 'linear-gradient(90deg, #3B82F6, #818CF8)' }} animate={{ width: `${pct}%` }} transition={{ duration: 0.4, ease: 'easeOut' }} />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Idle: no project selected */}
        {!isGenerating && !enabled && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#64748B] text-[13px]">
            <Globe size={40} className="opacity-30" />
            <span>Generate a project to see the live preview.</span>
          </div>
        )}

        {/* Docker preview: starting (build + boot). Hide the moment ANY
            readiness signal fires (iframe onLoad, status poll, persisted
            mirror) — never make the user stare at a "Booting" overlay
            covering an already-rendered app.
            Per UX rule: if the iframe loaded but backend status is stale,
            we trust the iframe and clear the overlay. */}
        {enabled && useDocker && !previewIsReady && !previewIsFailed && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center z-20 bg-[#07090f]/80 backdrop-blur-sm">
            <Loader2 size={28} className="animate-spin text-[#3B82F6]" />
            <div>
              <p className="text-[13px] font-semibold text-[#F1F5F9] flex items-center justify-center gap-2">
                <Container size={14} className="text-[#3B82F6]" />
                {docker.previewState === 'preparing' ? 'Preparing preview…'
                  : docker.previewState === 'installing' ? 'Installing dependencies…'
                  : docker.previewState === 'building' ? 'Building image…'
                  : docker.previewState === 'starting' ? 'Starting dev server…'
                  : 'Preview starting…'}
              </p>
              <p className="text-[11px] text-[#64748B] mt-1 font-mono">
                {docker.status?.state === 'building' && 'npm install + image build (60–180s on first run)'}
                {docker.status?.state === 'starting' && 'Waiting for HTTP health check…'}
                {docker.status?.state === 'detecting' && 'Detecting framework…'}
                {!docker.status?.state && 'First build can take 60–180s'}
                {docker.status?.stack && ` · ${docker.status.stack}`}
              </p>
            </div>
            <div className="w-48 h-1 bg-white/[0.06] rounded-full overflow-hidden">
              <div className="h-full w-1/3" style={{ background: 'linear-gradient(90deg, #3B82F6, #818CF8)', animation: 'load-sweep 1.5s ease-in-out infinite' }} />
            </div>
            {/* Timeline: explains the gap between generation completion
                and a visible iframe. Reads from project.preview.timeline,
                which is mirrored from the API's PreviewManager on every
                lifecycle event. */}
            {project?.preview?.timeline && project.preview.timeline.length > 0 && (
              <div className="mt-2 max-w-md w-full text-left bg-[#0B0F19]/70 border border-white/[0.06] rounded-md px-3 py-2">
                <div className="text-[10px] font-mono uppercase tracking-wider text-[#64748B] mb-1">
                  Lifecycle ({project.preview.timeline.length} event{project.preview.timeline.length === 1 ? '' : 's'})
                </div>
                <ol className="space-y-0.5 max-h-40 overflow-y-auto">
                  {project.preview.timeline.slice(-12).map((evt, i) => {
                    const isErr = evt.event === 'failed';
                    const dot = isErr ? '#EF4444'
                      : evt.event.endsWith('-end') || evt.event === 'http-probe-ok' || evt.event === 'url-published' || evt.event === 'iframe-ready'
                      ? '#22C55E' : '#3B82F6';
                    return (
                      <li key={`${evt.at}-${i}`} className="flex items-center gap-2 text-[11px] font-mono">
                        <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: dot }} />
                        <span className={isErr ? 'text-[#FCA5A5]' : 'text-[#CBD5E1]'}>{evt.event}</span>
                        {evt.durationMs != null && (
                          <span className="text-[#64748B]">+{(evt.durationMs / 1000).toFixed(1)}s</span>
                        )}
                        {evt.details && typeof evt.details === 'object' && (() => {
                          const d = evt.details as Record<string, unknown>;
                          const port = (d.hostPort ?? d.webHostPort) as number | undefined;
                          const stack = d.stack as string | undefined;
                          return port || stack ? (
                            <span className="text-[#64748B] truncate">
                              {port ? `:${port}` : ''}{stack ? ` ${stack}` : ''}
                            </span>
                          ) : null;
                        })()}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}
          </div>
        )}

        {/* Fallback mode banner — shown ABOVE the srcDoc iframe whenever
            we're rendering the static frontend-only preview. Persistent
            (not just during loading) so users always know which mode they
            are seeing. */}
        {/* (banner moved above into stage flex-column) */}

        {/* Docker preview: render the iframe as soon as a host port is
            allocated (preview state ∈ {starting, ready}). The dev server
            often becomes responsive before our poll catches up; the iframe
            onLoad below clears the boot overlay above. */}
        {enabled && useDocker && docker.url && (
          <motion.div
            className="relative flex flex-col overflow-hidden"
            style={{ width: '100%', height: '100%', maxWidth: vp.maxW ?? '100%' }}
            animate={{ maxWidth: vp.maxW ?? '100%' }}
            transition={{ duration: 0.2 }}
          >
            {viewport !== 'desktop' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[#1c1c1e] border-b border-white/10 flex-shrink-0">
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
                  <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                  <span className="w-2 h-2 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex-1 h-4 bg-white/[0.08] rounded" />
                <a
                  href={docker.url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[10px] text-[#64748B] hover:text-[#F1F5F9] flex items-center gap-1"
                  title="Open in new tab"
                >
                  <ExternalLink size={11} />
                </a>
              </div>
            )}
            {loading && (
              <div className="absolute top-0 left-0 right-0 h-0.5 z-10 overflow-hidden">
                <div className="h-full w-1/3" style={{ background: 'linear-gradient(90deg, #22C55E, #3B82F6)', animation: 'load-sweep 1.5s ease-in-out infinite' }} />
              </div>
            )}
            {project?.runtimeValidation?.finalVerdict === 'fail' && (
              <div className="flex items-start gap-2 px-3 py-2 bg-[#F59E0B]/10 border-b border-[#F59E0B]/30 text-[11px] text-[#FCD34D] flex-shrink-0">
                <AlertTriangle size={13} className="mt-0.5 flex-shrink-0 text-[#F59E0B]" />
                <div className="flex-1 min-w-0">
                  <p className="font-semibold">
                    Runtime check found {project.runtimeValidation.issues.length}{' '}
                    issue{project.runtimeValidation.issues.length === 1 ? '' : 's'} after{' '}
                    {project.runtimeValidation.iterations} auto-fix attempt
                    {project.runtimeValidation.iterations === 1 ? '' : 's'}.
                  </p>
                  {project.runtimeValidation.issues.slice(0, 2).map((iss, i) => (
                    <p key={i} className="font-mono opacity-80 truncate">
                      [{iss.category}] {iss.message}
                    </p>
                  ))}
                </div>
              </div>
            )}
            <PreviewErrorBoundary onRetry={handleRefresh}>
              <iframe
                key={`docker-${iframeKey}`}
                src={docker.url}
                className="flex-1 w-full border-0 block"
                style={{ background: '#07090f', colorScheme: 'dark' }}
                title="Docker preview"
                // Real app, real network. We don't sandbox this iframe because
                // the contained app needs HMR, fetch to its own API, etc.
                referrerPolicy="no-referrer"
                onLoad={() => {
                  setLoading(false);
                  setDockerIframeLoaded(true);
                  pushLog('preview', `iframe loaded: ${docker.url}`, 'info');
                  // Close the timeline loop on the server so the dashboard
                  // can show true wall-clock from runner-start → visible UI.
                  if (selectedProjectId) {
                    const startedAtIso = project?.preview?.previewStartedAt;
                    const loadDurationMs = startedAtIso
                      ? Date.now() - new Date(startedAtIso).getTime()
                      : undefined;
                    void reportIframeReady(selectedProjectId, {
                      url: docker.url ?? undefined,
                      viewport,
                      loadDurationMs,
                    });
                  }
                }}
                onError={() => {
                  // Eagerly mounted iframes can get a transient connection
                  // refused while the dev server is still binding. The 2s
                  // status poll will eventually flip the URL back on,
                  // remounting via iframeKey, so we just log here.
                  pushLog('preview', `iframe error (will retry): ${docker.url}`, 'warn');
                }}
              />
            </PreviewErrorBoundary>
          </motion.div>
        )}

        {/* Docker failed → degrade to in-browser srcDoc preview below.   */}
        {/* The remainder of this section is the original srcDoc preview, */}
        {/* gated on dockerFailed so we don't double-render.              */}

        {/* Loading state (fetching + building HTML) — banner above persists,
            so the user already sees "Full preview unavailable". */}
        {enabled && dockerFailed && preview.status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#64748B] text-[12px]">
            <Loader2 size={20} className="animate-spin text-[#3B82F6]" />
            <span>Building static preview…</span>
          </div>
        )}

        {/* Device frame + iframe (srcDoc) — always render whenever the hook
            has produced HTML (ready / empty / error). The hook guarantees
            non-empty fallback HTML even in 'error' state, so the iframe
            always shows something instead of a blank screen. */}
        {enabled && dockerFailed && (preview.status === 'ready' || preview.status === 'empty' || preview.status === 'error') && (
          <motion.div
            className="relative flex flex-col overflow-hidden"
            style={{ width: '100%', height: '100%', maxWidth: vp.maxW ?? '100%' }}
            animate={{ maxWidth: vp.maxW ?? '100%' }}
            transition={{ duration: 0.2 }}
          >
            {viewport !== 'desktop' && (
              <div className="flex items-center gap-2 px-3 py-2 bg-[#1c1c1e] border-b border-white/10 flex-shrink-0">
                <div className="flex gap-1">
                  <span className="w-2 h-2 rounded-full bg-[#ff5f57]" />
                  <span className="w-2 h-2 rounded-full bg-[#ffbd2e]" />
                  <span className="w-2 h-2 rounded-full bg-[#28c840]" />
                </div>
                <div className="flex-1 h-4 bg-white/[0.08] rounded" />
              </div>
            )}

            {loading && (
              <div className="absolute top-0 left-0 right-0 h-0.5 z-10 overflow-hidden">
                <div className="h-full w-1/3" style={{ background: 'linear-gradient(90deg, #3B82F6, #818CF8)', animation: 'load-sweep 1.5s ease-in-out infinite' }} />
              </div>
            )}

            <PreviewErrorBoundary onRetry={handleRefresh}>
              <iframe
                key={iframeKey}
                srcDoc={preview.html}
                className="flex-1 w-full border-0 block"
                style={{ background: '#07090f', colorScheme: 'dark' }}
                title="Live preview"
                // NOTE: no `allow-same-origin` — iframe runs in a unique opaque
                // origin so it cannot reach our host app, localStorage, cookies,
                // or any backend. This is the core isolation guarantee.
                sandbox="allow-scripts allow-forms allow-modals allow-popups"
                referrerPolicy="no-referrer"
                onLoad={() => setLoading(false)}
              />
            </PreviewErrorBoundary>
          </motion.div>
        )}
        </div>
      </div>
    </div>
  );
}
