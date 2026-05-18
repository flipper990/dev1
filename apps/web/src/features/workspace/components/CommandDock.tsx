'use client';

import { useEffect, useRef, useState } from 'react';
import { CornerDownLeft, Cpu, Sparkles, TerminalSquare, WandSparkles } from 'lucide-react';
import { Button, Textarea } from '../../../../components/ui';

interface CommandDockProps {
  projectId?: string | null;
  busy?: boolean;
  disabled?: boolean;
  mode?: 'create' | 'change';
  onSubmit: (command: string) => void;
}

export function CommandDock({ projectId, busy = false, disabled = false, mode = 'change', onSubmit }: CommandDockProps) {
  const [command, setCommand] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const MIN_TEXTAREA_HEIGHT = 44;
  const MAX_TEXTAREA_HEIGHT = 120;

  useEffect(() => {
    setCommand('');
  }, [projectId]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = `${MIN_TEXTAREA_HEIGHT}px`;
    if (!command.trim()) return;
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, MIN_TEXTAREA_HEIGHT), MAX_TEXTAREA_HEIGHT);
    textarea.style.height = `${nextHeight}px`;
  }, [command]);

  const trimmed = command.trim();
  const isCreate = mode === 'create';
  const quickCommands = isCreate
    ? ['/create stack react+node+postgres', '/create auth + billing + admin', '/create API-first monorepo']
    : ['/patch add audit trail to orders', '/verify run preview + smoke checks', '/ship prepare deployment artifact'];

  const submit = () => {
    if (!trimmed || disabled || busy) return;
    onSubmit(trimmed);
    setCommand('');
  };

  return (
    <section
      aria-label="Command dock"
      className="studio-glass relative w-full rounded-[20px] px-3 py-2.5"
    >
      <div className="flex flex-wrap items-center justify-between gap-1.5">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-label-s uppercase tracking-[0.14em] text-text-muted">
            <TerminalSquare className="h-3.5 w-3.5" /> Orchestration console
          </p>
          <p className="mt-0.5 text-label-s text-text-secondary">{isCreate ? 'Bootstrap mode' : 'Runtime iteration mode'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-surface-tint/80 px-2 py-0.5 text-label-s text-text-secondary">
            <Cpu className="h-3.5 w-3.5" /> {isCreate ? 'Mode: bootstrap' : 'Mode: iterate'}
          </span>
          {projectId ? (
            <span className="max-w-[220px] truncate rounded-full border border-border-muted bg-surface-tint/80 px-2 py-0.5 font-mono text-mono-s text-text-secondary">
              {projectId}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2 flex flex-col gap-2 md:flex-row md:items-end">
        <label htmlFor="workspace-command" className="sr-only">Change request</label>
        <Textarea
          ref={textareaRef}
          id="workspace-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          rows={1}
          disabled={disabled || busy}
          className="max-h-[120px] min-h-[44px] resize-none overflow-y-auto rounded-[14px] border-border-strong bg-surface-base/88 px-3 py-2"
          placeholder={isCreate ? 'Design a B2B AI incident response platform with RBAC, approvals, and evidence logs.' : 'Add deployment rollback verification and expose failed checks in the pipeline rail.'}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        <Button disabled={!trimmed || disabled || busy} loading={busy} onClick={submit} className="h-11 shrink-0 rounded-full px-5">
          <Sparkles className="h-4 w-4" />
          {isCreate ? 'Launch' : 'Execute'}
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex max-w-full items-center gap-1.5 overflow-x-auto pb-0.5 [scrollbar-width:thin]">
          {quickCommands.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCommand(item)}
              className="inline-flex shrink-0 items-center gap-1 rounded-full border border-border-muted bg-surface-tint/65 px-2 py-0.5 text-label-s text-text-secondary transition-colors duration-160 ease-ledger hover:border-border-strong hover:text-text-primary"
            >
              <WandSparkles className="h-3 w-3" />
              {item}
            </button>
          ))}
        </div>
        <div className="flex w-full items-center justify-between gap-2 md:w-auto md:justify-end">
          <p className="inline-flex items-center gap-1.5 text-label-s text-text-muted">
            <CornerDownLeft className="h-3.5 w-3.5" /> Ctrl+Enter
          </p>
        </div>
      </div>
    </section>
  );
}
