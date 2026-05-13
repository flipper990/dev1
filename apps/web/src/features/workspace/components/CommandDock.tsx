'use client';

import { useEffect, useState } from 'react';
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

  useEffect(() => {
    setCommand('');
  }, [projectId]);

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
      className="studio-glass fixed bottom-4 left-1/2 z-30 w-[min(1120px,calc(100%-1.5rem))] -translate-x-1/2 rounded-[24px] px-3 py-3 sm:bottom-5 sm:w-[min(1180px,calc(100%-2.25rem))] sm:px-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="inline-flex items-center gap-1.5 text-label-s uppercase tracking-[0.14em] text-text-muted">
            <TerminalSquare className="h-3.5 w-3.5" /> Orchestration console
          </p>
          <h3 className="mt-0.5 text-label-m text-text-primary">{isCreate ? 'Initialize a new engineering mission' : 'Direct multi-agent execution'}</h3>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-surface-tint/80 px-2 py-1 text-label-s text-text-secondary">
            <Cpu className="h-3.5 w-3.5" /> {isCreate ? 'Mode: bootstrap' : 'Mode: iterate'}
          </span>
          {projectId ? (
            <span className="max-w-[260px] truncate rounded-full border border-border-muted bg-surface-tint/80 px-2 py-1 font-mono text-mono-s text-text-secondary">
              {projectId}
            </span>
          ) : null}
        </div>
      </div>

      <div className="mt-2">
        <label htmlFor="workspace-command" className="sr-only">Change request</label>
        <Textarea
          id="workspace-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          rows={2}
          disabled={disabled || busy}
          className="resize-none rounded-[18px] border-border-strong bg-surface-base/85"
          placeholder={isCreate ? 'Design a B2B AI incident response platform with RBAC, approvals, and evidence logs.' : 'Add deployment rollback verification and expose failed checks in the pipeline rail.'}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {quickCommands.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setCommand(item)}
              className="inline-flex items-center gap-1 rounded-full border border-border-muted bg-surface-tint/65 px-2 py-1 text-label-s text-text-secondary transition-colors duration-160 ease-ledger hover:border-border-strong hover:text-text-primary"
            >
              <WandSparkles className="h-3 w-3" />
              {item}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <p className="inline-flex items-center gap-1.5 text-label-s text-text-muted">
            <CornerDownLeft className="h-3.5 w-3.5" /> Ctrl+Enter
          </p>
          <Button disabled={!trimmed || disabled || busy} loading={busy} onClick={submit} className="rounded-full px-5">
            <Sparkles className="h-4 w-4" />
            {isCreate ? 'Launch mission' : 'Execute'}
          </Button>
        </div>
      </div>
    </section>
  );
}
