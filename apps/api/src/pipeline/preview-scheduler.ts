import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import { validateAndAutoFix } from './auto-fix.js';
import type { ProjectRecord, ProjectStore } from '../storage/project-store.js';
import type { PreviewManager } from '../preview/preview-manager.js';
import type { ProjectUpdater } from './project-updater.js';

type VerificationLifecycle = 'pending' | 'running' | 'passed' | 'failed' | 'warning';

function deriveVerificationLifecycle(
  executionStatus: VerificationLifecycle | undefined,
  runtimeStatus: VerificationLifecycle | undefined,
): VerificationLifecycle {
  if (executionStatus === 'failed' || runtimeStatus === 'failed') return 'failed';
  if (executionStatus === 'warning' || runtimeStatus === 'warning') return 'warning';
  if (executionStatus === 'running' || runtimeStatus === 'running') return 'running';
  if (executionStatus === 'passed' && runtimeStatus === 'passed') return 'passed';
  return 'pending';
}

export interface BuildPreviewArtifactsOptions {
  sanitizeSnippet: (input: string | null | undefined, maxChars?: number) => string | null;
  looksPlaceholderText: (input: string | null | undefined) => boolean;
  hasFrameworkOverlaySignals: (input: string | null | undefined) => boolean;
}

export function buildPreviewValidationArtifacts(
  rec: ProjectRecord,
  options: BuildPreviewArtifactsOptions,
) {
  const { sanitizeSnippet, looksPlaceholderText, hasFrameworkOverlaySignals } = options;
  const preview = (rec.preview ?? null) as ProjectRecord['preview'] | null;
  const timeline = Array.isArray(preview?.timeline) ? preview.timeline : [];
  const transitionEvents = timeline
    .filter((ev) => typeof ev?.at === 'string' && typeof ev?.previewStatus === 'string')
    .map((ev) => ({ at: ev.at, previewStatus: ev.previewStatus, event: ev.event }));

  const readinessProbes = (Array.isArray(preview?.probeAttempts) ? preview.probeAttempts : []).map((probe) => ({
    source: 'preview-readiness' as const,
    at: typeof probe.at === 'string' ? probe.at : null,
    method: probe.method === 'HEAD' ? 'HEAD' as const : 'GET' as const,
    path: (() => {
      try {
        if (typeof probe.url !== 'string') return '/';
        const u = new URL(probe.url);
        return u.pathname || '/';
      } catch {
        return '/';
      }
    })(),
    status: typeof probe.status === 'number' ? probe.status : null,
    ok: probe.ok === true,
    durationMs: typeof probe.durationMs === 'number' ? probe.durationMs : 0,
    error: probe.errorMessage ?? undefined,
  }));

  const executionProbes = (Array.isArray(rec.executionValidation?.httpProbes) ? rec.executionValidation?.httpProbes : []).map((probe) => ({
    source: 'execution-validator' as const,
    at: rec.executionValidation?.completedAt ?? null,
    method: 'GET' as const,
    path: probe.path,
    status: typeof probe.status === 'number' ? probe.status : null,
    ok: probe.ok === true,
    durationMs: typeof probe.durationMs === 'number' ? probe.durationMs : 0,
    error: probe.error,
  }));

  const routeProbes = [...readinessProbes, ...executionProbes];
  const statusCounts: Record<string, number> = {};
  for (const probe of routeProbes) {
    const key = probe.status == null ? 'null' : String(probe.status);
    statusCounts[key] = (statusCounts[key] ?? 0) + 1;
  }

  const stepResults = (rec.executionValidation?.details as {
    steps?: Array<{ step: 'install' | 'build' | 'dev' | 'typecheck'; ran: boolean; ok: boolean; exitCode: number | null; timedOut: boolean; durationMs: number; errors: string[] }>;
  } | undefined)?.steps ?? [];
  const install = stepResults.find((s) => s.step === 'install');
  const build = stepResults.find((s) => s.step === 'build');
  const dev = stepResults.find((s) => s.step === 'dev');
  const mapStep = (step: typeof install) => ({
    ran: step?.ran === true,
    ok: typeof step?.ok === 'boolean' ? step.ok : null,
    exitCode: typeof step?.exitCode === 'number' ? step.exitCode : null,
    timedOut: typeof step?.timedOut === 'boolean' ? step.timedOut : null,
    durationMs: typeof step?.durationMs === 'number' ? step.durationMs : null,
    errors: Array.isArray(step?.errors) ? step!.errors.slice(0, 12) : [],
  });

  const runtimeSample = sanitizeSnippet((rec.runtimeValidation as { details?: { bodySample?: string } } | undefined)?.details?.bodySample ?? null);
  const executionSample = sanitizeSnippet((rec.executionValidation?.details as { probeBodySample?: string } | undefined)?.probeBodySample ?? null);
  const bodySample = runtimeSample ?? executionSample;
  const bodySource: 'runtime-validator' | 'execution-validator' | null = runtimeSample ? 'runtime-validator' : (executionSample ? 'execution-validator' : null);

  const placeholderBlockers = rec.qaAssurance?.blockers?.filter((b) => b.bar === 'no-placeholders').map((b) => b.message).slice(0, 8) ?? [];
  const qaPlaceholderFailed = rec.qaAssurance?.bars?.['no-placeholders']?.passed === false;
  const sampleLooksPlaceholder = looksPlaceholderText(bodySample);
  const placeholderDetection = {
    detected: qaPlaceholderFailed || placeholderBlockers.length > 0 || sampleLooksPlaceholder,
    source: qaPlaceholderFailed || placeholderBlockers.length > 0 ? ('qa-assurance' as const) : (sampleLooksPlaceholder ? ('runtime-sample' as const) : ('unknown' as const)),
    details: placeholderBlockers.length > 0 ? placeholderBlockers : (sampleLooksPlaceholder ? ['Body sample contains placeholder markers.'] : []),
  };

  const depErrors = Array.from(new Set([
    ...(rec.executionValidation?.buildErrors ?? []),
    ...(rec.executionValidation?.runtimeErrors ?? []),
    ...(rec.runtimeValidation?.issues ?? []).map((i) => i.message),
  ].filter((line) => /Cannot find module|Module not found|Can'?t resolve|missing package/i.test(line)))).slice(0, 20);

  const runtimeType = (() => {
    const raw = preview?.previewRuntime;
    if (raw === 'docker' || raw === 'local' || raw === 'local-fallback' || raw === 'fullstack') return raw;
    return raw ? 'unknown' : null;
  })();

  return {
    schemaVersion: 1 as const,
    updatedAt: new Date().toISOString(),
    runtimeType,
    routeProbes,
    httpStatusResults: { total: routeProbes.length, ok: routeProbes.filter((p) => p.ok).length, failed: routeProbes.filter((p) => !p.ok).length, byStatus: statusCounts },
    previewStatusTransitions: transitionEvents,
    sanitizedStreams: {
      capturedAt: preview?.previewRuntimeLog?.capturedAt ?? null,
      stdoutSnippet: sanitizeSnippet(preview?.previewRuntimeLog?.stdoutTail ?? null),
      stderrSnippet: sanitizeSnippet(preview?.previewRuntimeLog?.stderrTail ?? null),
    },
    dependencyErrors: depErrors,
    packageInstallResult: mapStep(install),
    buildResult: mapStep(build),
    devServerResult: mapStep(dev),
    bodySampleSummary: {
      source: bodySource,
      sampleChars: bodySample?.length ?? 0,
      snippet: bodySample,
      looksPlaceholder: looksPlaceholderText(bodySample),
      hasFrameworkOverlaySignals: hasFrameworkOverlaySignals(bodySample),
    },
    placeholderDetection,
    frameworkErrorOverlayDetection: {
      detected: !!preview?.overlayDetection,
      detectedErrorType: preview?.overlayDetection?.detectedErrorType,
      detectedErrorMessage: preview?.overlayDetection?.detectedErrorMessage,
      affectedModule: preview?.overlayDetection?.affectedModule,
      detectedAt: preview?.overlayDetection?.detectedAt,
    },
  };
}

export function scheduleRuntimeValidation(args: {
  project: ProjectRecord;
  previewManager?: PreviewManager;
  updater: ProjectUpdater;
  projectStore: ProjectStore;
  logger: Logger;
  apiBaseUrl: string;
  startFinalizeStep: (project: ProjectRecord, step: string) => Promise<number>;
  completeFinalizeStep: (project: ProjectRecord, step: string, startedAt: number, details?: Record<string, unknown>) => Promise<number>;
  buildArtifacts: (project: ProjectRecord) => unknown;
}): void {
  const { project, previewManager, updater, projectStore, logger, apiBaseUrl, startFinalizeStep, completeFinalizeStep, buildArtifacts } = args;
  const pm = previewManager;
  if (!pm || !pm.isDockerAvailable()) {
    logger.info('Skipping runtime validation', {
      projectId: project.id,
      reason: !pm ? 'preview-manager-not-wired' : 'docker-unavailable',
    });
    void projectStore.update(project.id, (rec) => {
      rec.runtimeValidation = {
        status: 'warning',
        finalVerdict: 'fail',
        iterations: 0,
        issues: [{ category: 'runtime-validation', message: 'Runtime validation skipped because Docker preview is unavailable.' }],
        totalDurationMs: 0,
        completedAt: new Date().toISOString(),
        reason: !pm ? 'preview-manager-not-wired' : 'docker-unavailable',
      };
      rec.verificationStatus = deriveVerificationLifecycle(
        rec.executionValidation?.status as VerificationLifecycle | undefined,
        rec.runtimeValidation.status,
      );
      rec.warnings = [...(rec.warnings ?? []), {
        code: 'runtime.validation-unavailable',
        message: 'Runtime validation was skipped because Docker preview is unavailable.',
        details: { reason: !pm ? 'preview-manager-not-wired' : 'docker-unavailable' },
      }];
      rec.diagnostics = rec.diagnostics ?? {};
      rec.diagnostics.previewValidationArtifacts = buildArtifacts(rec) as Record<string, unknown>;
    }, {
      phase: 'runtime-validation:skipped',
      caller: 'project-generator:scheduleRuntimeValidation',
      reason: !pm ? 'preview-manager-not-wired' : 'docker-unavailable',
    }).catch(() => {});
    return;
  }
  setImmediate(async () => {
    await projectStore.update(project.id, (rec) => {
      rec.verificationStatus = 'running';
      if (rec.runtimeValidation) rec.runtimeValidation.status = 'running';
    }, {
      phase: 'runtime-validation:running',
      caller: 'project-generator:scheduleRuntimeValidation',
      reason: 'runtime validation started',
    }).catch(() => {});

    const t0Preview = await startFinalizeStep(project, 'finalize:preview-starting');
    try {
      const summary = await validateAndAutoFix(
        project.id,
        { previewManager: pm, updater, apiBaseUrl, logger, spec: project.spec },
        { maxIterations: 3 },
      );
      const fresh = await projectStore.get(project.id);
      if (!fresh) return;
      await completeFinalizeStep(fresh, 'finalize:preview-ready', t0Preview, {
        verdict: summary.finalVerdict,
        iterations: summary.iterations.filter((i) => i.kind === 'fix').length,
        issueCount: summary.lastValidation.issues.length,
      });
      const runtimeValidation = {
        status: (summary.finalVerdict === 'pass'
          ? 'passed'
          : (fresh.preview?.previewStatus === 'ready' ? 'warning' : 'failed')) as 'passed' | 'warning' | 'failed',
        finalVerdict: summary.finalVerdict,
        iterations: summary.iterations.filter((i) => i.kind === 'fix').length,
        issues: summary.lastValidation.issues.map((i) => ({ category: i.category, message: i.message, hint: i.hint })),
        totalDurationMs: summary.totalDurationMs,
        completedAt: new Date().toISOString(),
        reason: summary.finalVerdict === 'pass'
          ? 'pass'
          : (summary.lastValidation.issues.slice(0, 3).map((i) => `[${i.category}] ${i.message}`).join('; ') || 'fail'),
        details: {
          bodySample: summary.lastValidation.bodySample ?? null,
          systemChecks: summary.lastValidation.systemChecks ?? null,
          iterations: summary.iterations.map((iter) => ({
            index: iter.index,
            kind: iter.kind,
            durationMs: iter.durationMs,
            resultVerdict: iter.result?.verdict,
            issueCount: iter.result?.issues?.length ?? 0,
          })),
        },
      };
      fresh.runtimeValidation = runtimeValidation;
      const issueWarning = summary.finalVerdict === 'fail' && runtimeValidation.status !== 'passed'
        ? {
          code: runtimeValidation.status === 'warning' ? 'runtime.validator-disagreed-with-live-preview' : 'runtime.validation-failed',
          message: runtimeValidation.status === 'warning'
            ? `Runtime validator reported issues but live preview is ready: ${runtimeValidation.reason}`
            : `Runtime validation failed: ${runtimeValidation.reason}`,
          details: {
            issues: summary.lastValidation.issues.slice(0, 6),
            iterations: runtimeValidation.iterations,
            durationMs: summary.totalDurationMs,
            previewStatus: fresh.preview?.previewStatus ?? null,
          },
        }
        : null;
      await projectStore.update(project.id, (rec) => {
        rec.runtimeValidation = runtimeValidation;
        rec.verificationStatus = deriveVerificationLifecycle(
          rec.executionValidation?.status as VerificationLifecycle | undefined,
          runtimeValidation.status,
        );
        rec.diagnostics = rec.diagnostics ?? {};
        rec.diagnostics.previewValidationArtifacts = buildArtifacts(rec) as Record<string, unknown>;
        if (issueWarning) rec.warnings = [...(rec.warnings ?? []), issueWarning];
      }, {
        phase: `runtime-validation:${runtimeValidation.status}`,
        caller: 'project-generator:scheduleRuntimeValidation',
        reason: `verdict=${summary.finalVerdict} status=${runtimeValidation.status}`,
      });
      logger.info('Runtime validation finished (project.status untouched)', {
        event: 'gen:runtime-validation:done',
        projectId: project.id,
        validatorStatus: runtimeValidation.status,
        verdict: summary.finalVerdict,
        fixes: runtimeValidation.iterations,
        issues: runtimeValidation.issues.length,
        previewStatus: fresh.preview?.previewStatus ?? null,
        durationMs: summary.totalDurationMs,
      });
    } catch (err) {
      try {
        const fresh = await projectStore.get(project.id);
        if (fresh) {
          const crashRecord = {
            status: 'failed' as const,
            finalVerdict: 'fail' as const,
            iterations: 0,
            issues: [{ category: 'unknown', message: `Validator crashed: ${String(err)}` }],
            totalDurationMs: 0,
            completedAt: new Date().toISOString(),
            reason: 'crashed',
          };
          await projectStore.update(project.id, (rec) => {
            rec.runtimeValidation = crashRecord;
            rec.verificationStatus = deriveVerificationLifecycle(
              rec.executionValidation?.status as VerificationLifecycle | undefined,
              crashRecord.status,
            );
            rec.diagnostics = rec.diagnostics ?? {};
            rec.diagnostics.previewValidationArtifacts = buildArtifacts(rec) as Record<string, unknown>;
            rec.warnings = [...(rec.warnings ?? []), {
              code: 'runtime.validator-crashed',
              message: `Runtime validator crashed: ${err instanceof Error ? err.message : String(err)}`,
              details: { reason: 'crashed' },
            }];
          }, {
            phase: 'runtime-validation:validator-crashed',
            caller: 'project-generator:scheduleRuntimeValidation',
            reason: 'runtime-validation threw',
          });
        }
      } catch (innerErr) {
        logger.error('[gen:runtime-validation:persist-failure-error] could not persist runtime-validator crash', {
          event: 'gen:runtime-validation:persist-failure-error',
          projectId: project.id,
          originalErr: err instanceof Error ? err.message : String(err),
          innerErr: innerErr instanceof Error ? innerErr.message : String(innerErr),
        });
      }
      logger.error('Runtime validation crashed (project.status untouched)', {
        projectId: project.id,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  });
}
