'use client';

import { useEffect, useState } from 'react';
import { CornerDownLeft } from 'lucide-react';
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

  const submit = () => {
    if (!trimmed || disabled || busy) return;
    onSubmit(trimmed);
    setCommand('');
  };

  return (
    <section aria-label="Command dock" className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-4 shadow-card sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-label-s uppercase tracking-[0.16em] text-text-muted">Command dock</p>
          <h3 className="mt-1 text-title-s text-text-primary">{isCreate ? 'Create a software artifact' : 'Submit a scoped change request'}</h3>
          <p className="mt-1 max-w-2xl text-body-s text-text-secondary">
            {isCreate
              ? 'Describe the application foundation to generate. DEVteam will create a project record before building.'
              : 'Request changes to this selected project. Keep the instruction specific to product behavior, data model, UI, or integration work.'}
          </p>
        </div>
        {projectId ? (
          <span className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint px-2 py-1 font-mono text-mono-s text-text-secondary">
            {projectId}
          </span>
        ) : null}
      </div>

      <div className="mt-4">
        <label htmlFor="workspace-command" className="sr-only">Change request</label>
        <Textarea
          id="workspace-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          rows={4}
          disabled={disabled || busy}
          placeholder={isCreate ? 'Example: Generate a multi-tenant booking platform with admin scheduling, customer accounts, payments, and PostgreSQL.' : 'Example: Add an owner dashboard with booking status filters and exportable CSV reports.'}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-1.5 text-label-s text-text-muted">
          <CornerDownLeft className="h-3.5 w-3.5" /> Ctrl+Enter submits. This is not a general chat surface.
        </p>
        <Button disabled={!trimmed || disabled || busy} loading={busy} onClick={submit}>
          {isCreate ? 'Create project' : 'Submit change request'}
        </Button>
      </div>
    </section>
  );
}
