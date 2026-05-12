// ─────────────────────────────────────────────────────────────
// Execution Feedback Loop — bounded retry that runs a generated
// project in a real environment, captures errors, and dispatches
// them back to the QA / builder agents through ProjectUpdater.
//
//   1. runExecutionValidation (install → build → dev)
//   2. If success → return.
//   3. If failure → updater.update({ runtimeFeedback: { ... } }).
//      The updater re-runs builder → qa → polish, letting the QA
//      agent treat the runtime errors as CRITICAL issues to fix.
//   4. Reload the project files from the store. Goto 1.
//
//   No project is marked complete unless this loop returns success.
// ─────────────────────────────────────────────────────────────

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { ProjectStore } from '../storage/project-store.js';
import type { ProjectUpdater } from './project-updater.js';
import type { ProjectFile } from './generator-types.js';
import {
  runExecutionValidation,
  type ExecutionValidationResult,
  type ExecutionRunnerOptions,
} from './execution-runner.js';
import {
  classifyExecutionResult,
  groupByCategory,
  dominantCategory,
  type ClassifiedError,
  type ErrorCategory,
} from './error-classifier.js';

export interface ExecutionFeedbackDeps {
  updater: ProjectUpdater;
  projectStore: ProjectStore;
  logger: Logger;
}

export interface ExecutionFeedbackOptions {
  /** Hard cap on QA-driven fix iterations after the first execution run. */
  maxIterations?: number;
  /** Forwarded to the execution-runner. */
  runner?: Pick<ExecutionRunnerOptions,
    'packageManager' | 'timeouts' | 'startDevServer' | 'runTypecheck' | 'maxLogBytesPerStep' | 'readyMarkers' | 'httpProbes' | 'disableHttpProbes'>;
}

export interface ExecutionFeedbackIteration {
  index: number;
  /** 'execute' = ran the runner; 'fix' = dispatched repair to QA agent. */
  kind: 'execute' | 'fix';
  result?: ExecutionValidationResult;
  promptPreview?: string;
  durationMs: number;
}

export interface ExecutionFeedbackSummary {
  finalVerdict: 'pass' | 'fail';
  iterations: ExecutionFeedbackIteration[];
  /** Most recent execution result (pass or fail). */
  lastResult: ExecutionValidationResult;
  totalDurationMs: number;
  /** Reason the loop terminated when verdict is 'fail'. */
  reason?: 'max-iterations' | 'updater-failed' | 'no-files' | 'crashed' | 'no-progress';
}

/** Default repair iterations. The user-facing cap is HARD_MAX_ITERATIONS. */
const DEFAULT_MAX_ITERATIONS = 3;
/** Absolute upper bound regardless of caller — token spend protection. */
const HARD_MAX_ITERATIONS = 5;
/** Bail if the error fingerprint fails to shrink for this many consecutive
 *  fix iterations. Lets us cut losses when the agent is going in circles. */
const NO_PROGRESS_LIMIT = 2;

/**
 * Build the natural-language fix prompt that gets handed to the
 * builder/QA agents alongside the structured `runtimeFeedback` payload.
 *
 * Emits a header that names the iteration plus a verbatim excerpt of
 * the install/build/dev logs so the agent can pattern-match against
 * the same lines a developer would see in the terminal.
 */
function buildExecutionFixPrompt(
  result: ExecutionValidationResult,
  iteration: number,
  maxIterations: number,
  previousErrors: string[],
): string {
  const classified = classifyExecutionResult(result);
  const grouped = groupByCategory(classified);
  const dominant = dominantCategory(classified);
  const summary = summariseCategories(classified) || 'no classified errors';

  const parts: string[] = [
    `Fix the following real runtime/build errors.`,
    `Iteration ${iteration} of ${maxIterations} — the project is being executed in a real Node environment (npm install → npm run build → npm run dev) and must reach a healthy state.`,
    ``,
    `Error summary: ${summary}.`,
    `Dominant category: ${dominant.toUpperCase()} — fix this first; downstream errors often disappear once the root cause is resolved.`,
    ``,
    `Steps run:`,
  ];
  for (const s of result.steps) {
    if (!s.ran) {
      parts.push(`  • ${s.step}: SKIPPED`);
      continue;
    }
    const tag = s.ok ? '✓' : '✗';
    const tail = s.timedOut ? ' (TIMEOUT)' : '';
    parts.push(`  ${tag} ${s.step}: exit=${s.exitCode}${tail}, ${s.durationMs}ms`);
  }
  parts.push('');

  // ── Per-category sections in priority order ──
  const categoryOrder: ErrorCategory[] = ['port', 'dependency', 'build', 'runtime', 'api', 'unknown'];
  for (const cat of categoryOrder) {
    const items = grouped[cat];
    if (items.length === 0) continue;
    parts.push(`${CATEGORY_LABELS[cat]} (${items.length}):`);
    for (const c of items.slice(0, 10)) parts.push(renderClassified(c));
    if (items.length > 10) parts.push(`  …and ${items.length - 10} more.`);
    parts.push('');
  }

  // Body samples for blank-page probes (still useful — sample is not in the classifier).
  const blankProbes = result.httpProbes.filter((p) => !p.ok && p.bodySample && p.bodySample.trim().length > 0);
  if (blankProbes.length > 0) {
    parts.push(`HTTP body samples (first ${Math.min(4, blankProbes.length)}):`);
    for (const p of blankProbes.slice(0, 4)) {
      const sample = p.bodySample.replace(/\s+/g, ' ').slice(0, 200);
      parts.push(`  ${p.path} → ${sample}`);
    }
    parts.push('');
  }

  // Verbatim log tail — the most recent ~3 KB of stdout/stderr across all
  // steps. This gives the agent the same context a human would have when
  // looking at the terminal.
  const logTail = result.logs.slice(-3_000).trim();
  if (logTail.length > 0) {
    parts.push(`RAW LOGS (last ${logTail.length} bytes):`);
    parts.push('```');
    parts.push(logTail);
    parts.push('```');
    parts.push('');
  }

  // If we have prior-iteration context, tell the agent what it already
  // tried so it doesn't propose the same fix again.
  if (previousErrors.length > 0 && iteration > 1) {
    const stillThere = previousErrors.filter((e) => isStillPresent(e, result));
    if (stillThere.length > 0) {
      parts.push(
        `⚠️ The PREVIOUS fix did not resolve ${stillThere.length} error(s). ` +
        `These errors are still present after your last edit — your previous approach was wrong. ` +
        `Try a DIFFERENT fix this time:`,
      );
      for (const e of stillThere.slice(0, 6)) parts.push(`  - ${e}`);
      parts.push('');
    }
  }

  parts.push(
    `Fix EVERY error above. The next iteration will re-run npm install, npm run build, ` +
    `and npm run dev. The build must compile and the dev server must reach a ready state ` +
    `within its timeout. Treat these as CRITICAL issues — do not introduce new dependencies ` +
    `unless strictly required by the fix, and do not refactor unrelated code.`,
  );

  return parts.join('\n');
}

/**
 * Build a stable fingerprint of the current execution failure. We use this
 * to detect when iterations are not making progress — if the fingerprint
 * doesn't change between two passes, the agent is going in circles and we
 * should bail rather than keep burning tokens.
 *
 * The fingerprint is the sorted set of normalised error lines. We strip
 * line/column numbers, file paths, and durations because those tend to
 * shift across runs even when the underlying error is the same.
 */
function errorFingerprint(result: ExecutionValidationResult): string {
  const norm = (s: string): string => s
    .replace(/[A-Za-z]:[\\/][^\s:]*/g, '<path>') // windows paths
    .replace(/\/[A-Za-z0-9_./-]+\.(?:tsx?|jsx?|json|css|html)/g, '<path>')
    .replace(/:\d+:\d+/g, ':L:C')
    .replace(/\b\d+\s*(?:ms|s|bytes?|B)\b/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

  const lines = new Set<string>();
  for (const e of result.buildErrors) lines.add(`b:${norm(e)}`);
  for (const e of result.runtimeErrors) lines.add(`r:${norm(e)}`);
  for (const p of result.httpProbes) {
    if (!p.ok) lines.add(`h:${p.path}:${norm(p.error ?? `status${p.status}`)}`);
  }
  return Array.from(lines).sort().join('\n');
}

/** Returns true if a previous error is still present in the new result. */
function isStillPresent(prevError: string, current: ExecutionValidationResult): boolean {
  const haystack = [
    ...current.buildErrors,
    ...current.runtimeErrors,
    ...current.httpProbes.filter((p) => !p.ok).map((p) => p.error ?? ''),
  ].join('\n').toLowerCase();
  // Strip volatile bits before comparing.
  const needle = prevError.replace(/:\d+:\d+/g, '').toLowerCase().trim();
  return needle.length > 10 && haystack.includes(needle.slice(0, 80));
}

function allErrorLines(result: ExecutionValidationResult): string[] {
  return [
    ...result.buildErrors,
    ...result.runtimeErrors,
    ...result.httpProbes.filter((p) => !p.ok).map((p) => `${p.path}: ${p.error ?? `status=${p.status}`}`),
  ];
}

function categorise(line: string): string {
  // Kept as a thin wrapper for any external callers — the classifier is
  // the source of truth for new code.
  return classifyExecutionResult({
    success: false,
    buildErrors: [line],
    runtimeErrors: [],
    httpProbes: [],
    logs: '',
    steps: [],
    projectDir: '',
    failureReasons: [],
  })[0]?.tag ?? 'unknown';
}

/** Pretty label per category for prompt section headers. */
const CATEGORY_LABELS: Record<ErrorCategory, string> = {
  dependency: 'DEPENDENCY ERRORS (missing / broken packages)',
  build:      'BUILD ERRORS (TypeScript, syntax, compile)',
  runtime:    'RUNTIME CRASHES (exceptions in the dev server)',
  port:       'PORT ISSUES (cannot bind dev server)',
  api:        'API / HTTP FAILURES (route did not respond correctly)',
  unknown:    'OTHER / UNCLASSIFIED',
};

/** One-line per-category summary used at the top of the fix prompt. */
function summariseCategories(errors: ClassifiedError[]): string {
  const grouped = groupByCategory(errors);
  const parts: string[] = [];
  for (const cat of ['dependency', 'build', 'runtime', 'port', 'api', 'unknown'] as ErrorCategory[]) {
    if (grouped[cat].length > 0) parts.push(`${cat}=${grouped[cat].length}`);
  }
  return parts.join(', ');
}

/**
 * Render a single classified error for the prompt body. Includes structured
 * details (file, line, package name, port) when available.
 */
function renderClassified(c: ClassifiedError): string {
  const head = `[${c.tag}] ${c.message}`;
  const detailBits: string[] = [];
  if (c.details.file) detailBits.push(`file=${c.details.file}${c.details.line ? `:${c.details.line}${c.details.column ? `:${c.details.column}` : ''}` : ''}`);
  if (c.details.packageName && !c.tag.endsWith(c.details.packageName)) detailBits.push(`pkg=${c.details.packageName}`);
  if (c.details.port) detailBits.push(`port=${c.details.port}`);
  if (typeof c.details.httpStatus === 'number') detailBits.push(`status=${c.details.httpStatus}`);
  const detailLine = detailBits.length > 0 ? `\n      → ${detailBits.join(', ')}` : '';
  return `  - ${head}${detailLine}\n      hint: ${c.hint}`;
}

/** Convert flat error strings into the structured `runtimeFeedback.issues` shape. */
function toFeedbackIssues(
  result: ExecutionValidationResult,
): Array<{ category: string; message: string; hint?: string }> {
  const classified = classifyExecutionResult(result);
  const out: Array<{ category: string; message: string; hint?: string }> = classified.map((c) => ({
    category: c.tag,
    message: c.message,
    hint: c.hint,
  }));
  // If the classifier produced nothing but the loop still failed, surface
  // the raw step verdicts so the agent at least knows which step blew up.
  if (out.length === 0) {
    for (const s of result.steps) {
      if (s.ran && !s.ok) {
        out.push({
          category: `step:${s.step}`,
          message: s.timedOut
            ? `${s.step} timed out after ${s.durationMs}ms`
            : `${s.step} exited with code ${s.exitCode}`,
        });
      }
    }
  }
  return out;
}

/**
 * Run the execution-validation feedback loop against a project.
 *
 * Returns when the project either passes execution OR exhausts the
 * iteration budget. Caller is responsible for flipping the project's
 * status to 'completed' / 'failed' based on `summary.finalVerdict`.
 */
export async function runExecutionFeedbackLoop(
  projectId: string,
  deps: ExecutionFeedbackDeps,
  opts: ExecutionFeedbackOptions = {},
): Promise<ExecutionFeedbackSummary> {
  const { logger, projectStore, updater } = deps;
  const requested = opts.maxIterations ?? DEFAULT_MAX_ITERATIONS;
  const maxIterations = Math.min(Math.max(1, requested), HARD_MAX_ITERATIONS);
  if (requested !== maxIterations) {
    logger.warn('[execution-loop] clamped maxIterations', {
      event: 'execution-loop:clamped',
      projectId, requested, applied: maxIterations, hardMax: HARD_MAX_ITERATIONS,
    });
  }
  const t0 = Date.now();
  const iterations: ExecutionFeedbackIteration[] = [];

  // Each iteration writes into a fresh tempdir to guarantee a clean install.
  // We keep one tempdir per loop and re-create it each pass so npm doesn't
  // see stale node_modules when files change.
  const makeTmp = () => mkdtemp(join(tmpdir(), `exec-loop-${projectId}-`));

  const runOne = async (files: ProjectFile[]): Promise<ExecutionValidationResult> => {
    const dir = await makeTmp();
    try {
      return await runExecutionValidation({
        projectDir: dir,
        files,
        logger,
        cleanup: false, // we delete the dir ourselves below
        ...opts.runner,
      });
    } finally {
      rm(dir, { recursive: true, force: true }).catch(() => { /* best-effort */ });
    }
  };

  // ── Initial run ─────────────────────────────────────────────
  let project = await projectStore.get(projectId);
  if (!project || !project.files || project.files.length === 0) {
    return {
      finalVerdict: 'fail',
      iterations,
      lastResult: {
        success: false, buildErrors: ['project has no files'], runtimeErrors: [],
        logs: '', steps: [], httpProbes: [], projectDir: '', failureReasons: ['project has no files'],
      },
      totalDurationMs: Date.now() - t0,
      reason: 'no-files',
    };
  }

  logger.info('[execution-loop] starting initial execution validation', {
    event: 'execution-loop:start', projectId, fileCount: project.files.length, maxIterations,
  });

  const t1 = Date.now();
  let result: ExecutionValidationResult;
  try {
    result = await runOne(project.files);
  } catch (err) {
    logger.error('[execution-loop] runner threw on initial pass', {
      event: 'execution-loop:crash', projectId, err: err instanceof Error ? err.message : String(err),
    });
    return {
      finalVerdict: 'fail',
      iterations,
      lastResult: {
        success: false,
        buildErrors: [`execution-runner crashed: ${err instanceof Error ? err.message : String(err)}`],
        runtimeErrors: [],
        logs: '', steps: [], httpProbes: [], projectDir: '', failureReasons: ['execution-runner crashed'],
      },
      totalDurationMs: Date.now() - t0,
      reason: 'crashed',
    };
  }
  iterations.push({ index: 0, kind: 'execute', result, durationMs: Date.now() - t1 });

  logger.info('[execution-loop] initial verdict', {
    event: 'execution-loop:initial-verdict', projectId,
    success: result.success,
    buildErrors: result.buildErrors.length,
    runtimeErrors: result.runtimeErrors.length,
  });

  if (result.success) {
    return {
      finalVerdict: 'pass',
      iterations,
      lastResult: result,
      totalDurationMs: Date.now() - t0,
    };
  }

  // ── Fix iterations ──────────────────────────────────────────
  let lastResult = result;
  let reason: ExecutionFeedbackSummary['reason'] | undefined;
  let prevFingerprint = errorFingerprint(result);
  let prevErrors = allErrorLines(result);
  let stagnantStreak = 0;

  for (let i = 1; i <= maxIterations; i++) {
    const fixT0 = Date.now();
    const prompt = buildExecutionFixPrompt(lastResult, i, maxIterations, prevErrors);
    const issues = toFeedbackIssues(lastResult);

    logger.warn('[execution-loop] dispatching QA fix iteration', {
      event: 'execution-loop:fix-start',
      projectId, iteration: i,
      issueCount: issues.length,
      buildErrors: lastResult.buildErrors.length,
      runtimeErrors: lastResult.runtimeErrors.length,
    });

    let updaterFailed = false;
    try {
      const updateResult = await updater.update({
        projectId,
        prompts: [prompt],
        scope: 'code',
        userId: 'system-execution-loop',
        runtimeFeedback: {
          issues,
          log: lastResult.logs.slice(-4_000),
          bodySample: lastResult.httpProbes.find((p) => !p.ok && p.bodySample)?.bodySample,
        },
      });
      iterations.push({
        index: i, kind: 'fix',
        promptPreview: prompt.slice(0, 500),
        durationMs: Date.now() - fixT0,
      });
      if (!updateResult.success) {
        logger.error('[execution-loop] updater returned failure', {
          event: 'execution-loop:fix-failed',
          projectId, iteration: i, error: updateResult.error,
        });
        updaterFailed = true;
      }
    } catch (err) {
      logger.error('[execution-loop] updater threw', {
        event: 'execution-loop:fix-crash',
        projectId, iteration: i,
        err: err instanceof Error ? err.message : String(err),
      });
      iterations.push({
        index: i, kind: 'fix',
        promptPreview: prompt.slice(0, 500),
        durationMs: Date.now() - fixT0,
      });
      updaterFailed = true;
    }

    if (updaterFailed) {
      reason = 'updater-failed';
      break;
    }

    // Reload — updater overwrites project.files in the store.
    project = await projectStore.get(projectId);
    if (!project || !project.files || project.files.length === 0) {
      reason = 'no-files';
      break;
    }

    const execT0 = Date.now();
    try {
      lastResult = await runOne(project.files);
    } catch (err) {
      logger.error('[execution-loop] runner threw on retry', {
        event: 'execution-loop:crash',
        projectId, iteration: i,
        err: err instanceof Error ? err.message : String(err),
      });
      lastResult = {
        success: false,
        buildErrors: [`execution-runner crashed: ${err instanceof Error ? err.message : String(err)}`],
        runtimeErrors: [],
        logs: '', steps: [], httpProbes: [], projectDir: '', failureReasons: ['execution-runner crashed'],
      };
      iterations.push({ index: i, kind: 'execute', result: lastResult, durationMs: Date.now() - execT0 });
      reason = 'crashed';
      break;
    }
    iterations.push({ index: i, kind: 'execute', result: lastResult, durationMs: Date.now() - execT0 });

    logger.info('[execution-loop] post-fix verdict', {
      event: 'execution-loop:post-fix',
      projectId, iteration: i,
      success: lastResult.success,
      buildErrors: lastResult.buildErrors.length,
      runtimeErrors: lastResult.runtimeErrors.length,
    });

    if (lastResult.success) {
      return {
        finalVerdict: 'pass',
        iterations,
        lastResult,
        totalDurationMs: Date.now() - t0,
      };
    }

    // Convergence check: did anything actually change?
    const newFingerprint = errorFingerprint(lastResult);
    if (newFingerprint === prevFingerprint) {
      stagnantStreak++;
      logger.warn('[execution-loop] no progress this iteration', {
        event: 'execution-loop:no-progress',
        projectId, iteration: i, stagnantStreak, limit: NO_PROGRESS_LIMIT,
      });
      if (stagnantStreak >= NO_PROGRESS_LIMIT) {
        reason = 'no-progress';
        break;
      }
    } else {
      stagnantStreak = 0;
    }
    prevFingerprint = newFingerprint;
    prevErrors = allErrorLines(lastResult);
  }

  if (!reason) reason = 'max-iterations';

  logger.error('[execution-loop] exhausted without success', {
    event: 'execution-loop:exhausted',
    projectId,
    reason,
    iterations: iterations.length,
    finalBuildErrors: lastResult.buildErrors.length,
    finalRuntimeErrors: lastResult.runtimeErrors.length,
  });

  return {
    finalVerdict: 'fail',
    iterations,
    lastResult,
    totalDurationMs: Date.now() - t0,
    reason,
  };
}
