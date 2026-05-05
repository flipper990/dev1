'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { cn } from '../../lib/cn';
import type { ChatMessage } from './types';

export interface ChatHistoryProps {
  messages: ChatMessage[];
}

export function ChatHistory({ messages }: ChatHistoryProps) {
  if (messages.length === 0) {
    return (
      <section className="flex flex-col h-full min-h-0">
        <header className="flex items-center justify-between px-1 pb-2 shrink-0">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            Conversation
          </h2>
          <span className="text-[10.5px] text-[var(--text-secondary)]">0 msgs</span>
        </header>
        <div
          className="rounded-lg border bg-[var(--bg-surface)] p-3 text-[11.5px] text-[var(--text-secondary)]"
          style={{ borderColor: 'var(--border-subtle)' }}
        >
          No conversation yet. Submit a prompt above to start a build — your messages and agent
          replies will appear here.
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col h-full min-h-0">
      <header className="flex items-center justify-between px-1 pb-2 shrink-0">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--text-secondary)]">
          Conversation
        </h2>
        <span className="text-[10.5px] text-[var(--text-secondary)]">{messages.length} msgs</span>
      </header>
      <div className="flex-1 min-h-0 overflow-y-auto devteam-scroll pr-1 space-y-2">
        {messages.map((m) => (
          <Bubble key={m.id} msg={m} />
        ))}
      </div>
    </section>
  );
}

function Bubble({ msg }: { msg: ChatMessage }) {
  const isUser = msg.author === 'user';
  return (
    <div className={cn('flex gap-2', isUser ? 'justify-end' : 'justify-start')}>
      {!isUser && (
        <div
          className="h-7 w-7 rounded-md grid place-items-center text-[14px] shrink-0"
          style={{ background: 'var(--bg-elevated)' }}
          aria-hidden
        >
          {msg.avatar ?? '🤖'}
        </div>
      )}
      <div
        className={cn(
          'rounded-xl px-3 py-2 max-w-[85%] border',
          isUser
            ? 'bg-[rgba(59,130,246,0.18)] border-[rgba(59,130,246,0.32)]'
            : 'bg-[var(--bg-elevated)]',
        )}
        style={{ borderColor: isUser ? undefined : 'var(--border-subtle)' }}
      >
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[11px] font-semibold text-[var(--text-primary)]">{msg.authorName}</span>
          <span className="text-[10px] text-[var(--text-secondary)] font-mono">{msg.timestamp}</span>
        </div>
        <p className="text-[12.5px] leading-relaxed text-[var(--text-primary)] whitespace-pre-wrap">
          {msg.text}
        </p>
        {msg.code && <CodeBlock language={msg.code.language} content={msg.code.content} />}
      </div>
    </div>
  );
}

function CodeBlock({ language, content }: { language: string; content: string }) {
  const [copied, setCopied] = useState(false);
  const onCopy = () => {
    navigator.clipboard?.writeText(content).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div
      className="mt-2 rounded-lg border overflow-hidden"
      style={{ borderColor: 'var(--border-subtle)', background: 'rgba(0,0,0,0.35)' }}
    >
      <div
        className="flex items-center justify-between px-2.5 py-1.5 border-b"
        style={{ borderColor: 'var(--border-subtle)' }}
      >
        <span className="text-[10px] font-mono uppercase tracking-wider text-[var(--text-secondary)]">
          {language}
        </span>
        <button
          type="button"
          onClick={onCopy}
          className="flex items-center gap-1 text-[10.5px] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          aria-label="Copy code"
        >
          {copied ? <Check size={11} /> : <Copy size={11} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto devteam-scroll text-[11.5px] leading-[1.6] p-3 font-mono">
{content}
      </pre>
    </div>
  );
}


