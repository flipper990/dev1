'use client';
import { useRef, useState, useCallback } from 'react';
import { Zap, Layers, Terminal, Box, Radio, Bot, Play, Loader2 } from 'lucide-react';
import { useStore } from '../lib/store';
import { cn } from '../lib/cn';

const TEMPLATES = [
  { icon: Zap,      label: 'REST API',       prompt: 'Build a production-ready REST API with authentication, CRUD endpoints, rate limiting, and OpenAPI docs. Use Node.js, Express, TypeScript, and PostgreSQL.' },
  { icon: Layers,   label: 'Full-Stack App', prompt: 'Create a full-stack web application with Next.js frontend, Express backend, PostgreSQL database, JWT authentication, and Tailwind CSS styling.' },
  { icon: Terminal, label: 'CLI Tool',       prompt: 'Build a TypeScript CLI tool with argument parsing, configuration file support, colored output, and interactive prompts using Commander.js and Inquirer.' },
  { icon: Box,      label: 'NPM Package',    prompt: 'Create a TypeScript npm package with proper exports, documentation, unit tests, CI/CD pipeline, and semantic versioning support.' },
  { icon: Radio,    label: 'Real-time App',  prompt: 'Build a real-time collaborative application with WebSockets, React, Node.js, and Redis for pub/sub messaging.' },
  { icon: Bot,      label: 'AI Agent',       prompt: 'Create an AI-powered agent with tool calling, memory, streaming responses, and a chat interface using OpenAI API and TypeScript.' },
];

const MAX_TOKENS = 4096;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function PromptPanel({ onSubmit, disabled }: {
  onSubmit: (prompt: string) => void;
  disabled?: boolean;
}) {
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isGenerating } = useStore();

  const tokens    = estimateTokens(prompt);
  const costEst   = (tokens * 0.00000015).toFixed(6);
  const tokenWarn = tokens > MAX_TOKENS * 0.9 ? 'danger' : tokens > MAX_TOKENS * 0.6 ? 'warn' : '';

  const handleSubmit = useCallback(() => {
    const trimmed = prompt.trim();
    if (!trimmed || disabled || isGenerating) return;
    onSubmit(trimmed);
    setPrompt('');
  }, [prompt, disabled, isGenerating, onSubmit]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSubmit();
    }
  };

  const applyTemplate = (t: typeof TEMPLATES[0]) => {
    setPrompt(t.prompt);
    textareaRef.current?.focus();
  };

  const isDisabled = disabled || isGenerating || !prompt.trim();

  return (
    <div className="flex-shrink-0 border-b border-white/[0.06] bg-[#0B0F19]/50">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">Prompt</span>
        {prompt && (
          <span className={cn(
            'text-[11px] font-mono',
            tokenWarn === 'danger' ? 'text-[#EF4444]' : tokenWarn === 'warn' ? 'text-[#F59E0B]' : 'text-[#64748B]',
          )}>
            ~{tokens.toLocaleString()} tokens · est. ${costEst}
          </span>
        )}
      </div>

      {/* Template chips */}
      <div className="flex gap-1.5 px-3 pt-2 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        {TEMPLATES.map((t) => {
          const Icon = t.icon;
          return (
            <button
              key={t.label}
              onClick={() => applyTemplate(t)}
              className="flex-shrink-0 flex items-center gap-1.5 bg-white/[0.04] border border-white/[0.06] rounded-full px-3 py-1 text-[11px] text-[#94A3B8] hover:bg-[#3B82F6]/10 hover:border-[#3B82F6]/30 hover:text-[#60A5FA] transition-colors whitespace-nowrap"
            >
              <Icon size={11} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Textarea */}
      <div className="px-3 pt-2">
        <textarea
          ref={textareaRef}
          className="w-full bg-transparent border-0 border-b border-white/[0.08] px-0 py-1.5 text-[13px] text-[#F1F5F9] outline-none resize-none leading-relaxed min-h-[72px] max-h-[140px] placeholder:text-[#475569] focus:border-[#3B82F6]/50 transition-colors"
          placeholder="Describe the project you want to build… (Ctrl+Enter to generate)"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between px-3 pb-2.5 pt-1">
        <span className="text-[11px] text-[#475569]">
          <kbd className="bg-white/[0.04] border border-white/[0.06] rounded px-1 py-0.5 text-[10px] font-mono">Ctrl</kbd>
          +
          <kbd className="bg-white/[0.04] border border-white/[0.06] rounded px-1 py-0.5 text-[10px] font-mono">↵</kbd>
          {' '}generate &nbsp;·&nbsp;
          <kbd className="bg-white/[0.04] border border-white/[0.06] rounded px-1 py-0.5 text-[10px] font-mono">⇧L</kbd>
          {' '}logs
        </span>
        <button
          onClick={handleSubmit}
          disabled={isDisabled}
          className={cn(
            'flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[12px] font-semibold transition-all',
            isDisabled
              ? 'bg-[#3B82F6]/40 text-white/40 cursor-not-allowed'
              : 'bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white hover:-translate-y-px active:translate-y-0',
          )}
        >
          {isGenerating ? (
            <><Loader2 size={13} className="animate-spin" /> Building…</>
          ) : (
            <><Play size={12} /> Generate</>
          )}
        </button>
      </div>
    </div>
  );
}

