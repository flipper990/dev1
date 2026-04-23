'use client';
import { useRef, useState, useCallback, useEffect } from 'react';
import {
  Zap, Layers, Terminal, Box, Radio, Bot,
  Loader2, PlusCircle, RefreshCw, Wrench, Download, CheckCircle2,
  Sparkles,
} from 'lucide-react';
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

export interface PromptPanelProps {
  /** Called when the primary action (Generate or Update) is invoked. */
  onSubmit: (prompt: string) => void;
  /** Called when "Fix Issues" is clicked — sends a canned fix prompt. Only shown in edit mode. */
  onFixIssues?: () => void;
  /** Called when "Download Code" is clicked. */
  onDownload?: () => void;
  disabled?: boolean;
  mode?: 'create' | 'edit';
  /** Whether the selected project is finished and downloadable. */
  canDownload?: boolean;
  /** True while a download is in flight. */
  isDownloading?: boolean;
  /** Briefly true after a successful download completes. */
  downloadDone?: boolean;
}

export function PromptPanel({
  onSubmit,
  onFixIssues,
  onDownload,
  disabled,
  mode = 'create',
  canDownload = false,
  isDownloading = false,
  downloadDone = false,
}: PromptPanelProps) {
  const [prompt, setPrompt] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { isGenerating, pendingPrompt, setPendingPrompt, setTemplateGalleryOpen } = useStore();

  // Consume the one-shot prompt seed placed by the Template Gallery or
  // any other surface (e.g. "Use as template" on the showcase).
  useEffect(() => {
    if (pendingPrompt !== null) {
      setPrompt(pendingPrompt);
      setPendingPrompt(null);
      // Defer focus so the textarea is mounted and the cursor lands at
      // the end of the seeded text.
      requestAnimationFrame(() => {
        const el = textareaRef.current;
        if (el) {
          el.focus();
          el.setSelectionRange(el.value.length, el.value.length);
          el.scrollTop = 0;
        }
      });
    }
  }, [pendingPrompt, setPendingPrompt]);

  const tokens    = estimateTokens(prompt);
  const costEst   = (tokens * 0.00000015).toFixed(6);
  const tokenWarn = tokens > MAX_TOKENS * 0.9 ? 'danger' : tokens > MAX_TOKENS * 0.6 ? 'warn' : '';

  const isEdit = mode === 'edit';

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

  const isPrimaryDisabled   = disabled || isGenerating || !prompt.trim();
  const isSecondaryDisabled = isGenerating;

  return (
    <div className="flex-shrink-0 border-b border-white/[0.06] bg-[#0B0F19]/50">
      {/* Header row */}
      <div className="flex items-center justify-between px-3 pt-2.5 pb-0">
        <span className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#64748B]">
          {isEdit ? 'Iterate on Project' : 'New Project'}
        </span>
        {prompt ? (
          <span className={cn(
            'text-[11px] font-mono',
            tokenWarn === 'danger' ? 'text-[#EF4444]' : tokenWarn === 'warn' ? 'text-[#F59E0B]' : 'text-[#64748B]',
          )}>
            ~{tokens.toLocaleString()} tokens · est. ${costEst}
          </span>
        ) : !isEdit ? (
          <button
            onClick={() => setTemplateGalleryOpen(true)}
            className="flex items-center gap-1 text-[11px] font-medium text-[#A5B4FC] hover:text-[#C7D2FE] bg-[#6366F1]/[0.08] hover:bg-[#6366F1]/[0.15] border border-[#6366F1]/25 rounded-full px-2.5 py-0.5 transition-colors"
            title="Pre-fill a battle-tested prompt with best practices"
          >
            <Sparkles size={10} />
            Start from template
          </button>
        ) : null}
      </div>

      {/* Template chips — only in create mode */}
      {!isEdit && (
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
      )}

      {/* Textarea */}
      <div className="px-3 pt-2">
        <textarea
          ref={textareaRef}
          className="w-full bg-transparent border-0 border-b border-white/[0.08] px-0 py-1.5 text-[13px] text-[#F1F5F9] outline-none resize-none leading-relaxed min-h-[72px] max-h-[140px] placeholder:text-[#475569] focus:border-[#3B82F6]/50 transition-colors"
          placeholder={isEdit
            ? 'Describe the next change — e.g. "add a dark mode toggle" (Ctrl+Enter to update)'
            : 'Describe the project you want to build… (Ctrl+Enter to generate)'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={3}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between gap-2 px-3 pb-2.5 pt-1.5">
        <span className="text-[11px] text-[#475569] flex-shrink-0">
          <kbd className="bg-white/[0.04] border border-white/[0.06] rounded px-1 py-0.5 text-[10px] font-mono">Ctrl</kbd>
          +
          <kbd className="bg-white/[0.04] border border-white/[0.06] rounded px-1 py-0.5 text-[10px] font-mono">↵</kbd>
          {' '}{isEdit ? 'update' : 'generate'}
        </span>

        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {/* Fix Issues — only shown while iterating on an existing project */}
          {isEdit && onFixIssues && (
            <button
              onClick={onFixIssues}
              disabled={isSecondaryDisabled}
              title="Ask the agents to fix any review / lint / type issues in the current codebase"
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-semibold border transition-all',
                isSecondaryDisabled
                  ? 'border-white/[0.06] text-white/30 cursor-not-allowed'
                  : 'border-[#F59E0B]/40 text-[#F59E0B] bg-[#F59E0B]/[0.08] hover:bg-[#F59E0B]/[0.18] hover:border-[#F59E0B]/60',
              )}
            >
              <Wrench size={12} /> Fix Issues
            </button>
          )}

          {/* Download Code */}
          {onDownload && (
            <button
              onClick={onDownload}
              disabled={!canDownload || isDownloading}
              title="Download the exported ZIP of this project"
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1.5 text-[12px] font-semibold border transition-all',
                !canDownload || isDownloading
                  ? 'border-white/[0.06] text-white/30 cursor-not-allowed'
                  : downloadDone
                  ? 'border-[#22C55E]/50 text-[#22C55E] bg-[#22C55E]/[0.12]'
                  : 'border-[#33e6be]/40 text-[#33e6be] bg-[#33e6be]/[0.08] hover:bg-[#33e6be]/[0.18] hover:border-[#33e6be]/60',
              )}
            >
              {isDownloading
                ? <Loader2 size={12} className="animate-spin" />
                : downloadDone
                ? <CheckCircle2 size={12} />
                : <Download size={12} />}
              {isDownloading ? 'Downloading…' : downloadDone ? 'Downloaded' : 'Download Code'}
            </button>
          )}

          {/* Primary — Generate / Update Project */}
          <button
            onClick={handleSubmit}
            disabled={isPrimaryDisabled}
            className={cn(
              'flex items-center gap-1.5 rounded px-3.5 py-1.5 text-[12px] font-semibold transition-all',
              isPrimaryDisabled
                ? 'bg-[#3B82F6]/40 text-white/40 cursor-not-allowed'
                : 'bg-[#3B82F6] hover:bg-[#3B82F6]/90 text-white hover:-translate-y-px active:translate-y-0',
            )}
          >
            {isGenerating ? (
              <><Loader2 size={13} className="animate-spin" /> {isEdit ? 'Updating…' : 'Building…'}</>
            ) : isEdit ? (
              <><RefreshCw size={12} /> Update Project</>
            ) : (
              <><PlusCircle size={12} /> Generate</>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
