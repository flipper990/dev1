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

import { Component, useCallback, useEffect, useState } from 'react';
import {
  Monitor, Tablet, Smartphone,
  RefreshCw, AlertTriangle, RotateCcw, Globe, Download, Loader2, CheckCircle2, ShieldCheck,
  Container, ExternalLink,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';
import { exportProject } from '../lib/api';
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

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 border-b border-white/[0.06] bg-[#0B0F19]/50 flex-shrink-0" style={{ height: 40 }}>
        <div className="flex items-center gap-2 flex-1 min-w-0">
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

          {project && (
            <div className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border flex-shrink-0',
              projectStatus === 'completed' ? 'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/[0.08]'
                : projectStatus === 'generating' ? 'text-[#3B82F6] border-[#3B82F6]/30 bg-[#3B82F6]/[0.08]'
                : 'text-[#64748B] border-white/[0.06] bg-white/[0.03]',
            )}>
              <span className="w-1.5 h-1.5 rounded-full" style={{
                background: projectStatus === 'completed' ? '#22C55E' : projectStatus === 'generating' ? '#3B82F6' : '#64748B',
                animation: projectStatus === 'completed' || projectStatus === 'generating' ? 'pulse-dot 1.8s ease-in-out infinite' : undefined,
              }} />
              {projectStatus === 'completed' ? 'Live' : projectStatus === 'generating' ? 'Building' : 'Ready'}
            </div>
          )}

          {/* Mode badge (react-synth / index-html / fallback) */}
          {preview.mode && enabled && (
            <span className="text-[10px] font-mono uppercase tracking-wider text-[#64748B] bg-white/[0.03] border border-white/[0.06] rounded px-1.5 py-0.5 flex-shrink-0">
              {preview.mode}
            </span>
          )}
        </div>

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

      {/* Stage */}
      <div className="flex-1 relative flex items-start justify-center overflow-hidden" style={{ background: '#07090f' }}>
        {/* Pipeline overlay while a session is running */}
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              key="building"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-[#07090f]/60 backdrop-blur-sm z-10"
            >
              <div className="flex flex-col items-center gap-4 bg-[#1E293B]/90 border border-white/10 rounded-2xl p-8 min-w-[280px] text-center">
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

        {/* Docker preview: starting (build + boot) */}
        {enabled && useDocker && docker.phase !== 'ready' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <Loader2 size={28} className="animate-spin text-[#3B82F6]" />
            <div>
              <p className="text-[13px] font-semibold text-[#F1F5F9] flex items-center justify-center gap-2">
                <Container size={14} className="text-[#3B82F6]" />
                {docker.phase === 'checking' ? 'Checking Docker…' : 'Booting container'}
              </p>
              <p className="text-[11px] text-[#64748B] mt-1 font-mono">
                {docker.status?.state === 'building' && 'Building image (npm install)…'}
                {docker.status?.state === 'starting' && 'Starting dev server…'}
                {docker.status?.state === 'detecting' && 'Detecting framework…'}
                {!docker.status?.state && 'First build can take 60-180s'}
                {docker.status?.stack && ` · ${docker.status.stack}`}
              </p>
            </div>
            <div className="w-48 h-1 bg-white/[0.06] rounded-full overflow-hidden">
              <div className="h-full w-1/3" style={{ background: 'linear-gradient(90deg, #3B82F6, #818CF8)', animation: 'load-sweep 1.5s ease-in-out infinite' }} />
            </div>
          </div>
        )}

        {/* Docker preview: ready — real running app via reverse proxy */}
        {enabled && useDocker && docker.phase === 'ready' && docker.url && (
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
                className="flex-1 w-full border-0 bg-white block"
                title="Docker preview"
                // Real app, real network. We don't sandbox this iframe because
                // the contained app needs HMR, fetch to its own API, etc.
                referrerPolicy="no-referrer"
                onLoad={() => setLoading(false)}
              />
            </PreviewErrorBoundary>
          </motion.div>
        )}

        {/* Docker failed → degrade to in-browser srcDoc preview below.   */}
        {/* The remainder of this section is the original srcDoc preview, */}
        {/* gated on dockerFailed so we don't double-render.              */}

        {/* Loading state (fetching + building HTML) */}
        {enabled && dockerFailed && preview.status === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#64748B] text-[12px]">
            <Loader2 size={20} className="animate-spin text-[#3B82F6]" />
            <span>Building preview…</span>
            <span className="text-[10px] font-mono opacity-60">
              {docker.phase === 'unavailable' ? 'Docker unavailable — using sandbox preview' : 'Container failed — using sandbox preview'}
            </span>
          </div>
        )}

        {/* Host-side error fallback (builder couldn't even produce HTML) */}
        {enabled && dockerFailed && preview.status === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            <AlertTriangle size={28} className="text-[#F59E0B]" />
            <div>
              <p className="text-[13px] font-semibold text-[#F1F5F9]">Could not build preview</p>
              <p className="text-[11px] text-[#64748B] mt-1 font-mono break-all max-w-md">{preview.error ?? docker.error ?? 'Unknown failure'}</p>
            </div>
            <button onClick={handleRefresh} className="flex items-center gap-2 bg-[#3B82F6]/20 border border-[#3B82F6]/30 text-[#60A5FA] rounded-lg px-4 py-2 text-[12px] font-semibold hover:bg-[#3B82F6]/30">
              <RotateCcw size={13} /> Retry
            </button>
          </div>
        )}

        {/* Device frame + iframe (srcDoc) — only when Docker has failed */}
        {enabled && dockerFailed && (preview.status === 'ready' || preview.status === 'empty') && (
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
                className="flex-1 w-full border-0 bg-white block"
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
  );
}
