'use client';

/**
 * Template Gallery modal — "Start from template" experience.
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Start from template                                    ✕    │
 *   │  Pick a starting point. You can edit the prompt after.       │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐                 │
 *   │  │ SaaS   │ │ Market │ │ Dash   │ │ Social │                 │
 *   │  └────────┘ └────────┘ └────────┘ └────────┘                 │
 *   ├──────────────────────────────────────────────────────────────┤
 *   │  [icon] SaaS App                                             │
 *   │  Multi-tenant…                                               │
 *   │  Best practices:                                             │
 *   │   • …                                                        │
 *   │  ┌────────────────────────────────────────────────────────┐  │
 *   │  │  prompt preview (monospaced, scrollable)                │  │
 *   │  └────────────────────────────────────────────────────────┘  │
 *   │                              [ Cancel ] [ Use this template ]│
 *   └──────────────────────────────────────────────────────────────┘
 *
 * Picking a template writes the prompt into `pendingPrompt` in the
 * store; PromptPanel consumes it and clears it.
 */

import { useState, useMemo } from 'react';
import { X, Sparkles, CheckCircle2, ArrowRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useStore } from '../lib/store';
import { PROMPT_TEMPLATES, type PromptTemplate } from '../lib/prompt-templates';
import { cn } from '../lib/cn';

export function TemplateGallery() {
  const { templateGalleryOpen, setTemplateGalleryOpen, setPendingPrompt, setProjectMode, setSelectedProjectId } = useStore();
  const [pickedId, setPickedId] = useState<PromptTemplate['id']>(PROMPT_TEMPLATES[0].id);

  const picked = useMemo(
    () => PROMPT_TEMPLATES.find((t) => t.id === pickedId) ?? PROMPT_TEMPLATES[0],
    [pickedId],
  );

  const close = () => setTemplateGalleryOpen(false);

  const apply = () => {
    // Ensure we are in create mode with a blank selection so the user
    // lands on the prompt panel for a new project.
    setSelectedProjectId(null);
    setProjectMode('create');
    setPendingPrompt(picked.prompt);
    setTemplateGalleryOpen(false);
  };

  return (
    <AnimatePresence>
      {templateGalleryOpen && (
        <motion.div
          key="backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4 md:p-8"
          onClick={close}
        >
          <motion.div
            key="dialog"
            initial={{ opacity: 0, y: 12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98 }}
            transition={{ duration: 0.18, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative flex flex-col w-full max-w-[960px] max-h-[88vh] rounded-2xl overflow-hidden bg-[#0B0F19] border border-white/[0.08] shadow-[0_25px_80px_rgba(0,0,0,0.6)]"
            role="dialog"
            aria-modal="true"
            aria-labelledby="template-gallery-title"
          >
            {/* Header */}
            <header className="flex items-start justify-between px-5 py-3.5 border-b border-white/[0.06] flex-shrink-0">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles size={14} className="text-[#60A5FA]" />
                  <h2 id="template-gallery-title" className="text-[13px] font-semibold text-[#F1F5F9]">
                    Start from template
                  </h2>
                </div>
                <p className="text-[11px] text-[#64748B] mt-1">
                  Each template is a battle-tested prompt with best-practice constraints baked in. Pick one, then edit freely before you hit Generate.
                </p>
              </div>
              <button
                onClick={close}
                title="Close"
                className="flex items-center justify-center w-7 h-7 rounded text-[#64748B] hover:bg-white/[0.06] hover:text-[#F1F5F9] transition-colors"
              >
                <X size={14} />
              </button>
            </header>

            {/* Card row */}
            <div className="px-5 py-4 border-b border-white/[0.06] flex-shrink-0">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {PROMPT_TEMPLATES.map((t) => (
                  <TemplateCard
                    key={t.id}
                    template={t}
                    active={t.id === picked.id}
                    onPick={() => setPickedId(t.id)}
                  />
                ))}
              </div>
            </div>

            {/* Detail */}
            <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4">
              <div className="flex items-start gap-3 mb-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                  style={{ background: `${picked.accent}22`, border: `1px solid ${picked.accent}55` }}
                >
                  <picked.icon size={16} style={{ color: picked.accent }} />
                </div>
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-[#F1F5F9]">{picked.label}</div>
                  <div className="text-[12px] text-[#94A3B8] mt-0.5">{picked.description}</div>
                </div>
              </div>

              <div className="mb-3">
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mb-1.5">
                  Best practices included
                </div>
                <ul className="grid grid-cols-1 md:grid-cols-2 gap-x-4 gap-y-1">
                  {picked.bestPractices.map((bp) => (
                    <li key={bp} className="flex items-start gap-1.5 text-[12px] text-[#CBD5E1]">
                      <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0" style={{ color: picked.accent }} />
                      <span>{bp}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B] mb-1.5">
                  Prompt preview
                </div>
                <pre className="bg-black/40 border border-white/[0.06] rounded-lg p-3 text-[11.5px] leading-relaxed text-[#CBD5E1] font-mono whitespace-pre-wrap max-h-[260px] overflow-y-auto">
                  {picked.prompt}
                </pre>
              </div>
            </div>

            {/* Footer actions */}
            <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-white/[0.06] flex-shrink-0 bg-[#07090f]">
              <button
                onClick={close}
                className="px-3.5 py-1.5 rounded text-[12px] font-medium text-[#94A3B8] hover:text-[#F1F5F9] hover:bg-white/[0.04] transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={apply}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded text-[12px] font-semibold bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white transition-colors"
              >
                Use this template
                <ArrowRight size={12} />
              </button>
            </footer>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function TemplateCard({
  template, active, onPick,
}: {
  template: PromptTemplate;
  active: boolean;
  onPick: () => void;
}) {
  const Icon = template.icon;
  return (
    <button
      type="button"
      onClick={onPick}
      className={cn(
        'group text-left rounded-xl p-3 border transition-all flex flex-col gap-1.5',
        active
          ? 'bg-white/[0.04]'
          : 'bg-white/[0.02] border-white/[0.06] hover:bg-white/[0.04] hover:border-white/[0.12]',
      )}
      style={active ? { borderColor: `${template.accent}88`, boxShadow: `0 0 0 1px ${template.accent}33, 0 0 24px ${template.accent}22` } : undefined}
    >
      <div className="flex items-center gap-2">
        <div
          className="w-7 h-7 rounded-md flex items-center justify-center flex-shrink-0"
          style={{ background: `${template.accent}22`, border: `1px solid ${template.accent}44` }}
        >
          <Icon size={13} style={{ color: template.accent }} />
        </div>
        <div className="text-[12.5px] font-semibold text-[#F1F5F9] truncate">{template.label}</div>
      </div>
      <div className="text-[11px] text-[#94A3B8] leading-snug line-clamp-2">{template.tagline}</div>
    </button>
  );
}
