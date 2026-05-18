import { ChevronDown } from 'lucide-react';
import type { ReactNode } from 'react';
import { Toast } from '../../../components/feedback';
import type { GeneratedProject } from '../../../../types/dashboard';
import type { PreviewTruthModel } from '../../preview/model';
import { PreviewCanvasFrame } from '../../preview/components';
import { CommandDock } from './CommandDock';
import { WorkspaceTabs, type WorkspaceTabId } from './WorkspaceTabs';

type PreviewDevice = 'desktop' | 'tablet' | 'mobile';

interface WorkspaceMainPanelProps {
  selectedProject: GeneratedProject | null;
  selectedProjectId: string | null;
  previewTruth: PreviewTruthModel;
  previewKey: string;
  previewDevice: PreviewDevice;
  onPreviewDeviceChange: (device: PreviewDevice) => void;
  previewUrl: string | undefined;
  previewBound: boolean;
  onRetryPreview: (() => void) | undefined;
  retryingPreview: boolean;
  commandBusy: boolean;
  onCommandSubmit: (command: string) => void;
  evidenceOpen: boolean;
  onEvidenceToggle: () => void;
  activeTab: WorkspaceTabId;
  onTabChange: (tab: WorkspaceTabId) => void;
  tabContent: ReactNode;
}

export function WorkspaceMainPanel({
  selectedProject,
  selectedProjectId,
  previewTruth,
  previewKey,
  previewDevice,
  onPreviewDeviceChange,
  previewUrl,
  previewBound,
  onRetryPreview,
  retryingPreview,
  commandBusy,
  onCommandSubmit,
  evidenceOpen,
  onEvidenceToggle,
  activeTab,
  onTabChange,
  tabContent,
}: WorkspaceMainPanelProps) {
  return (
    <div className="space-y-4 sm:space-y-5">
      <PreviewCanvasFrame
        key={previewKey}
        title="Generated application"
        ready={Boolean(previewBound && previewTruth.isHealthy)}
        failed={Boolean(previewBound && previewTruth.isFailure)}
        loading={Boolean(previewBound && previewTruth.isLoading)}
        url={previewUrl}
        message={selectedProject ? 'Preview output will appear here after the selected project runtime is healthy.' : 'Select or create a project to generate a preview.'}
        device={previewDevice}
        onDeviceChange={onPreviewDeviceChange}
        previewTruth={previewTruth}
        onRetry={onRetryPreview}
        retrying={retryingPreview}
      />

      <section className="studio-surface-soft rounded-[var(--radius-panel)]">
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left focus-visible:shadow-[var(--focus-ring)] focus-visible:outline-none sm:px-5"
          aria-expanded={evidenceOpen}
          aria-controls="workspace-evidence-panel"
          onClick={onEvidenceToggle}
        >
          <span className="min-w-0">
            <span className="block text-label-m text-text-primary">Evidence deck, logs, and launch controls</span>
            <span className="mt-0.5 block text-body-s text-text-secondary">
              Secondary operational details stay collapsible to keep runtime output as the dominant visual stage.
            </span>
          </span>
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-text-muted transition-transform duration-160 ease-ledger ${evidenceOpen ? 'rotate-180' : ''}`}
            aria-hidden="true"
          />
        </button>

        {evidenceOpen ? (
          <div id="workspace-evidence-panel" className="space-y-4 border-t border-border-muted p-4 sm:p-5">
            <WorkspaceTabs value={activeTab} onChange={onTabChange} />
            <section role="tabpanel" id={`${activeTab}-panel`} aria-labelledby={`${activeTab}-tab`} className="min-w-0">
              {tabContent}
            </section>
          </div>
        ) : null}
      </section>

      <div className="mt-1 lg:sticky lg:bottom-[calc(var(--safe-bottom)+10px)] lg:z-20">
        <CommandDock
          projectId={selectedProjectId}
          mode={selectedProjectId && selectedProject ? 'change' : 'create'}
          busy={commandBusy}
          onSubmit={onCommandSubmit}
        />
      </div>

      {retryingPreview ? <Toast tone="retrying" title="Preview in progress" message="Starting runtime and refreshing project evidence." /> : null}
      {commandBusy ? <Toast tone="info" title="Command submitted" message="Clearing stale preview state and waiting for backend project evidence." /> : null}
    </div>
  );
}
