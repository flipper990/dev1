'use client';

import { useEffect, useRef, useState } from 'react';
import { Mic, Paperclip, Send, Loader2 } from 'lucide-react';
import { cn } from '../../lib/cn';
import { StackPicker } from '../dashboard/StackPicker';
import {
  defaultPickerValue,
  selectionToPromptPrefix,
  selectionToTechStack,
  type StackPickerValue,
} from '../../lib/stacks';

export interface PromptComposerProps {
  /** `preferences` carries `stackSelectionMode` + `techStackOverride` (manual only). */
  onSubmit?: (
    text: string,
    preferences?: Record<string, unknown>,
  ) => void | Promise<void>;
  isGenerating?: boolean;
  recentPrompts?: string[];
  mode?: 'build' | 'update';
  targetName?: string | null;
}

export function PromptComposer({
  onSubmit,
  isGenerating = false,
  recentPrompts = [],
  mode = 'build',
  targetName = null,
}: PromptComposerProps) {
  const [value, setValue] = useState('');
  const [picker, setPicker] = useState<StackPickerValue>(() => defaultPickerValue());
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(300, Math.max(120, el.scrollHeight)) + 'px';
  }, [value]);

  // Focus on global "new project" event.
  useEffect(() => {
    const onNew = () => {
      setValue('');
      ref.current?.focus();
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    };
    window.addEventListener('devteam:new-project', onNew);
    return () => window.removeEventListener('devteam:new-project', onNew);
  }, []);

  const handleSubmit = () => {
    const text = value.trim();
    if (!text) return;
    const isManual = picker.mode === 'manual';
    const prefix = isManual ? selectionToPromptPrefix(picker.selection) : '';
    const finalText = prefix ? `${prefix}${text}` : text;
    const prefs: Record<string, unknown> = { stackSelectionMode: picker.mode };
    if (isManual) {
      const override = selectionToTechStack(picker.selection);
      if (Object.keys(override).length > 0) prefs.techStackOverride = override;
    }
    // eslint-disable-next-line no-console
    console.info('[stack-picker]', {
      mode: picker.mode,
      injectedBlock: isManual && prefix.length > 0,
      override: prefs.techStackOverride ?? null,
    });
    onSubmit?.(finalText, prefs);
    setValue('');
  };

  return (
    <section className="space-y-3">
      <div
        className="devteam-focus-glow rounded-xl border bg-[var(--bg-surface)]"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <textarea
          ref={ref}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') handleSubmit();
          }}
          placeholder={
            mode === 'update' && targetName
              ? `Describe a change to "${targetName}" — e.g., 'add a dark mode toggle' or 'change accent color to blue'`
              : "Describe your fullstack app — e.g., 'A task tracker with auth, teams, and PostgreSQL'"
          }
          className="w-full resize-none bg-transparent px-4 py-3.5 text-[14px] leading-relaxed text-[var(--text-primary)] placeholder:text-[var(--text-secondary)] outline-none"
          style={{ minHeight: 120, maxHeight: 300 }}
        />
        <div
          className="flex items-center gap-2 px-3 py-2 border-t"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <ToolbarButton aria-label="Attach"><Paperclip size={15} /></ToolbarButton>
            <ToolbarButton aria-label="Voice"><Mic size={15} /></ToolbarButton>
            <span className="mx-1 h-5 w-px bg-[var(--border-subtle)] shrink-0" />
            <div className="min-w-0 flex-1">
              <StackPicker value={picker} onChange={setPicker} />
            </div>
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={value.trim().length === 0 || isGenerating}
            className={cn(
              'shrink-0 flex items-center gap-1.5 h-8 px-3 rounded-md text-[12.5px] font-semibold',
              'disabled:opacity-40 disabled:cursor-not-allowed',
            )}
            style={{
              background: 'var(--accent-amber)',
              color: 'var(--bg-void)',
            }}
          >
            {isGenerating
              ? <><Loader2 size={13} className="devteam-pulse-slow" /> {mode === 'update' ? 'Updating…' : 'Building…'}</>
              : mode === 'update'
                ? <>Update <Send size={13} /></>
                : <>Build <Send size={13} /></>}
          </button>
        </div>
      </div>

      {recentPrompts.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {recentPrompts.slice(0, 3).map((p, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setValue(p)}
              className="text-left rounded-lg border bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] p-3"
              style={{ borderColor: 'var(--border-subtle)' }}
              title={p}
            >
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">Recent</div>
              <div className="text-[11.5px] text-[var(--text-primary)] mt-1 line-clamp-3 leading-snug">
                {p}
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

function ToolbarButton({ children, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      {...rest}
      className="h-7 w-7 rounded-md grid place-items-center text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-elevated)]"
    >
      {children}
    </button>
  );
}
