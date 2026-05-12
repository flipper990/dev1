import Link from 'next/link';
import type { ReactNode } from 'react';
import { AppShell } from '../../../components/shell';
import { Button } from '../../../../components/ui';

interface WorkspacePageShellProps {
  selectedProjectId: string | null;
  selectedProjectName?: string;
  nextActionLabel: string;
  canAct: boolean;
  onPrimaryAction: () => void;
  liveMessage: string;
  children: ReactNode;
}

export function WorkspacePageShell({
  selectedProjectId,
  selectedProjectName,
  nextActionLabel,
  canAct,
  onPrimaryAction,
  liveMessage,
  children,
}: WorkspacePageShellProps) {
  return (
    <AppShell
      title="Workspace / Builder"
      subtitle="Preview, change, verify, and export generated applications."
      breadcrumbs={[{ label: 'Workspace', href: '/workspace' }, selectedProjectId ? { label: selectedProjectId } : { label: 'No project selected' }]}
      actions={<Button onClick={onPrimaryAction} disabled={!canAct}>{nextActionLabel}</Button>}
      secondaryActions={<Link href="/projects"><Button variant="secondary">Projects</Button></Link>}
      workspaceName="DEVteam Studio"
      projectName={selectedProjectName}
      compactHeader
    >
      <section aria-live="polite" className="sr-only">{liveMessage}</section>
      {children}
    </AppShell>
  );
}
