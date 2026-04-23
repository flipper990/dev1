'use client';

/**
 * Showcase / Example Projects modal.
 *
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Example Projects                                      ✕    │
 *   ├─────────────────┬───────────────────────────────────────────┤
 *   │ [thumb] SaaS    │                                           │
 *   │ [thumb] Market  │    Live preview iframe (srcDoc)           │
 *   │ [thumb] Booking │    + description + tags                   │
 *   │                 │                                           │
 *   └─────────────────┴───────────────────────────────────────────┘
 *
 * Each example runs through the SAME frontend preview pipeline as real
 * generated projects (`buildPreviewHtml`) — so the sandbox, mock layer,
 * and error boundaries apply uniformly. No backend is involved.
 */

import { useMemo, useState } from 'react';
import { X, Sparkles, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { EXAMPLE_PROJECTS, type ExampleProject } from '../lib/example-projects';
import { buildPreviewHtml } from '../lib/preview-build';
import { cn } from '../lib/cn';

export function ShowcasePanel() {
  const { showcaseOpen, setShowcaseOpen } = useStore();
  const [activeId, setActiveId] = useState<string>(EXAMPLE_PROJECTS[0].id);

  const active: ExampleProject = useMemo(
    () => EXAMPLE_PROJECTS.find((p) => p.id === activeId) ?? EXAMPLE_PROJECTS[0],
    [activeId],
  );

  const previewHtml = useMemo(
    () => buildPreviewHtml(active.files, active.name).html,
    [active],
  );

  return (
    <AnimatePresence>
      {showcaseOpen && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 md:p-8"
          onClick={() => setShowcaseOpen(false)}
        >
          <motion.div
            key="dialog"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col w-full max-w-[1180px] h-[82vh] rounded-2xl overflow-hidden bg-[#0B0F19] border border-white/[0.08] shadow-[0_25px_80px_rgba(0,0,0,0.6)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="showcase-title"
          >
            {/* Header */}
            <header className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06] flex-shrink-0">
              <div className="flex items-center gap-2.5">
                <Sparkles size={14} className="text-[#8B5CF6]" />
                <h2 id="showcase-title" className="text-[13px] font-semibold text-[#F1F5F9]">Example Projects</h2>
                <span className="text-[11px] text-[#64748B]">Sandboxed previews · no backend</span>
              </div>
              <button
                onClick={() => setShowcaseOpen(false)}
                title="Close"
                className="flex items-center justify-center w-7 h-7 rounded text-[#64748B] hover:bg-white/[0.06] hover:text-[#F1F5F9] transition-colors"
              >
                <X size={14} />
              </button>
            </header>

            {/* Body */}
            <div className="flex flex-1 min-h-0">
              {/* List */}
              <aside className="w-[320px] flex-shrink-0 border-r border-white/[0.06] overflow-y-auto p-3 flex flex-col gap-3 bg-[#07090f]">
                {EXAMPLE_PROJECTS.map((p) => (
                  <ExampleCard
                    key={p.id}
                    example={p}
                    active={p.id === active.id}
                    onClick={() => setActiveId(p.id)}
                  />
                ))}
              </aside>

              {/* Detail */}
              <section className="flex-1 flex flex-col min-w-0">
                {/* Meta */}
                <div className="px-5 py-3 border-b border-white/[0.06] flex items-start justify-between gap-4 flex-shrink-0">
                  <div className="min-w-0">
                    <div className="text-[14px] font-semibold text-[#F1F5F9] truncate">{active.name}</div>
                    <div className="text-[12px] text-[#94A3B8] mt-0.5">{active.tagline}</div>
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {active.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] font-mono uppercase tracking-wider text-[#A5B4FC] bg-[#6366F1]/10 border border-[#6366F1]/20 rounded px-2 py-0.5"
                        >
                          {t}
                        </span>
                      ))}
                    </div>
                  </div>
                  <p className="text-[12px] text-[#94A3B8] leading-relaxed max-w-md">{active.description}</p>
                </div>

                {/* Preview iframe — reuses the same sandbox isolation as LivePreview */}
                <div className="flex-1 min-h-0 relative bg-[#07090f]">
                  <iframe
                    key={active.id}
                    srcDoc={previewHtml}
                    className="absolute inset-0 w-full h-full border-0 bg-white"
                    title={`${active.name} — preview`}
                    sandbox="allow-scripts allow-forms allow-modals allow-popups"
                    referrerPolicy="no-referrer"
                  />
                </div>
              </section>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function ExampleCard({ example, active, onClick }: { example: ExampleProject; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'group relative text-left rounded-xl overflow-hidden border transition-all flex flex-col',
        active
          ? 'border-[#8B5CF6]/60 bg-[#8B5CF6]/[0.06] shadow-[0_0_20px_rgba(139,92,246,0.15)]'
          : 'border-white/[0.06] bg-white/[0.02] hover:border-white/[0.14] hover:bg-white/[0.04]',
      )}
    >
      {/* Thumbnail */}
      <div
        className="w-full aspect-[5/3] bg-[#0F172A] flex items-center justify-center overflow-hidden"
        dangerouslySetInnerHTML={{ __html: example.thumbnail }}
      />
      {/* Meta */}
      <div className="p-3 flex flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <div className="text-[12px] font-semibold text-[#F1F5F9] truncate">{example.name}</div>
          <ArrowRight
            size={12}
            className={cn(
              'flex-shrink-0 transition-transform',
              active ? 'text-[#C4B5FD]' : 'text-[#64748B] group-hover:translate-x-0.5 group-hover:text-[#94A3B8]',
            )}
          />
        </div>
        <div className="text-[11px] text-[#94A3B8] line-clamp-2">{example.tagline}</div>
      </div>
    </button>
  );
}
