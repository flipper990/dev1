'use client';

import { useState } from 'react';
import { Button, Textarea } from '../../../../components/ui';

interface ProjectCommandDockProps {
  busy?: boolean;
  placeholder?: string;
  onSubmit?: (command: string) => void;
}

export function ProjectCommandDock({
  busy = false,
  placeholder = 'Describe the change to make in this project workspace.',
  onSubmit,
}: ProjectCommandDockProps) {
  const [command, setCommand] = useState('');

  return (
    <section aria-label="Command dock" className="rounded-[var(--radius-modal)] border border-border bg-surface-raised p-4">
      <h3 className="text-title-s text-ink">Command dock</h3>
      <p className="mt-1 text-body-s text-secondary">Issue precise production commands for this project.</p>
      <div className="mt-3">
        <Textarea
          value={command}
          onChange={(event) => setCommand(event.target.value)}
          rows={4}
          placeholder={placeholder}
          onKeyDown={(event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter' && command.trim()) {
              event.preventDefault();
              onSubmit?.(command.trim());
            }
          }}
        />
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-label-s text-secondary">Press Ctrl+Enter to submit</p>
        <Button disabled={!command.trim() || busy} loading={busy} onClick={() => onSubmit?.(command.trim())}>
          Execute command
        </Button>
      </div>
    </section>
  );
}
