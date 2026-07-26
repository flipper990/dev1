import type { ReactNode } from 'react';
import { Toast } from '../../../components/feedback';
import { CommandDock } from './CommandDock';
import { WorkspaceTabs, type WorkspaceTabId } from './WorkspaceTabs';

interface WorkspaceMainPanelProps {
  selectedProjectId: string | null;
  commandBusy: boolean;
  onCommandSubmit: (command: string) => void;
  activeTab: WorkspaceTabId;
  onTabChange: (tab: WorkspaceTabId) => void;
  tabContent: ReactNode;
  retryingPreview: boolean;
}

export function WorkspaceMainPanel({
  selectedProjectId,
  commandBusy,
  onCommandSubmit,
  activeTab,
  onTabChange,
  tabContent,
  retryingPreview,
}: WorkspaceMainPanelProps) {
  return (
    <div className="space-y-3">
      <section className="overflow-hidden rounded-[var(--radius-panel)] border border-border-muted bg-surface-base">
        <header className="px-2 pt-1 sm:px-3">
          <WorkspaceTabs value={activeTab} onChange={onTabChange} />
        </header>
        <section role="tabpanel" id={`${activeTab}-panel`} aria-labelledby={`${activeTab}-tab`} className="min-w-0 p-2.5 sm:p-3">
          {tabContent}
        </section>
      </section>

      {!selectedProjectId ? <div className="lg:sticky lg:bottom-[calc(var(--safe-bottom)+10px)] lg:z-20"><CommandDock projectId={null} mode="create" busy={commandBusy} onSubmit={onCommandSubmit} /></div> : null}

      {retryingPreview ? <Toast tone="retrying" title="Starting preview" message="Preparing the runtime and refreshing project status." /> : null}
      {commandBusy ? <Toast tone="info" title="Request submitted" message="The project is being updated. Progress appears in the context panel." /> : null}
    </div>
  );
}
