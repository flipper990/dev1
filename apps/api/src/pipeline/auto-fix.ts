// ─────────────────────────────────────────────────────────────
// Auto-fix loop — wraps the validator with a bounded retry that
// dispatches a fix-this prompt to the existing ProjectUpdater.
// Each iteration runs the full agent pipeline (spec→build→qa→polish
// is short-circuited via existing-files seeding inside the updater).
//
// Two iterations is the sweet spot: one gives the agents a chance
// to react to the diagnostic, two confirms whether the fix worked
// or whether we need to give up. Beyond that, we burn tokens for
// no benefit.
// ─────────────────────────────────────────────────────────────

import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { ProjectUpdater } from './project-updater.js';
import {
  validatePreview,
  buildAutoFixPrompt,
  type ValidatorDeps,
  type ValidationResult,
  type ValidationIssue,
} from './preview-validator.js';

export interface AutoFixDeps extends ValidatorDeps {
  updater: ProjectUpdater;
}

export interface AutoFixOptions {
  /** Maximum number of fix iterations after the initial validation. Default 2. */
  maxIterations?: number;
}

export interface AutoFixIteration {
  index: number;
  /** 'validate' = ran validator; 'fix' = ran updater with feedback prompt. */
  kind: 'validate' | 'fix';
  result?: ValidationResult;
  promptPreview?: string;
  durationMs: number;
}

export interface AutoFixSummary {
  finalVerdict: 'pass' | 'fail';
  iterations: AutoFixIteration[];
  /** Last validation result (may be pass or fail). */
  lastValidation: ValidationResult;
  totalDurationMs: number;
}

export async function validateAndAutoFix(
  projectId: string,
  deps: AutoFixDeps,
  opts: AutoFixOptions = {},
): Promise<AutoFixSummary> {
  const { logger } = deps;
  const maxIterations = opts.maxIterations ?? 2;
  const iterations: AutoFixIteration[] = [];
  const t0 = Date.now();

  logger.info('Validation: starting initial check', { projectId });
  const t1 = Date.now();
  let result = await validatePreview(projectId, deps);
  iterations.push({ index: 0, kind: 'validate', result, durationMs: Date.now() - t1 });

  logger.info('Validation: initial verdict', {
    projectId, verdict: result.verdict, issueCount: result.issues.length,
  });
  if (result.verdict === 'pass') {
    return {
      finalVerdict: 'pass',
      iterations,
      lastValidation: result,
      totalDurationMs: Date.now() - t0,
    };
  }

  for (let i = 1; i <= maxIterations; i++) {
    const prompt = buildAutoFixPrompt(result);
    const fixT0 = Date.now();
    logger.warn('Auto-fix: dispatching repair iteration', {
      projectId, iteration: i, issues: summariseIssues(result.issues),
    });

    try {
      const updateResult = await deps.updater.update({
        projectId,
        prompts: [prompt],
        scope: 'code',
        userId: 'system-auto-fix',
        runtimeFeedback: {
          issues: result.issues.map((iss) => ({
            category: iss.category,
            message: iss.message,
            hint: iss.hint,
            rootCause: iss.rootCause,
          })),
          log: result.preview?.log?.slice(-4_000),
          bodySample: result.bodySample,
          systemChecks: result.systemChecks,
        },
      });
      iterations.push({
        index: i, kind: 'fix',
        promptPreview: prompt.slice(0, 500),
        durationMs: Date.now() - fixT0,
      });
      if (!updateResult.success) {
        logger.error('Auto-fix: updater failed, aborting loop', { projectId, error: updateResult.error });
        break;
      }
    } catch (err) {
      logger.error('Auto-fix: updater threw, aborting loop', {
        projectId, err: err instanceof Error ? err.message : String(err),
      });
      iterations.push({
        index: i, kind: 'fix',
        promptPreview: prompt.slice(0, 500),
        durationMs: Date.now() - fixT0,
      });
      break;
    }

    // The updater overwrites project files on disk. We need to rebuild the
    // image so the new files actually run, not the cached layer.
    try {
      await deps.previewManager.stop(projectId);
    } catch { /* idempotent stop, ignore */ }

    const valT0 = Date.now();
    result = await validatePreview(projectId, deps);
    iterations.push({ index: i, kind: 'validate', result, durationMs: Date.now() - valT0 });
    logger.info('Validation: post-fix verdict', {
      projectId, iteration: i, verdict: result.verdict, issueCount: result.issues.length,
    });
    if (result.verdict === 'pass') break;
  }

  return {
    finalVerdict: result.verdict,
    iterations,
    lastValidation: result,
    totalDurationMs: Date.now() - t0,
  };
}

function summariseIssues(issues: ValidationIssue[]): Array<{ category: string; message: string }> {
  return issues.slice(0, 6).map((i) => ({ category: i.category, message: i.message.slice(0, 200) }));
}
