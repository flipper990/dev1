import type { GeneratedProject } from '../../../../types/dashboard';
import { Button, Panel } from '../../../../components/ui';
import { derivePreviewTruth } from '../../preview/model';

interface ExportActionPanelProps {
  project: GeneratedProject | null;
  completionBlocked?: boolean;
  exporting?: boolean;
  onExport: () => void;
}

export function ExportActionPanel({ project, completionBlocked = false, exporting = false, onExport }: ExportActionPanelProps) {
  const previewTruth = derivePreviewTruth(project);
  const canExport = Boolean(project && project.status === 'completed' && previewTruth.isHealthy && !completionBlocked);

  return (
    <Panel title="Export / Launch" subtitle="Download the generated source package or continue launch preparation.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <dl className="grid gap-2 text-body-s text-text-secondary sm:grid-cols-2">
          <div><dt className="text-label-s text-text-muted">Build state</dt><dd className="mt-1 text-text-primary">{project?.status ?? 'No project'}</dd></div>
          <div><dt className="text-label-s text-text-muted">Preview evidence</dt><dd className="mt-1 text-text-primary">{previewTruth.label}</dd></div>
          <div><dt className="text-label-s text-text-muted">Completion gate</dt><dd className="mt-1 text-text-primary">{completionBlocked ? 'Blocked' : 'Open'}</dd></div>
          <div><dt className="text-label-s text-text-muted">Source package</dt><dd className="mt-1 text-text-primary">{canExport ? 'Ready to download' : 'Waiting for required evidence'}</dd></div>
        </dl>
        <Button onClick={onExport} loading={exporting} disabled={!canExport || exporting}>
          Download source
        </Button>
      </div>
    </Panel>
  );
}
