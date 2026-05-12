'use client';

import { useState } from 'react';
import { Copy } from 'lucide-react';
import type { GeneratedProject } from '../../../../types/dashboard';
import { Button, Panel } from '../../../../components/ui';
import type { UnifiedProjectStatus } from '../../projects/model';
import { derivePreviewTruth, type PreviewTruthModel } from '../../preview/model';

interface DiagnosticsSummaryProps {
  project: GeneratedProject | null;
  status: UnifiedProjectStatus;
  previewTruth?: PreviewTruthModel;
  onOpenLogs: () => void;
  onRetryPreview: () => void;
  retrying?: boolean;
}

function verdictLabel(value: string | undefined) {
  if (!value) return 'Pending';
  return value === 'pass' || value === 'passed' ? 'Passed' : value === 'fail' || value === 'failed' ? 'Failed' : value;
}

function compact(items: Array<string | null | undefined>) {
  return items.map((item) => item?.trim()).filter((item): item is string => Boolean(item));
}

function collectDependencyEvidence(project: GeneratedProject | null) {
  const preview = project?.preview;
  const affectedModule = preview?.overlayDetection?.affectedModule;
  const dependencyFixes = preview?.dependencyFixes?.map((fix) => `${fix.packageName}@${fix.version} added to ${fix.packageJson} (${fix.reason})`) ?? [];
  const buildErrors = project?.executionValidation?.buildErrors?.filter((error) => /dependency|module|resolve|ERESOLVE|Cannot find|Can't resolve|Module not found/i.test(error)) ?? [];
  const previewError = /dependency|module|resolve|ERESOLVE|Cannot find|Can't resolve|Module not found/i.test(preview?.previewError ?? '') ? preview?.previewError : null;
  return compact([
    affectedModule ? `Affected module: ${affectedModule}` : null,
    previewError,
    ...buildErrors,
    ...dependencyFixes,
  ]);
}

function collectRuntimeErrors(project: GeneratedProject | null) {
  const preview = project?.preview;
  return compact([
    preview?.overlayDetection?.detectedErrorMessage,
    preview?.previewError,
    preview?.previewRuntimeLog?.stderrTail,
    ...(project?.executionValidation?.runtimeErrors ?? []),
    ...(project?.runtimeValidation?.issues ?? []).map((issue) => `${issue.category}: ${issue.message}${issue.hint ? ` (${issue.hint})` : ''}`),
  ]);
}

function collectCommands(project: GeneratedProject | null, truth: PreviewTruthModel) {
  const runtimeLog = project?.preview?.previewRuntimeLog;
  const runtime = project?.preview?.previewRuntime;
  return compact([
    runtime === 'docker' || runtime === 'fullstack' ? 'docker build -f Dockerfile.preview .' : 'npm install',
    project?.preview?.previewStep?.includes('building') ? project.preview.previewStep : null,
    runtimeLog?.cmd ? `start: ${runtimeLog.cmd}` : 'start: npm run dev',
    runtimeLog?.cwd ? `cwd: ${runtimeLog.cwd}` : null,
    `reproduce: ${truth.reproduceCommand}`,
  ]);
}

function collectTail(project: GeneratedProject | null, kind: 'stdout' | 'stderr') {
  const preview = project?.preview;
  const runtimeTail = kind === 'stdout' ? preview?.previewRuntimeLog?.stdoutTail : preview?.previewRuntimeLog?.stderrTail;
  const timelineTail = preview?.timeline?.slice().reverse().find((event) => (kind === 'stdout' ? event.stdoutTail : event.stderrTail));
  return runtimeTail ?? (kind === 'stdout' ? timelineTail?.stdoutTail : timelineTail?.stderrTail) ?? null;
}

function EvidenceList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return (
    <section className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
      <h4 className="text-label-m text-text-primary">{title}</h4>
      {items.length ? (
        <ul className="mt-2 space-y-2">
          {items.slice(0, 5).map((item, index) => (
            <li key={`${title}-${index}`} className="rounded-[var(--radius-control)] border border-border-muted bg-surface-raised p-2 font-mono text-mono-s text-text-secondary">
              {item}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-body-s text-text-secondary">{empty}</p>
      )}
    </section>
  );
}

export function DiagnosticsSummary({ project, status, previewTruth, onOpenLogs, onRetryPreview, retrying = false }: DiagnosticsSummaryProps) {
  const [copied, setCopied] = useState(false);
  const preview = project?.preview;
  const truth = previewTruth ?? derivePreviewTruth(project);
  const runtimeVerdict = verdictLabel(project?.runtimeValidation?.finalVerdict ?? project?.runtimeValidation?.status);
  const executionVerdict = verdictLabel(project?.executionValidation?.finalVerdict ?? project?.executionValidation?.status);
  const dependencyEvidence = collectDependencyEvidence(project);
  const runtimeErrors = collectRuntimeErrors(project);
  const commands = collectCommands(project, truth);
  const stdoutTail = collectTail(project, 'stdout');
  const stderrTail = collectTail(project, 'stderr');
  const probeAttempts = preview?.probeAttempts ?? [];
  const executionProbes = project?.executionValidation?.httpProbes ?? [];
  const hasFailure =
    truth.isFailure
    || truth.isBroken
    || status.key === 'preview-failed'
    || project?.status === 'failed'
    || project?.verificationStatus === 'failed';

  const copyReproduce = async () => {
    try {
      await navigator.clipboard.writeText(truth.reproduceCommand);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
    }
  };

  return (
    <Panel
      title="Diagnostics and runtime evidence"
      subtitle="Technical evidence only. Lifecycle, transport, and health statuses are summarized above."
      actions={<Button variant="secondary" size="sm" onClick={onOpenLogs}>Open logs</Button>}
    >
      <div className="grid gap-3 lg:grid-cols-2">
        <section className="rounded-[var(--radius-control)] border border-border-muted bg-surface-base p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-s text-text-muted">Runtime details</p>
          </div>
          <dl className="mt-3 grid gap-2 text-body-s sm:grid-cols-2">
            <div><dt className="text-text-muted">projectStatus</dt><dd className="font-mono text-mono-s text-text-primary">{project?.projectStatus ?? truth.projectStatus}</dd></div>
            <div><dt className="text-text-muted">verificationStatus</dt><dd className="font-mono text-mono-s text-text-primary">{project?.verificationStatus ?? 'pending'}</dd></div>
            <div><dt className="text-text-muted">previewTransportStatus</dt><dd className="font-mono text-mono-s text-text-primary">{truth.previewTransportStatus}</dd></div>
            <div><dt className="text-text-muted">previewHealthStatus</dt><dd className="font-mono text-mono-s text-text-primary">{truth.previewHealthStatus}</dd></div>
            <div><dt className="text-text-muted">runtime</dt><dd className="font-mono text-mono-s text-text-primary">{truth.runtimeType ?? 'unknown'}</dd></div>
            <div><dt className="text-text-muted">runtime verdict</dt><dd className="font-mono text-mono-s text-text-primary">{runtimeVerdict}</dd></div>
            <div><dt className="text-text-muted">execution verdict</dt><dd className="font-mono text-mono-s text-text-primary">{executionVerdict}</dd></div>
          </dl>
          {truth.exactReason ? <p className="mt-3 rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-2 font-mono text-mono-s text-text-secondary">{truth.exactReason}</p> : null}
          {truth.contradictions.length ? (
            <ul className="mt-3 space-y-2 text-body-s text-status-warning">
              {truth.contradictions.map((item) => <li key={item}>{item}</li>)}
            </ul>
          ) : null}
        </section>

        <section className="rounded-[var(--radius-control)] border border-border-muted bg-surface-base p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-label-s text-text-muted">Reproduce locally</p>
            <Button variant="secondary" size="sm" onClick={copyReproduce}><Copy className="h-4 w-4" />{copied ? 'Copied' : 'Copy'}</Button>
          </div>
          <p className="mt-3 break-all font-mono text-mono-s text-text-primary">{truth.reproduceCommand}</p>
          {hasFailure ? <Button className="mt-3" variant="secondary" size="sm" loading={retrying} onClick={onRetryPreview}>Retry preview</Button> : null}
        </section>

        <EvidenceList title="Dependency evidence" items={dependencyEvidence} empty="No dependency errors or fixes were reported." />
        <EvidenceList title="Runtime errors" items={runtimeErrors} empty="No framework or runtime errors were reported." />
        <EvidenceList title="Install / build / start commands" items={commands} empty="No command evidence was captured." />

        <section className="rounded-[var(--radius-control)] border border-border-muted bg-surface-tint p-3">
          <h4 className="text-label-m text-text-primary">HTTP probe history</h4>
          {probeAttempts.length || executionProbes.length ? (
            <ul className="mt-2 space-y-2">
              {probeAttempts.slice(-6).map((probe, index) => (
                <li key={`probe-${probe.at}-${index}`} className="rounded-[var(--radius-control)] border border-border-muted bg-surface-raised p-2 font-mono text-mono-s text-text-secondary">
                  {probe.method} {probe.url} - {probe.outcome} - {probe.status ?? 'no status'} - {probe.durationMs}ms
                </li>
              ))}
              {executionProbes.slice(-4).map((probe, index) => (
                <li key={`execution-probe-${probe.path}-${index}`} className="rounded-[var(--radius-control)] border border-border-muted bg-surface-raised p-2 font-mono text-mono-s text-text-secondary">
                  GET {probe.path} - {probe.ok ? 'ok' : 'failed'} - {probe.status ?? 'no status'} - {probe.durationMs}ms
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-body-s text-text-secondary">No HTTP probe attempts were captured.</p>
          )}
        </section>

        <EvidenceList title="stdout tail" items={stdoutTail ? [stdoutTail] : []} empty="No stdout tail was captured." />
        <EvidenceList title="stderr tail" items={stderrTail ? [stderrTail] : []} empty="No stderr tail was captured." />
      </div>
    </Panel>
  );
}
