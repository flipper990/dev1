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
      title="AI Engineering Runtime"
      subtitle="Persistent operational workspace for build orchestration, evidence, runtime verification, and shipping."
      breadcrumbs={[{ label: 'Workspace', href: '/workspace' }, selectedProjectId ? { label: selectedProjectId } : { label: 'No project selected' }]}
      actions={<Button onClick={onPrimaryAction} disabled={!canAct} className="rounded-full">{nextActionLabel}</Button>}
      secondaryActions={<Link href="/projects"><Button variant="secondary" className="rounded-full">Projects</Button></Link>}
      workspaceName="DEVteam Command"
      projectName={selectedProjectName}
      compactHeader
      contextTitle="Agent Pipeline"
      contextDescription="Live execution graph, runtime checks, and verification stream."
      contextContent={pipelineContent}
    >
      <section aria-live="polite" className="sr-only">{liveMessage}</section>
      {children}
    </AppShell>
  );
}
