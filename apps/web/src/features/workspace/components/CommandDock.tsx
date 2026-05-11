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
    <section aria-label="Command dock" className="rounded-[var(--radius-panel)] border border-border-muted bg-surface-base p-3 shadow-hairline">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-label-s uppercase tracking-[0.16em] text-text-muted">Command dock</p>
          <h3 className="mt-0.5 text-label-m text-text-primary">{isCreate ? 'Create a software artifact' : 'Submit a scoped change request'}</h3>
          <p className="mt-0.5 max-w-2xl text-label-s text-text-secondary">
            {isCreate
              ? 'Describe the application foundation to generate.'
              : 'Request specific behavior, data model, UI, or integration changes.'}
          </p>
        </div>
        {projectId ? (
          <span className="max-w-[260px] truncate rounded-[var(--radius-control)] border border-border-muted bg-surface-tint px-2 py-1 font-mono text-mono-s text-text-secondary">
            {projectId}
          </span>
        ) : null}
      </div>

      <div className="mt-3">
        <label htmlFor="workspace-command" className="sr-only">Change request</label>
        <Textarea
          id="workspace-command"
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          rows={2}
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

      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
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
