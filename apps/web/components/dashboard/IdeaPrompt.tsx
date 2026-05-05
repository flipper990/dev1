'use client';

import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Paperclip, Mic, ArrowUp, Loader2 } from 'lucide-react';
import { Sparkle } from '../ui/Sparkle';
import { StackPicker } from './StackPicker';
import {
  defaultPickerValue,
  type StackPickerValue,
} from '../../lib/stacks';
import { cn } from '../../lib/cn';

interface Props {
  onSubmit: (text: string, picker?: StackPickerValue) => void;
  busy?: boolean;
  placeholder?: string;
}

/**
 * Hero "Got an idea?" prompt textarea. ⌘/Ctrl+Enter submits.
 * Submit button is gold; attach + mic are subtle ghost icon buttons.
 * The Stack pill opens a modal letting the user dial in the exact
 * tech stack the agents will build with.
 */
export function IdeaPrompt({ onSubmit, busy, placeholder }: Props) {
  const [text, setText] = useState('');
  const [picker, setPicker] = useState<StackPickerValue>(() => defaultPickerValue());

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const v = text.trim();
    if (!v || busy) return;
    onSubmit(v, picker);
    setText('');
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') submit();
  };

  return (
    <form onSubmit={submit} className="cn-prompt-shell">
      <div className="flex items-start gap-3">
        <div className="mt-1.5 text-gold-300">
          <Sparkle size={18} />
        </div>
        <textarea
          className="cn-prompt-textarea flex-1"
          placeholder={
            placeholder ??
            'Describe what you want to build — “a fullstack task tracker with auth and Postgres”'
          }
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          rows={3}
          disabled={busy}
        />
      </div>

      <div className="cn-prompt-toolbar">
        <button
          type="button"
          className="cn-icon-btn"
          aria-label="Attach file"
          disabled={busy}
        >
          <Paperclip size={15} />
        </button>
        <button
          type="button"
          className="cn-icon-btn"
          aria-label="Voice input"
          disabled={busy}
        >
          <Mic size={15} />
        </button>

        <StackPicker value={picker} onChange={setPicker} />

        <span className="ml-auto text-[11px] text-muted hidden sm:inline">
          <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono">
            ⌘
          </kbd>{' '}
          +{' '}
          <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-white/10 text-[10px] font-mono">
            Enter
          </kbd>{' '}
          to send
        </span>

        <button
          type="submit"
          className={cn('cn-btn cn-btn--gold !rounded-full !px-4 !py-2.5')}
          disabled={busy || text.trim().length === 0}
          aria-label="Send"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <ArrowUp size={15} />}
        </button>
      </div>
    </form>
  );
}
