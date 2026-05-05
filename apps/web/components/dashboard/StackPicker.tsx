'use client';

import { useEffect, useMemo, useState } from 'react';
import { X, Check, Layers3, Wand2, Sparkles, SlidersHorizontal } from 'lucide-react';
import {
  STACK_GROUPS,
  emptySelection,
  selectionSummary,
  type StackSelection,
  type StackCategory,
  type StackPickerValue,
  type StackSelectionMode,
} from '../../lib/stacks';
import { cn } from '../../lib/cn';

interface Props {
  value: StackPickerValue;
  onChange: (next: StackPickerValue) => void;
  /** Compact trigger label override. */
  triggerLabel?: string;
  /** When true, render a small mode-aware caption next to the trigger. */
  showCaption?: boolean;
}

/**
 * Stack picker — Auto vs Manual mode.
 *
 *   - DEFAULT MODE = Auto. The trigger reads "Auto" with a sparkle icon
 *     and we never inject a hardcoded stack block. The pipeline chooses
 *     the stack from the prompt itself. No frameworks, databases, or
 *     tools appear pre-selected.
 *   - The user can flip to Manual via the segmented mode toggle at the
 *     top of the modal, then pick chips. Manual mode commits the chosen
 *     stack as a hard override.
 *   - Touching a chip while in Auto mode auto-flips to Manual (chip
 *     selection is meaningless otherwise).
 */
export function StackPicker({ value, onChange, triggerLabel, showCaption = true }: Props) {
  const [open, setOpen] = useState(false);
  const [draftMode, setDraftMode] = useState<StackSelectionMode>(value.mode);
  const [draftSelection, setDraftSelection] = useState<StackSelection>(value.selection);
  const [filter, setFilter] = useState<StackCategory | 'all'>('all');

  useEffect(() => {
    if (open) {
      setDraftMode(value.mode);
      setDraftSelection(value.selection);
    }
  }, [open, value]);

  // ESC to close
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  const isManual = value.mode === 'manual';
  const summary = useMemo(
    () => (isManual ? selectionSummary(value.selection) : 'Auto'),
    [value, isManual],
  );

  const toggle = (cat: StackCategory, id: string, multi: boolean | undefined) => {
    // Touching a chip implicitly switches the draft to manual mode.
    if (draftMode !== 'manual') setDraftMode('manual');
    setDraftSelection((prev) => {
      const cur = prev[cat];
      if (multi) {
        const arr = Array.isArray(cur) ? [...cur] : cur ? [cur as string] : [];
        const next = arr.includes(id) ? arr.filter((x) => x !== id) : [...arr, id];
        return { ...prev, [cat]: next };
      }
      return { ...prev, [cat]: cur === id ? undefined : id };
    });
  };

  const isSelected = (cat: StackCategory, id: string) => {
    if (draftMode !== 'manual') return false;
    const cur = draftSelection[cat];
    return Array.isArray(cur) ? cur.includes(id) : cur === id;
  };

  const apply = () => {
    if (draftMode === 'manual') {
      onChange({ mode: 'manual', selection: draftSelection });
    } else {
      onChange({ mode: 'auto', selection: emptySelection() });
    }
    setOpen(false);
  };
  const setMode = (next: StackSelectionMode) => {
    setDraftMode(next);
    if (next === 'auto') setDraftSelection(emptySelection());
  };

  const visibleGroups = filter === 'all'
    ? STACK_GROUPS
    : STACK_GROUPS.filter((g) => g.id === filter);

  return (
    <>
      <div className="flex flex-col items-start gap-1 min-w-0">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className={cn('cn-stack-trigger', !isManual && 'is-auto')}
          aria-label={`Tech stack — currently ${isManual ? 'manual' : 'auto'}`}
        >
          {isManual ? <Layers3 size={14} /> : <Sparkles size={14} />}
          <span className="cn-stack-trigger__mode">
            {isManual ? 'Manual' : 'Auto'}
          </span>
          {isManual && (
            <>
              <span className="cn-stack-trigger__sep" aria-hidden>·</span>
              <span className="cn-stack-trigger__label">{triggerLabel ?? summary}</span>
            </>
          )}
          <span className="cn-stack-trigger__chev">⋯</span>
        </button>
        {showCaption && (
          <span className="text-[11px] text-muted leading-tight">
            {isManual
              ? 'Advanced — enforce your own technology stack'
              : 'Recommended — the system will choose the best stack for your prompt'}
          </span>
        )}
      </div>

      {open && (
        <div
          className="cn-modal-backdrop"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}
        >
          <div className="cn-modal" role="dialog" aria-modal="true" aria-label="Tech stack picker">
            {/* Header */}
            <div className="cn-modal__header">
              <div>
                <div className="cn-eyebrow">Tech stack</div>
                <h2 className="font-display text-2xl mt-1 tracking-tight">
                  Pick the <span className="serif-italic text-gold-300">right</span> stack
                </h2>
                <p className="text-secondary text-sm mt-1">
                  Default is <strong>Auto</strong>. Switch to Manual only if you need
                  to enforce specific technologies.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="cn-icon-btn"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            {/* Mode toggle — segmented control */}
            <div
              role="radiogroup"
              aria-label="Stack selection mode"
              className="flex flex-col gap-2 px-5 pb-2"
            >
              <div className="cn-mode-seg">
                <button
                  type="button"
                  role="radio"
                  aria-checked={draftMode === 'auto'}
                  onClick={() => setMode('auto')}
                  className={cn('cn-mode-seg__btn', draftMode === 'auto' && 'is-active')}
                >
                  <Sparkles size={14} />
                  <span>Auto</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={draftMode === 'manual'}
                  onClick={() => setMode('manual')}
                  className={cn('cn-mode-seg__btn', draftMode === 'manual' && 'is-active')}
                >
                  <SlidersHorizontal size={14} />
                  <span>Manual</span>
                </button>
              </div>
              <p className="text-[12px] text-secondary leading-snug">
                {draftMode === 'auto'
                  ? 'Recommended — the system will choose the best stack for your prompt'
                  : 'Advanced — enforce your own technology stack'}
              </p>
            </div>

            {/* Category filter pills (only meaningful in manual mode) */}
            <div
              className={cn('cn-modal__catbar', draftMode === 'auto' && 'opacity-40 pointer-events-none')}
              aria-hidden={draftMode === 'auto'}
            >
              <button
                type="button"
                className={cn('cn-catpill', filter === 'all' && 'is-active')}
                onClick={() => setFilter('all')}
              >
                All
              </button>
              {STACK_GROUPS.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={cn('cn-catpill', filter === g.id && 'is-active')}
                  onClick={() => setFilter(g.id)}
                >
                  {g.label}
                </button>
              ))}
            </div>

            {/* Body */}
            <div className="cn-modal__body relative">
              {draftMode === 'auto' && (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-[var(--bg-void)]/55 backdrop-blur-[1px] pointer-events-auto">
                  <div className="max-w-md text-center px-6">
                    <div className="mx-auto mb-3 h-10 w-10 rounded-full grid place-items-center bg-gold-300/10 text-gold-300">
                      <Sparkles size={18} />
                    </div>
                    <h3 className="font-display text-lg tracking-tight">Auto mode</h3>
                    <p className="text-secondary text-[13px] mt-1 leading-relaxed">
                      No frameworks, databases, or tools are pre-selected. The pipeline
                      will read your prompt and choose the best fit.
                    </p>
                    <button
                      type="button"
                      onClick={() => setMode('manual')}
                      className="mt-4 cn-btn cn-btn--ghost !text-xs"
                    >
                      <SlidersHorizontal size={13} />
                      Switch to Manual to pick a stack
                    </button>
                  </div>
                </div>
              )}
              {visibleGroups.map((g) => (
                <section key={g.id} className="cn-stack-group">
                  <header className="flex items-baseline justify-between gap-3 mb-3">
                    <div>
                      <h3 className="font-display text-[17px] tracking-tight">{g.label}</h3>
                      <p className="text-[12px] text-muted mt-0.5">{g.description}</p>
                    </div>
                    <span className="text-[10.5px] uppercase tracking-[0.14em] text-muted">
                      {g.multi ? 'multi-select' : 'pick one'}
                    </span>
                  </header>

                  <div className="flex flex-wrap gap-2">
                    {g.options.map((opt) => {
                      const sel = isSelected(g.id, opt.id);
                      return (
                        <button
                          key={opt.id}
                          type="button"
                          onClick={() => toggle(g.id, opt.id, g.multi)}
                          className={cn('cn-stack-chip', sel && 'is-active')}
                          title={opt.hint}
                          tabIndex={draftMode === 'auto' ? -1 : 0}
                        >
                          {sel && <Check size={12} className="cn-stack-chip__check" />}
                          <span>{opt.label}</span>
                          {opt.recommended && !sel && (
                            <span className="cn-stack-chip__rec">rec</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))}
            </div>

            {/* Footer */}
            <div className="cn-modal__footer">
              <span className="text-[11px] text-muted">
                {draftMode === 'manual' ? <><Layers3 size={11} className="inline -mt-0.5 mr-1" />Manual mode</> : <><Sparkles size={11} className="inline -mt-0.5 mr-1" />Auto mode</>}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="cn-btn cn-btn--ghost"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={apply}
                  className="cn-btn cn-btn--gold"
                >
                  Apply
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
