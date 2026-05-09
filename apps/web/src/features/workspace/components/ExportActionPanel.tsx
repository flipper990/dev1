import type { GeneratedProject } from '../../../../types/dashboard';
import { Badge, Button, Panel, StatusDot } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../../projects/model';
import { derivePreviewTruth, previewToneToStatusDot } from '../../preview/model';

interface ExportActionPanelProps {
  project: GeneratedProject | null;
  status: UnifiedProjectStatus;
  completionBlocked?: boolean;
  exporting?: boolean;
  onExport: () => void;
}

export function ExportActionPanel({ project, status, completionBlocked = false, exporting = false, onExport }: ExportActionPanelProps) {
  const previewTruth = derivePreviewTruth(project);
  const canExport = Boolean(project && project.status === 'completed' && previewTruth.isHealthy && !completionBlocked);

  return (
    <Panel title="Export / Launch" subtitle="Download the generated source package or continue launch preparation.">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
        <div className="space-y-3">
          <StatusDot tone={project?.status === 'completed' ? 'success' : project?.status === 'failed' ? 'error' : 'neutral'} label={`Build: ${project?.status ?? 'No project'}`} />
          <StatusDot tone={previewToneToStatusDot(previewTruth.tone)} label={`Preview: ${previewTruth.label}`} />
          <StatusDot tone={canExport ? 'success' : 'warning'} label={canExport ? 'Source package ready' : 'Export waits for build and validation evidence'} />
          {completionBlocked ? <Badge variant="warning">Completion gate blocked</Badge> : null}
        </div>
        <Button onClick={onExport} loading={exporting} disabled={!canExport || exporting}>
          Download source
        </Button>
      </div>
    </Panel>
  );
}
