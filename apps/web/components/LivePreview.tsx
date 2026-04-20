'use client';

import { Component, useCallback, useEffect, useRef, useState } from 'react';
import {
  Monitor, Tablet, Smartphone,
  RefreshCw, ExternalLink, AlertTriangle, RotateCcw, Globe,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3001';

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORTS: { id: Viewport; icon: typeof Monitor; label: string; maxW?: string }[] = [
  { id: 'desktop', icon: Monitor,    label: 'Desktop' },
  { id: 'tablet',  icon: Tablet,     label: 'Tablet',  maxW: '768px' },
  { id: 'mobile',  icon: Smartphone, label: 'Mobile',  maxW: '390px' },
];

/* ---- Error boundary ------------------------------------------------------ */
interface EBState { error: Error | null }

class PreviewErrorBoundary extends Component<
  React.PropsWithChildren<{ onRetry: () => void }>,
  EBState
> {
  state: EBState = { error: null };

  static getDerivedStateFromError(e: Error): EBState {
    return { error: e };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[#07090f] text-center px-6">
          <AlertTriangle size={32} className="text-[#F59E0B]" />
          <div>
            <p className="text-[13px] font-semibold text-[#F1F5F9]">Preview error</p>
            <p className="text-[11px] text-[#64748B] mt-1 font-mono break-all">
              {this.state.error.message}
            </p>
          </div>
          <button
            onClick={() => {
              this.setState({ error: null });
              this.props.onRetry();
            }}
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

/* ---- Main component ------------------------------------------------------ */
export function LivePreview() {
  const { selectedProjectId, projects, isGenerating, progress } = useStore();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [viewport,  setViewport]  = useState<Viewport>('desktop');
  const [iframeKey, setIframeKey] = useState(0);
  const [loading,   setLoading]   = useState(false);

  const project       = projects.find((p) => p.id === selectedProjectId) ?? null;
  const projectStatus = project?.status ?? null;
  const previewUrl    = selectedProjectId
    ? `${API_BASE}/api/projects/${selectedProjectId}/preview`
    : null;
  const canPreview = !!previewUrl && projectStatus === 'completed';

  useEffect(() => {
    if (projectStatus === 'completed' && selectedProjectId) {
      setIframeKey((k) => k + 1);
      setLoading(true);
    }
  }, [projectStatus, selectedProjectId]);

  const handleRefresh = useCallback(() => {
    setIframeKey((k) => k + 1);
    setLoading(true);
  }, []);

  const handleOpenTab = useCallback(() => {
    if (previewUrl) window.open(previewUrl, '_blank', 'noopener,noreferrer');
  }, [previewUrl]);

  const pct         = progress?.progress ?? 0;
  const currentStep = progress?.currentStep?.name ?? null;
  const vp          = VIEWPORTS.find((v) => v.id === viewport)!;

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-h-0">

      {/* Toolbar */}
      <div
        className="flex items-center gap-2 px-3 border-b border-white/[0.06] bg-[#0B0F19]/50 flex-shrink-0"
        style={{ height: 40 }}
      >
        {/* Left section */}
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] flex-shrink-0">
            Preview
          </span>

          {/* URL bar mockup */}
          {canPreview && (
            <div className="flex items-center gap-1.5 flex-1 max-w-[300px] bg-white/[0.04] border border-white/[0.06] rounded px-2 py-1 text-[11px] text-[#64748B] min-w-0 overflow-hidden">
              <Globe size={10} className="flex-shrink-0" />
              <span className="truncate font-mono">{previewUrl}</span>
            </div>
          )}

          {/* Live / Building / Ready badge */}
          {project && (
            <div className={cn(
              'flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border flex-shrink-0',
              projectStatus === 'completed'
                ? 'text-[#22C55E] border-[#22C55E]/30 bg-[#22C55E]/[0.08]'
                : projectStatus === 'generating'
                ? 'text-[#3B82F6] border-[#3B82F6]/30 bg-[#3B82F6]/[0.08]'
                : 'text-[#64748B] border-white/[0.06] bg-white/[0.03]',
            )}>
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{
                  background:
                    projectStatus === 'completed' ? '#22C55E'
                    : projectStatus === 'generating' ? '#3B82F6'
                    : '#64748B',
                  animation:
                    projectStatus === 'completed' || projectStatus === 'generating'
                      ? 'pulse-dot 1.8s ease-in-out infinite'
                      : undefined,
                }}
              />
              {projectStatus === 'completed'
                ? 'Live'
                : projectStatus === 'generating'
                ? 'Building'
                : 'Ready'}
            </div>
          )}
        </div>

        {/* Segmented device toggle */}
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
                  viewport === item.id
                    ? 'bg-white/[0.10] text-[#3B82F6]'
                    : 'hover:text-[#F1F5F9]',
                )}
              >
                <Icon size={13} />
              </button>
            );
          })}
        </div>

        <button
          onClick={handleRefresh}
          disabled={!canPreview}
          title="Refresh"
          className="flex items-center justify-center w-7 h-7 rounded border border-transparent text-[#64748B] hover:bg-white/[0.06] hover:border-white/[0.06] hover:text-[#F1F5F9] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <RefreshCw size={13} />
        </button>

        <button
          onClick={handleOpenTab}
          disabled={!canPreview}
          title="Open in new tab"
          className="flex items-center justify-center w-7 h-7 rounded border border-transparent text-[#64748B] hover:bg-white/[0.06] hover:border-white/[0.06] hover:text-[#F1F5F9] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <ExternalLink size={13} />
        </button>
      </div>

      {/* Stage */}
      <div
        className="flex-1 relative flex items-start justify-center overflow-hidden"
        style={{ background: '#07090f' }}
      >
        {/* Building overlay */}
        <AnimatePresence>
          {isGenerating && (
            <motion.div
              key="building"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex items-center justify-center bg-[#07090f]/60 backdrop-blur-sm z-10"
            >
              <div className="flex flex-col items-center gap-4 bg-[#1E293B]/90 border border-white/10 rounded-2xl p-8 min-w-[280px] text-center">
                <div
                  className="w-11 h-11 rounded-full border-[3px] border-[#3B82F6]/20 border-t-[#3B82F6]"
                  style={{ animation: 'spin 0.7s linear infinite' }}
                />
                <div className="text-[2.2rem] font-bold text-[#3B82F6] font-mono leading-none">
                  {pct}%
                </div>
                <div className="text-[12px] text-[#CBD5E1]">
                  {currentStep ?? 'Initialising pipeline...'}
                </div>
                <div className="w-full h-1.5 bg-white/[0.08] rounded-full overflow-hidden">
                  <motion.div
                    className="h-full rounded-full"
                    style={{ background: 'linear-gradient(90deg, #3B82F6, #818CF8)' }}
                    animate={{ width: `${pct}%` }}
                    transition={{ duration: 0.4, ease: 'easeOut' }}
                  />
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Empty state */}
        {!isGenerating && !canPreview && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-[#64748B] text-[13px]">
            <Globe size={40} className="opacity-30" />
            <span>Generate a project to see the live preview.</span>
          </div>
        )}

        {/* Device frame + iframe */}
        {canPreview && (
          <motion.div
            className="relative flex flex-col overflow-hidden"
            style={{ width: '100%', height: '100%', maxWidth: vp.maxW ?? '100%' }}
            animate={{ maxWidth: vp.maxW ?? '100%' }}
            transition={{ duration: 0.2 }}
          >
            {/* Browser chrome for tablet / mobile */}
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

            {/* Load progress bar */}
            {loading && (
              <div className="absolute top-0 left-0 right-0 h-0.5 z-10 overflow-hidden">
                <div
                  className="h-full w-1/3"
                  style={{
                    background: 'linear-gradient(90deg, #3B82F6, #818CF8)',
                    animation: 'load-sweep 1.5s ease-in-out infinite',
                  }}
                />
              </div>
            )}

            {/* Iframe wrapped in error boundary */}
            <PreviewErrorBoundary onRetry={handleRefresh}>
              <iframe
                key={iframeKey}
                ref={iframeRef}
                src={previewUrl}
                className="flex-1 w-full border-0 bg-white block"
                title="Live preview"
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                onLoad={() => setLoading(false)}
              />
            </PreviewErrorBoundary>
          </motion.div>
        )}
      </div>
    </div>
  );
}