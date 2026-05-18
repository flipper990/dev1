import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import { runExecutionFeedbackLoop } from './execution-feedback-loop.js';
import type { ProjectRecord, ProjectStore } from '../storage/project-store.js';
import type { ProjectUpdater } from './project-updater.js';

export function scheduleExecutionValidation(args: {
  project: ProjectRecord;
  updater: ProjectUpdater;
  projectStore: ProjectStore;
  logger: Logger;
  buildArtifacts: (project: ProjectRecord) => unknown;
  scheduleRuntimeValidation: (project: ProjectRecord) => void;
}): void {
  const { project, updater, projectStore, logger, buildArtifacts, scheduleRuntimeValidation } = args;
  setImmediate(async () => {
    try {
      await projectStore.update(project.id, (rec) => {
        rec.verificationStatus = 'running';
        if (rec.executionValidation) {
          rec.executionValidation.status = 'running';
        }
      }, {
        phase: 'exec-validation:running',
        caller: 'project-generator:scheduleExecutionValidation',
        reason: 'execution validation started',
      }).catch(() => {});

      const summary = await runExecutionFeedbackLoop(
        project.id,
        { updater, projectStore, logger },
        {
          maxIterations: 3,
          runner: {
            runTypecheck: true,
            timeouts: {
              install: 180_000,
              build: 180_000,
              dev: 90_000,
            },
          },
        },
      );

      const fresh = await projectStore.get(project.id);
      if (!fresh) return;

      const lastBuildErrors = summary.lastResult.buildErrors.slice(0, 25);
      const lastRuntimeErrors = summary.lastResult.runtimeErrors.slice(0, 25);
      const fixIters = summary.iterations.filter((i) => i.kind === 'fix').length;

      const baseExecutionValidation = {
        finalVerdict: summary.finalVerdict,
        iterations: fixIters,
        buildErrors: lastBuildErrors,
        runtimeErrors: lastRuntimeErrors,
        httpProbes: summary.lastResult.httpProbes.map((p) => ({
          path: p.path, ok: p.ok, status: p.status, bodyBytes: p.bodyBytes, durationMs: p.durationMs, error: p.error,
        })),
        totalDurationMs: summary.totalDurationMs,
        completedAt: new Date().toISOString(),
        reason: summary.reason,
        details: {
          failureReasons: summary.lastResult.failureReasons.slice(0, 20),
          steps: summary.lastResult.steps.map((s) => ({
            step: s.step, ran: s.ran, ok: s.ok, exitCode: s.exitCode, timedOut: s.timedOut, durationMs: s.durationMs, errors: s.errors.slice(0, 10),
          })),
          probeBodySample: summary.lastResult.httpProbes.find((p) => !p.ok && p.bodySample)?.bodySample ?? null,
        },
      };

      const previewIsReady = fresh.preview?.previewStatus === 'ready';
      const infraFailure = summary.reason === 'updater-failed' || summary.reason === 'crashed' || summary.reason === 'no-files';
      let validatorStatus: 'passed' | 'warning' | 'failed';
      let validatorWarning: { code: string; message: string; details?: Record<string, unknown> } | null = null;
      if (summary.finalVerdict === 'pass') {
        validatorStatus = 'passed';
      } else if (previewIsReady) {
        validatorStatus = 'warning';
        validatorWarning = {
          code: 'execution.validator-disagreed-with-live-preview',
          message: `Headless execution validator failed (${summary.reason}) but the live preview is ready and reachable. Trusting the live preview; flagging the validator disagreement.`,
          details: {
            reason: summary.reason,
            iterations: fixIters,
            buildErrors: lastBuildErrors.slice(0, 6),
            runtimeErrors: lastRuntimeErrors.slice(0, 4),
            durationMs: summary.totalDurationMs,
            previewUrl: fresh.preview?.previewUrl ?? null,
          },
        };
      } else if (infraFailure) {
        validatorStatus = 'warning';
        validatorWarning = {
          code: 'execution.auto-fix-unavailable',
          message: `Execution auto-fix loop could not run (${summary.reason}). Code is generated and QA-passed; manual fixes may be needed before \`npm run dev\` succeeds.`,
          details: { reason: summary.reason, iterations: fixIters, buildErrors: lastBuildErrors.slice(0, 6), runtimeErrors: lastRuntimeErrors.slice(0, 4), durationMs: summary.totalDurationMs },
        };
      } else {
        validatorStatus = 'failed';
      }

      const executionValidation = { ...baseExecutionValidation, status: validatorStatus };
      await projectStore.update(project.id, (rec) => {
        rec.executionValidation = executionValidation;
        rec.verificationStatus = validatorStatus === 'failed' ? 'failed' : 'running';
        rec.diagnostics = rec.diagnostics ?? {};
        rec.diagnostics.previewValidationArtifacts = buildArtifacts(rec) as Record<string, unknown>;
        if (validatorWarning) rec.warnings = [...(rec.warnings ?? []), validatorWarning];
      }, {
        phase: 'exec-validation:persist-verdict',
        caller: 'project-generator:scheduleExecutionValidation',
        reason: `verdict=${summary.finalVerdict} status=${validatorStatus} reason=${summary.reason}`,
      });
      fresh.executionValidation = executionValidation;

      logger.info('Execution validation finished (project.status untouched)', {
        event: 'gen:exec-validation:done',
        projectId: project.id,
        validatorStatus,
        verdict: summary.finalVerdict,
        reason: summary.reason,
        iterations: fixIters,
        buildErrors: lastBuildErrors.length,
        runtimeErrors: lastRuntimeErrors.length,
        previewIsReady,
        durationMs: summary.totalDurationMs,
      });

      if (validatorStatus !== 'failed') {
        scheduleRuntimeValidation(fresh);
      }
    } catch (err) {
      try {
        const fresh = await projectStore.get(project.id);
        if (fresh) {
          const crashRecord = {
            status: 'failed' as const,
            finalVerdict: 'fail' as const,
            iterations: 0,
            buildErrors: [`execution-loop crashed: ${err instanceof Error ? err.message : String(err)}`],
            runtimeErrors: [] as string[],
            totalDurationMs: 0,
            completedAt: new Date().toISOString(),
            reason: 'crashed' as string,
          };
          await projectStore.update(project.id, (rec) => {
            rec.executionValidation = crashRecord;
            rec.verificationStatus = 'failed';
            rec.diagnostics = rec.diagnostics ?? {};
            rec.diagnostics.previewValidationArtifacts = buildArtifacts(rec) as Record<string, unknown>;
            rec.warnings = [...(rec.warnings ?? []), {
              code: 'execution.validator-crashed',
              message: `Execution validator crashed: ${err instanceof Error ? err.message : String(err)}`,
              details: { reason: 'crashed' },
            }];
          }, {
            phase: 'exec-validation:loop-crashed',
            caller: 'project-generator:scheduleExecutionValidation',
            reason: 'execution-validation loop threw',
          });
        }
      } catch (innerErr) {
        logger.error('[gen:exec-validation:persist-failure-error] could not persist execution-loop crash', {
          event: 'gen:exec-validation:persist-failure-error',
          projectId: project.id,
          originalErr: err instanceof Error ? err.message : String(err),
          innerErr: innerErr instanceof Error ? innerErr.message : String(innerErr),
        });
      }
      logger.error('Execution validation crashed (project.status untouched)', {
        projectId: project.id,
        err: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
    }
  });
}
