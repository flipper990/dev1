'use client';

/**
 * Global keyboard shortcuts + a discoverability overlay.
 *
 * Pressing `?` (shift+/) toggles the overlay. Shortcuts registered here are
 * intentionally few and carefully picked — every binding should pay for
 * itself across every session. When in doubt, leave it out.
 *
 * Shortcuts only fire when:
 *   - The overlay is closed (Escape closes it first), AND
 *   - The event target is NOT an input/textarea/contenteditable surface.
 *
 * This way a user typing "?" into a prompt textarea just types a literal
 * question mark.
 */

import { useEffect, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Keyboard } from 'lucide-react';
import { useStore } from '../lib/store';

interface Shortcut {
  keys: string[];
  label: string;
  group: 'Navigation' | 'Actions' | 'View';
}

const SHORTCUTS: Shortcut[] = [
  { keys: ['Ctrl', 'K'],        label: 'Start from template',       group: 'Actions' },
  { keys: ['Ctrl', 'E'],        label: 'Browse example projects',   group: 'Actions' },
  { keys: ['Ctrl', 'N'],        label: 'New project',               group: 'Actions' },
  { keys: ['Ctrl', 'D'],        label: 'Download code',             group: 'Actions' },
  { keys: ['Ctrl', 'B'],        label: 'Toggle sidebar',            group: 'View' },
  { keys: ['Ctrl', 'Shift', 'L'], label: 'Toggle logs',             group: 'View' },
  { keys: ['?'],                label: 'Show keyboard shortcuts',   group: 'View' },
  { keys: ['Esc'],              label: 'Close any open overlay',    group: 'View' },
];

function isEditableTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

export interface KeyboardShortcutsProps {
  onNewProject?: () => void;
  onDownload?: () => void;
  canDownload?: boolean;
}

export function KeyboardShortcuts({ onNewProject, onDownload, canDownload }: KeyboardShortcutsProps) {
  const [helpOpen, setHelpOpen] = useState(false);
  const {
    sidebarCollapsed, logsOpen, showcaseOpen, templateGalleryOpen,
    toggleSidebar, setLogsOpen, setShowcaseOpen, setTemplateGalleryOpen,
  } = useStore();

  const close = useCallback(() => {
    // Prefer closing an open overlay rather than acting on the shortcut.
    if (helpOpen) { setHelpOpen(false); return true; }
    if (templateGalleryOpen) { setTemplateGalleryOpen(false); return true; }
    if (showcaseOpen) { setShowcaseOpen(false); return true; }
    if (logsOpen)  { setLogsOpen(false);  return true; }
    return false;
  }, [helpOpen, templateGalleryOpen, showcaseOpen, logsOpen, setTemplateGalleryOpen, setShowcaseOpen, setLogsOpen]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();

      // Esc closes overlays, unconditionally (even from inputs).
      if (e.key === 'Escape') {
        if (close()) { e.preventDefault(); }
        return;
      }

      // Don't hijack typing in text fields.
      if (isEditableTarget(e.target)) return;

      // `?` opens help. Use `e.key === '?'` directly (handles Shift+/).
      if (e.key === '?' && !mod && !e.altKey) {
        e.preventDefault();
        setHelpOpen((v) => !v);
        return;
      }

      if (!mod) return;

      if (!e.shiftKey && !e.altKey) {
        if (key === 'k') { e.preventDefault(); setTemplateGalleryOpen(true); return; }
        if (key === 'e') { e.preventDefault(); setShowcaseOpen(true); return; }
        if (key === 'n') { e.preventDefault(); onNewProject?.(); return; }
        if (key === 'b') { e.preventDefault(); toggleSidebar(); return; }
        if (key === 'd') {
          if (canDownload) { e.preventDefault(); onDownload?.(); return; }
        }
      }

      if (e.shiftKey && !e.altKey && key === 'l') {
        e.preventDefault();
        setLogsOpen(!logsOpen);
        return;
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [
    close, logsOpen, sidebarCollapsed, canDownload,
    onDownload, onNewProject, toggleSidebar,
    setLogsOpen, setShowcaseOpen, setTemplateGalleryOpen,
  ]);

  return (
    <AnimatePresence>
      {helpOpen && (
        <motion.div
          key="kbd-backdrop"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => setHelpOpen(false)}
          className="fixed inset-0 z-[300] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <motion.div
            key="kbd-dialog"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            onClick={(e) => e.stopPropagation()}
            className="relative bg-[#0B0F19] border border-white/[0.08] rounded-2xl shadow-[0_25px_80px_rgba(0,0,0,0.6)] w-full max-w-[520px] overflow-hidden"
            role="dialog"
            aria-modal="true"
            aria-labelledby="kbd-help-title"
          >
            <header className="flex items-center justify-between px-5 py-3 border-b border-white/[0.06]">
              <div className="flex items-center gap-2">
                <Keyboard size={14} className="text-[#60A5FA]" />
                <h2 id="kbd-help-title" className="text-[13px] font-semibold text-[#F1F5F9]">Keyboard shortcuts</h2>
              </div>
              <button
                onClick={() => setHelpOpen(false)}
                className="flex items-center justify-center w-7 h-7 rounded text-[#64748B] hover:bg-white/[0.06] hover:text-[#F1F5F9] transition-colors"
                title="Close"
              >
                <X size={14} />
              </button>
            </header>
            <div className="px-5 py-4">
              {(['Actions', 'Navigation', 'View'] as const).map((group) => {
                const items = SHORTCUTS.filter((s) => s.group === group);
                if (items.length === 0) return null;
                return (
                  <section key={group} className="mb-4 last:mb-0">
                    <h3 className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748B] mb-2">{group}</h3>
                    <ul className="flex flex-col gap-1.5">
                      {items.map((s) => (
                        <li key={s.label} className="flex items-center justify-between gap-4 text-[12.5px] text-[#CBD5E1]">
                          <span>{s.label}</span>
                          <span className="flex items-center gap-1">
                            {s.keys.map((k) => (
                              <kbd
                                key={k}
                                className="font-mono text-[10.5px] font-semibold text-[#CBD5E1] bg-white/[0.05] border border-white/[0.1] rounded px-1.5 py-0.5 shadow-[inset_0_-1px_0_rgba(0,0,0,0.25)]"
                              >
                                {k}
                              </kbd>
                            ))}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </section>
                );
              })}
              <p className="text-[11px] text-[#64748B] mt-2">
                On macOS, use <span className="font-mono">⌘</span> instead of <span className="font-mono">Ctrl</span>.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
