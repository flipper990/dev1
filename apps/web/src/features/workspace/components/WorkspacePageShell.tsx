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
  pipelineContent: ReactNode;
  children: ReactNode;
}

export function WorkspacePageShell({
  selectedProjectId,
  selectedProjectName,
  nextActionLabel,
  canAct,
  onPrimaryAction,
  liveMessage,
  pipelineContent,
  children,
}: WorkspacePageShellProps) {
  return (
    <AppShell
      title={selectedProjectName || 'Project workspace'}
      subtitle="Review the app, inspect source, investigate issues, and make changes."
      breadcrumbs={[{ label: 'Projects', href: '/projects' }, selectedProjectId ? { label: selectedProjectName || selectedProjectId } : { label: 'Workspace' }]}
      actions={<Button onClick={onPrimaryAction} disabled={!canAct}>{nextActionLabel}</Button>}
      secondaryActions={<Link href="/projects"><Button variant="ghost">Projects</Button></Link>}
      workspaceName="DEVteam"
      projectName={selectedProjectName}
      compactHeader
      contextTitle="AI workspace"
      contextDescription="Requests, agent activity, revisions, and results."
      contextContent={pipelineContent}
    >
      <section aria-live="polite" className="sr-only">{liveMessage}</section>
      {children}
    </AppShell>
  );
}
