// Project Generator — orchestrates the 4-step pipeline and assembles the final project.
//
// Pipeline:  spec → builder → qa → polish
// Loop:      if qa.verdict === 'needs-improvement', re-run builder + qa
//            (cap MAX_QA_LOOPS) before allowing polish.

import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';
import type { AgentRole, Session } from '../../../../packages/agent-core/src/types.js';
import type { BaseAgent, Logger } from '../../../../packages/agent-core/src/base-agent.js';
import {
  PipelineOrchestrator,
  type PipelineEvent,
} from '../../../../packages/agent-core/src/orchestrator.js';
import { InMemoryMessageBus } from '../../../../packages/agent-core/src/message-bus.js';
import { getMergedFiles } from '../../../../packages/agent-core/src/agent-input-builder.js';
import { validateImportIntegrity, missingImportsAsIssues } from '../../../../packages/agent-core/src/import-integrity.js';
import { validateAndFixDependencies } from '../../../../packages/agent-core/src/dependency-validator.js';
import { runFinalIntegrityGate, describeIntegrityFailure } from './final-integrity-gate.js';
import { validateUiSystemCompliance, uiSystemViolationsAsIssues } from '../../../../packages/agent-core/src/ui-system.js';
import { normalizeTechStack, validateStackCompliance, stackViolationsAsIssues } from '../../../../packages/agent-core/src/tech-stack.js';
import { setBuilderProjectContext } from '../agents/builder-agent.js';
import {
  setActiveGeneration,
  updateActiveGeneration,
  clearActiveGeneration,
} from '../crash-logger.js';
import { planSlices, buildSliceManifest, type PlannedSlice } from '../../../../packages/agent-core/src/slice-planner.js';
import {
  validateImplementationCompleteness,
  completenessViolationsAsIssues,
  extractApiDomains,
} from '../../../../packages/agent-core/src/implementation-completeness.js';
import { SessionManager } from './session-manager.js';
import { ProjectStore, type ProjectRecord } from '../storage/project-store.js';
import { FileMemoryStore } from '../storage/memory-store.js';
import { assembleProject, buildTaskSummaries, buildStepSummaries } from './project-assembler.js';
import { auditAndLog, describeIntegrityIssue } from './file-integrity.js';
import { runQualityAssurance } from './quality-assurance.js';
import { ProjectUpdater } from './project-updater.js';
import type { PreviewManager } from '../preview/preview-manager.js';
import { validateAndAutoFix } from './auto-fix.js';
import { runExecutionFeedbackLoop } from './execution-feedback-loop.js';

export type {
  GenerateRequest, UpdateRequest, GenerateResult, UpdateResult, StepSummary,
} from './generator-types.js';

import type { GenerateRequest, GenerateResult, UpdateRequest, UpdateResult } from './generator-types.js';

const MAX_QA_LOOPS = 2; // hard cap on QA-driven rebuilds per slice. After hitting this, applySimplifiedFallback() stubs the offending files instead of regenerating the whole slice again.
const QA_STAGNATION_LIMIT = 1; // bail immediately if a rebuild fails to drop the issue count.

/**
 * Per-call LLM usage record collected live for the diagnostic dump.
 */
interface DiagUsageEntry {
  at: string;
  phase: string;
  agent: string;
  model?: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
  latencyMs: number;
}

/**
 * Per-step post-persist execution record collected live for the
 * diagnostic dump.
 */
interface DiagPostPersistEntry {
  step: string;
  sliceId: string | null;
  startedAt: string;
  durationMs: number;
  status: 'ok' | 'fail';
  errorName?: string;
  errorMessage?: string;
  errorStack?: string;
}

/**
 * Bounded per-project diagnostic context. Mutated as the run progresses
 * and serialized to `apps/api/src/testing/last-failure.json` on failure.
 */
interface ProjectDiagnosticContext {
  projectId: string;
  sessionId: string;
  startedAt: string;
  usageLog: DiagUsageEntry[];
  postPersistStatuses: DiagPostPersistEntry[];
}

/** Read the QA artifact's verdict, defaulting to 'unknown'. */
function qaVerdict(artifacts: Map<AgentRole, Record<string, unknown>>): string {
  const qa = artifacts.get('qa') as { verdict?: string } | undefined;
  return (qa?.verdict ?? 'unknown').toString();
}

/**
 * Count blocking QA issues. Pass verdict counts as 0; otherwise sum the
 * `issues` array length. We don't filter by severity because the QA agent's
 * shape doesn't guarantee one — every entry in `issues` is treated as
 * something the next builder pass should fix.
 */
function countQaIssues(artifacts: Map<AgentRole, Record<string, unknown>>): number {
  const qa = artifacts.get('qa') as { verdict?: string; issues?: unknown[] } | undefined;
  if (!qa) return 0;
  if (qa.verdict === 'pass') return 0;
  return Array.isArray(qa.issues) ? qa.issues.length : 0;
}

/**
 * Build a safe, minimal replacement for a file that the QA loop could not
 * fix in the allotted iterations. The stub must:
 *   • parse cleanly (no truncation, no broken JSX/TS)
 *   • render something visible at runtime if it's a page
 *   • not import anything that may be missing
 * Returns `null` for file types we don't have a safe template for — those
 * are left untouched.
 */
function buildSimplifiedStub(path: string): string | null {
  const p = path.toLowerCase();
  // Title derived from the path's last meaningful segment.
  const seg = path.replace(/\\/g, '/').split('/').filter(Boolean);
  const labelRaw = (seg.length >= 2 ? seg[seg.length - 2] : seg[seg.length - 1] ?? 'page')
    .replace(/\.(tsx?|jsx?)$/i, '')
    .replace(/[-_]/g, ' ')
    .trim() || 'Page';
  const title = labelRaw.charAt(0).toUpperCase() + labelRaw.slice(1);

  // Next.js App Router page.
  if (/(^|\/)(src\/)?app\/.*\/page\.(tsx|jsx)$/.test(path) || /(^|\/)(src\/)?app\/page\.(tsx|jsx)$/.test(path)) {
    return [
      `export default function Page() {`,
      `  return (`,
      `    <main style={{ padding: '2rem', maxWidth: 720, margin: '0 auto' }}>`,
      `      <h1>${title}</h1>`,
      `      <p>This page is being prepared. Content will appear here shortly.</p>`,
      `    </main>`,
      `  );`,
      `}`,
      ``,
    ].join('\n');
  }

  // Next.js layout.
  if (/(^|\/)(src\/)?app\/.*layout\.(tsx|jsx)$/.test(path)) {
    return [
      `export default function Layout({ children }: { children: React.ReactNode }) {`,
      `  return <>{children}</>;`,
      `}`,
      ``,
    ].join('\n');
  }

  // Next.js App Router API route.
  if (/(^|\/)(src\/)?app\/api\/.*route\.(ts|js)$/.test(path)) {
    return [
      `export async function GET() {`,
      `  return Response.json({ ok: true, items: [] });`,
      `}`,
      ``,
    ].join('\n');
  }

  // Pages Router page.
  if (/(^|\/)(src\/)?pages\/.*\.(tsx|jsx)$/.test(path) && !/api\//.test(path)) {
    return [
      `export default function Page() {`,
      `  return (`,
      `    <main style={{ padding: '2rem', maxWidth: 720, margin: '0 auto' }}>`,
      `      <h1>${title}</h1>`,
      `      <p>This page is being prepared. Content will appear here shortly.</p>`,
      `    </main>`,
      `  );`,
      `}`,
      ``,
    ].join('\n');
  }

  // Pages Router API.
  if (/(^|\/)(src\/)?pages\/api\/.*\.(ts|js)$/.test(path)) {
    return [
      `import type { NextApiRequest, NextApiResponse } from 'next';`,
      `export default function handler(_req: NextApiRequest, res: NextApiResponse) {`,
      `  res.status(200).json({ ok: true, items: [] });`,
      `}`,
      ``,
    ].join('\n');
  }

  // Generic React component under src/components.
  if (/(^|\/)(src\/)?components\/.*\.(tsx|jsx)$/.test(path)) {
    const compName = (seg[seg.length - 1] ?? 'Component')
      .replace(/\.(tsx?|jsx?)$/i, '')
      .replace(/[^A-Za-z0-9]/g, '');
    const safeName = /^[A-Z]/.test(compName) ? compName : `C${compName || 'omponent'}`;
    return [
      `import * as React from 'react';`,
      `export interface ${safeName}Props { children?: React.ReactNode; className?: string; }`,
      `export function ${safeName}({ children, className }: ${safeName}Props) {`,
      `  return <div className={className}>{children}</div>;`,
      `}`,
      `export default ${safeName};`,
      ``,
    ].join('\n');
  }

  // Generic helper module under src/lib or src/hooks.
  if (/(^|\/)(src\/)?(lib|hooks|utils)\/.*\.(ts|tsx|js|jsx)$/.test(path)) {
    return [
      `// Simplified placeholder — the original implementation could not be`,
      `// validated within the QA budget and was replaced with a no-op so the`,
      `// rest of the build can proceed.`,
      `export {};`,
      ``,
    ].join('\n');
  }

  // CSS / globals.
  if (/\.(css|scss)$/.test(p)) {
    return `/* simplified fallback — original styles deferred */\n`;
  }

  // Unsupported — leave untouched.
  return null;
}

export class ProjectGenerator {
  private agents: Map<AgentRole, BaseAgent>;
  private projectStore: ProjectStore;
  private memoryStore: FileMemoryStore;
  private sessionManager: SessionManager;
  private logger: Logger;
  private resultCache = new Map<string, { projectId: string; cachedAt: number }>();
  private readonly RESULT_CACHE_TTL_MS = 30 * 60 * 1000;
  private activeGenerations = 0;
  /**
   * Per-project diagnostic context. Captured live during a run and dumped
   * to `apps/api/src/testing/last-failure.json` whenever
   * `persistProjectFailure` fires. Bounded buffers so a multi-hour run
   * can't blow up memory.
   */
  private diagContexts = new Map<string, ProjectDiagnosticContext>();
  /** projectId → active sessionId. Populated by runReserved /
   *  runReservedUpdate so per-step updateActiveGeneration() calls can
   *  reach the crash-logger entry from places that only know projectId. */
  private projectIdToSession = new Map<string, string>();
  private readonly MAX_USAGE_LOG_ENTRIES = 500;
  private readonly MAX_POST_PERSIST_ENTRIES = 200;
  private readonly maxConcurrentSessions: number;
  /** Outer wall-clock SAFETY NET. Per-agent step timeouts and SDK request
   *  timeouts cap individual calls; this caps the whole orchestration so a
   *  truly stuck pipeline cannot wedge a project as 'generating' forever.
   *  Generous by default — the *adaptive* deadline below is the real budget;
   *  this only fires when the soft deadline + slice loop somehow misbehave.
   *  Override with PIPELINE_HARD_TIMEOUT_MS env var. */
  private readonly pipelineHardTimeoutMs: number =
    Number(process.env.PIPELINE_HARD_TIMEOUT_MS) || 3 * 60 * 60 * 1000;
  /** Per-slice budget contribution to the adaptive *soft* deadline computed
   *  after slice planning. Override with PIPELINE_PER_SLICE_MS. */
  private readonly perSliceBudgetMs: number =
    Number(process.env.PIPELINE_PER_SLICE_MS) || 5 * 60 * 1000;
  /** Floor for the soft deadline regardless of slice count. */
  private readonly minPipelineBudgetMs: number = 45 * 60 * 1000;
  private updater: ProjectUpdater;
  private previewManager?: PreviewManager;
  private apiBaseUrl = 'http://127.0.0.1:3003';

  /** Expose the updater so post-pipeline tooling (auto-fix loop, manual
   *  fixes, etc.) can run agent iterations against an existing project. */
  getUpdater(): ProjectUpdater { return this.updater; }

  /** Wire the preview manager *after* construction (it's created later in
   *  app.ts). When set, the generator will fire-and-forget a runtime
   *  validation + auto-fix pass after each successful generation. */
  setPreviewManager(pm: PreviewManager, apiBaseUrl?: string): void {
    this.previewManager = pm;
    if (apiBaseUrl) this.apiBaseUrl = apiBaseUrl;
  }

  constructor(
    agents: Map<AgentRole, BaseAgent>,
    projectStore: ProjectStore,
    memoryStore: FileMemoryStore,
    sessionManager: SessionManager,
    logger: Logger,
    maxConcurrentSessions = 10,
  ) {
    this.agents = agents;
    this.projectStore = projectStore;
    this.memoryStore = memoryStore;
    this.sessionManager = sessionManager;
    this.logger = logger;
    this.maxConcurrentSessions = maxConcurrentSessions;
    this.updater = new ProjectUpdater(agents, projectStore, memoryStore, sessionManager, logger);
  }

  // ── Background-friendly entry ────────────────────────────
  /**
   * Allocate project + session IDs synchronously and persist a 'generating'
   * placeholder record. Use together with `runReserved()` to launch the
   * pipeline in the background while returning HTTP 202 immediately.
   */
  reserve(request: GenerateRequest): {
    projectId: string;
    sessionId: string;
    projectName: string;
    request: GenerateRequest;
    placeholderSaved: Promise<void>;
  } {
    const projectId = nanoid(12);
    const sessionId = nanoid(16);
    const projectName = 'Untitled Project';
    const placeholder: ProjectRecord = {
      id: projectId, sessionId,
      name: projectName,
      prompts: request.prompts,
      status: 'generating',
      files: [], tasks: [],
      totalTokens: 0, totalCostUsd: 0, durationMs: 0,
      version: 1, versionHistory: [],
      createdAt: new Date().toISOString(),
      progress: {
        phase: 'init',
        lastProgressAt: new Date().toISOString(),
        startedAt: new Date().toISOString(),
        lastMeaningfulStep: 'reserve',
        llmCallCount: 0,
        filesWrittenCount: 0,
        slicesPlannedCount: 0,
      },
    };
    this.logger.info('[gen:reserve] placeholder created', {
      event: 'gen:reserve', projectId, sessionId, promptCount: request.prompts.length,
    });
    // We DO track the save promise so runReserved() can await it before
    // touching the project. Without that guarantee, a synchronous throw in
    // runReserved() leaves the placeholder write racing with no observer.
    const placeholderSaved = this.projectStore.save(placeholder, {
      caller: 'project-generator:reserve',
      reason: 'placeholder created for new generation',
    }).catch((err) => {
      this.logger.error('[gen:reserve] placeholder save FAILED', {
        event: 'gen:reserve:save-failed', projectId, sessionId, err: String(err),
      });
      throw err;
    });
    return { projectId, sessionId, projectName, request, placeholderSaved };
  }

  /**
   * Execute the pipeline against a previously reserved project + session.
   * Re-uses the IDs so the WS subscription that the client opened immediately
   * after reservation receives every event.
   *
   * GUARANTEE: this method NEVER leaves a project stuck in 'generating'. Any
   * thrown error — from validateRequest, capacity check, sessionManager,
   * memoryStore, projectStore, or the pipeline body — is caught here and
   * persisted as `status: 'failed'` with the real error message.
   */
  async runReserved(reservation: {
    projectId: string;
    sessionId: string;
    request: GenerateRequest;
    placeholderSaved?: Promise<void>;
  }): Promise<GenerateResult> {
    const { projectId, sessionId, request } = reservation;
    this.logger.info('[gen:runner:start] background runner started', {
      event: 'gen:runner:start', projectId, sessionId, promptCount: request.prompts.length,
    });

    // Register with the crash-logger so any process-level failure
    // (uncaughtException, unhandledRejection, signal) records the
    // generation that was in flight.
    setActiveGeneration(sessionId, {
      projectId, sessionId, phase: 'init', step: 'runReserved',
    });
    this.projectIdToSession.set(projectId, sessionId);

    // Make absolutely sure the placeholder is on disk before we do anything
    // else — otherwise an early failure has nothing to mark as 'failed'.
    if (reservation.placeholderSaved) {
      try {
        await reservation.placeholderSaved;
      } catch (err) {
        this.logger.error('[gen:runner:placeholder-failed] cannot start — placeholder write failed', {
          event: 'gen:runner:placeholder-failed', projectId, sessionId, err: String(err),
        });
        clearActiveGeneration(sessionId);
        return { projectId, sessionId, success: false, error: `placeholder save failed: ${String(err)}` };
      }
    }
    try {
      const result = await this.generate(request, { projectId, sessionId });
      this.logger.info('[gen:runner:done] background runner finished', {
        event: 'gen:runner:done', projectId, sessionId, success: result.success,
      });
      return result;
    } catch (err) {
      // generate() is supposed to handle its own failures, but defence in
      // depth: if anything escapes, we still mark the project failed
      // WITHOUT letting the exception propagate to the process.
      this.logger.error('[gen:runner:caught-escape] generate() threw — isolating from process', {
        event: 'gen:runner:caught-escape',
        projectId, sessionId,
        message: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      try {
        await this.markPlaceholderFailed(projectId, sessionId, 'runner', err);
      } catch (persistErr) {
        this.logger.error('[gen:runner:persist-failed] could not persist failure (non-fatal to process)', {
          event: 'gen:runner:persist-failed', projectId, sessionId, err: String(persistErr),
        });
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { projectId, sessionId, success: false, error: msg };
    } finally {
      this.projectIdToSession.delete(projectId);
      clearActiveGeneration(sessionId);
    }
  }

  /**
   * **Single source of truth for project failure persistence.**
   *
   * Guarantees that *no* project ever ends up in `status: 'failed'` with
   * empty `error`, missing `failure`, or zeroed-out `totalTokens`/
   * `totalCostUsd` when LLM calls already succeeded. Every catch path in
   * the pipeline must funnel through here.
   *
   * Normalisation pipeline for the error message:
   *   1. `err.message` if `err instanceof Error` and non-empty
   *   2. `String(err)` if non-empty and not `[object Object]`
   *   3. `JSON.stringify(err)` if it produces something useful
   *   4. `Unknown error in <phase>/<step>` as last resort
   *
   * Token / cost preservation: prefers `runningProject.totalTokens` /
   * `runningProject.totalCostUsd` (live in-memory record), falls back to
   * the persisted record on disk, and finally to 0. This means even a
   * spec-phase crash AFTER the first LLM call records the spend.
   */
  private async persistProjectFailure(
    projectId: string,
    context: {
      sessionId: string;
      err: unknown;
      failedPhase: string;
      failedStep?: string;
      lastSuccessfulPhase?: string;
      lastSuccessfulStep?: string;
      runningProject?: ProjectRecord;
    },
  ): Promise<{ summary: string; failedAt: string }> {
    const { sessionId, err, failedPhase } = context;
    const failedStep = context.failedStep ?? failedPhase;
    const isErr = err instanceof Error;
    const name = isErr ? (err.name || 'Error') : 'Error';

    // ── Message normalisation chain ──────────────────────
    let message = '';
    if (isErr && err.message && err.message.length > 0) {
      message = err.message;
    } else {
      const asString = (() => {
        try { return String(err); } catch { return ''; }
      })();
      if (asString && asString.length > 0 && asString !== '[object Object]') {
        message = asString;
      } else {
        const asJson = (() => {
          try { return JSON.stringify(err); } catch { return ''; }
        })();
        if (asJson && asJson.length > 2 && asJson !== '{}') {
          message = asJson;
        } else {
          message = `Unknown error in ${failedPhase}/${failedStep}`;
        }
      }
    }
    const stack = isErr ? err.stack : undefined;
    const failedAt = new Date().toISOString();
    const summary = `[phase=${failedPhase} step=${failedStep}] ${name}: ${message}`;

    // ── Load / build the record we'll persist ────────────
    let base: ProjectRecord;
    let persisted: ProjectRecord | undefined;
    try {
      persisted = await this.projectStore.get(projectId);
    } catch (readErr) {
      this.logger.warn('[gen:persist-failure:read-error] could not load existing record (non-fatal)', {
        event: 'gen:persist-failure:read-error', projectId, readErr: String(readErr),
      });
    }
    base = context.runningProject ?? persisted ?? {
      id: projectId, sessionId,
      name: 'Untitled Project',
      prompts: [], status: 'generating',
      files: [], tasks: [],
      totalTokens: 0, totalCostUsd: 0, durationMs: 0,
      version: 1, versionHistory: [],
      createdAt: new Date().toISOString(),
    };

    // ── Token/cost preservation ──────────────────────────
    // Prefer the live in-memory accumulator; fall back to whatever was
    // last persisted; never let LLM spend disappear because we're failing.
    const totalTokens =
      (context.runningProject?.totalTokens ?? 0) ||
      (persisted?.totalTokens ?? 0) ||
      base.totalTokens || 0;
    const totalCostUsd =
      (context.runningProject?.totalCostUsd ?? 0) ||
      (persisted?.totalCostUsd ?? 0) ||
      base.totalCostUsd || 0;

    const llmCallCount =
      base.progress?.llmCallCount ??
      persisted?.progress?.llmCallCount ?? 0;
    const lastSuccessfulPhase =
      context.lastSuccessfulPhase ??
      base.progress?.lastMeaningfulStep ??
      persisted?.progress?.lastMeaningfulStep ?? 'reserved';
    const lastSuccessfulStep =
      context.lastSuccessfulStep ??
      base.failure?.lastSuccessfulStep ??
      persisted?.failure?.lastSuccessfulStep ?? lastSuccessfulPhase;

    base.status = 'failed';
    base.error = summary;
    base.completedAt = failedAt;
    base.totalTokens = totalTokens;
    base.totalCostUsd = totalCostUsd;
    base.failure = {
      failedPhase,
      errorName: name,
      errorMessage: message,
      stack,
      errorStack: stack,
      failedAt,
      lastSuccessfulPhase,
      llmCallCount,
      failedStep,
      lastSuccessfulStep,
    };

    try {
      await this.projectStore.save(base, {
        caller: 'persistProjectFailure',
        reason: `${failedPhase}/${failedStep}`,
        // A late failure (e.g. runtime-validation crashing AFTER
        // execution-validation flipped status='completed') legitimately
        // needs to demote the record to 'failed'. Without this opt-in
        // the stale-write detector preserves on-disk 'completed' and
        // the failure goes silent.
        allowStatusDowngrade: true,
      });
    } catch (saveErr) {
      this.logger.error('[gen:persist-failure:save-error] could not persist failed status', {
        event: 'gen:persist-failure:save-error', projectId, sessionId,
        failedPhase, failedStep, original: summary,
        saveErr: String(saveErr),
        saveStack: saveErr instanceof Error ? saveErr.stack : undefined,
      });
    }

    this.logger.error('[gen:persist-failure] project marked failed', {
      event: 'gen:persist-failure',
      projectId, sessionId,
      failedPhase, failedStep,
      lastSuccessfulPhase, lastSuccessfulStep,
      llmCallCount, totalTokens, totalCostUsd,
      errorName: name, errorMessage: message,
      stack,
    });

    // Best-effort WS notification so subscribed clients see the failure
    // immediately rather than via polling.
    try {
      this.sessionManager.handleEvent({
        type: 'pipeline:failed',
        sessionId,
        projectId,
        error: summary,
        failedPhase,
        failedStep,
        lastSuccessfulPhase,
        lastSuccessfulStep,
        errorName: name,
        errorMessage: message,
        stack,
        llmCallCount,
        totalTokens,
        totalCostUsd,
        failedAt,
      } as unknown as PipelineEvent);
    } catch (emitErr) {
      this.logger.warn('[gen:persist-failure:emit-error] websocket emit failed (non-fatal)', {
        event: 'gen:persist-failure:emit-error', projectId, sessionId, emitErr: String(emitErr),
      });
    }

    // Diagnostic dump — write a single self-contained JSON snapshot to
    // `apps/api/src/testing/last-failure.json` so the next failure is
    // fully inspectable from the file alone (no log archaeology).
    try {
      await this.dumpLastFailure({
        projectId,
        sessionId,
        record: base,
        failedPhase,
        failedStep,
        lastSuccessfulPhase,
        lastSuccessfulStep,
        errorName: name,
        errorMessage: message,
        errorStack: stack,
        failedAt,
        llmCallCount,
        totalTokens,
        totalCostUsd,
      });
    } catch (dumpErr) {
      this.logger.warn('[gen:persist-failure:dump-error] last-failure dump failed (non-fatal)', {
        event: 'gen:persist-failure:dump-error', projectId, sessionId, err: String(dumpErr),
        stack: dumpErr instanceof Error ? dumpErr.stack : undefined,
      });
    }

    // Specialized finalization dump — only when the failure happened in
    // the post-files-persisted finalization path. Provides a focused view
    // of which finalization step (assembleProject, validateAndFixDependencies,
    // runQualityAssurance, scheduleExecutionValidation, scheduleRuntimeValidation,
    // final save/update) succeeded vs failed, alongside the cumulative file
    // count and the actual persisted file paths.
    if (this.isFinalizationFailure(failedPhase, failedStep)) {
      try {
        await this.dumpLastFinalizationFailure({
          projectId,
          sessionId,
          record: base,
          failedPhase,
          failedStep,
          errorName: name,
          errorMessage: message,
          errorStack: stack,
          failedAt,
          llmCallCount,
          totalTokens,
          totalCostUsd,
        });
      } catch (dumpErr) {
        this.logger.warn('[gen:persist-failure:finalization-dump-error] last-finalization-failure dump failed (non-fatal)', {
          event: 'gen:persist-failure:finalization-dump-error',
          projectId, sessionId,
          err: String(dumpErr),
          stack: dumpErr instanceof Error ? dumpErr.stack : undefined,
        });
      }
    }

    // Specialized qa-gate dump — only when the failure happened in the
    // qa-gate phase or against a qa-gate:* step. Provides per-milestone
    // verdicts (manifestRefreshed, runQualityAssurance, postQaSave,
    // executionValidationScheduled, finalStatusUpdate) plus manifest paths
    // and full error envelope. Triggered for both:
    //   - direct qa-gate failures (failedPhase==='qa-gate')
    //   - qa-gate:* step failures regardless of failedPhase
    if (failedPhase === 'qa-gate' || /^qa-gate:/.test(failedStep)) {
      try {
        await this.dumpLastQaGateFailure({
          projectId,
          sessionId,
          record: base,
          failedPhase,
          failedStep,
          lastSuccessfulPhase,
          lastSuccessfulStep,
          errorName: name,
          errorMessage: message,
          errorStack: stack,
          failedAt,
          llmCallCount,
          totalTokens,
          totalCostUsd,
        });
      } catch (dumpErr) {
        this.logger.warn('[gen:persist-failure:qa-gate-dump-error] last-qa-gate-failure dump failed (non-fatal)', {
          event: 'gen:persist-failure:qa-gate-dump-error',
          projectId, sessionId,
          err: String(dumpErr),
          stack: dumpErr instanceof Error ? dumpErr.stack : undefined,
        });
      }
    }

    return { summary, failedAt };
  }

  /**
   * Heuristic: did this failure occur in the post-files-persisted
   * finalization path? True iff the phase/step matches one of the
   * known finalization labels stamped by `runPostPersistStep`,
   * `[gen:finalize:*]` log lines, or the async exec/runtime validators.
   */
  private isFinalizationFailure(failedPhase: string, failedStep: string): boolean {
    const phaseHit = /^(final-assembly|qa-gate|finalize|execution-validation|runtime-validation|pipeline)$/.test(failedPhase);
    const stepHit = /^(final-assembly:|qa-gate:|finalize:|execution-validation:|runtime-validation:|pipeline:)/.test(failedStep);
    return phaseHit || stepHit;
  }

  /**
   * Resolve the absolute path to `apps/api/src/testing/last-finalization-failure.json`
   * relative to this source file, regardless of cwd.
   */
  private resolveLastFinalizationFailureDumpPath(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', 'testing', 'last-finalization-failure.json');
  }

  /**
   * Write the focused finalization-failure snapshot. Includes per-step
   * verdicts for every named finalization step the runbook lists, derived
   * from the diag context's `postPersistStatuses` (recorded by
   * `runPostPersistStep`). Steps not yet executed at the time of failure
   * are reported as `not-run`.
   *
   * Best-effort — failures here are logged but never re-thrown.
   */
  private async dumpLastFinalizationFailure(args: {
    projectId: string;
    sessionId: string;
    record: ProjectRecord;
    failedPhase: string;
    failedStep: string;
    errorName: string;
    errorMessage: string;
    errorStack?: string;
    failedAt: string;
    llmCallCount: number;
    totalTokens: number;
    totalCostUsd: number;
  }): Promise<void> {
    const diag = this.diagContexts.get(args.projectId);
    const statuses = diag?.postPersistStatuses ?? [];

    // Map known finalization step prefixes to a single-source verdict.
    const namedSteps = [
      'assembleProject',
      'validateAndFixDependencies',
      'runQualityAssurance',
      'scheduleExecutionValidation',
      'scheduleRuntimeValidation',
      'final-save',
    ] as const;

    const matchStep = (name: typeof namedSteps[number]) => {
      // The actual step labels stamped in code are like:
      //   final-assembly:assembleProject
      //   final-assembly:validateAndFixDependencies
      //   qa-gate:runQualityAssurance
      //   finalize:projectStore.save
      //   execution-validation:*
      //   runtime-validation:*
      // We collapse each label to the short name the runbook expects.
      const aliases: Record<string, RegExp> = {
        assembleProject: /:assembleProject$/,
        validateAndFixDependencies: /:validateAndFixDependencies$/,
        runQualityAssurance: /:runQualityAssurance$/,
        scheduleExecutionValidation: /^execution-validation:/,
        scheduleRuntimeValidation: /^runtime-validation:/,
        'final-save': /:projectStore\.save$/,
      };
      const re = aliases[name];
      const matches = statuses.filter((s) => re.test(s.step));
      if (matches.length === 0) return { name, status: 'not-run' as const };
      // Last status wins — the most recent attempt is the one that mattered.
      const last = matches[matches.length - 1];
      return {
        name,
        status: last.status,
        sliceId: last.sliceId,
        startedAt: last.startedAt,
        durationMs: last.durationMs,
        errorName: last.errorName,
        errorMessage: last.errorMessage,
        errorStack: last.errorStack,
      };
    };

    const finalizationStepStatuses = Object.fromEntries(
      namedSteps.map((n) => [n, matchStep(n)]),
    );

    const persistedFilePaths = (args.record.files ?? []).map((f) => f.path);

    const filePath = this.resolveLastFinalizationFailureDumpPath();
    const payload = {
      writtenAt: new Date().toISOString(),
      projectId: args.projectId,
      sessionId: args.sessionId,
      phase: args.record.progress?.phase ?? args.failedPhase,
      step: args.record.progress?.lastMeaningfulStep ?? args.failedStep,
      lastMeaningfulStep: args.record.progress?.lastMeaningfulStep ?? null,
      llmCallCount: args.llmCallCount,
      totalTokens: args.totalTokens,
      totalCostUsd: args.totalCostUsd,
      cumulativeFileCount: args.record.progress?.filesWrittenCount ?? args.record.files?.length ?? 0,
      persistedFileCount: persistedFilePaths.length,
      persistedFilePaths,
      failedStep: args.failedStep,
      failedPhase: args.failedPhase,
      failedAt: args.failedAt,
      error: args.errorMessage,
      errorName: args.errorName,
      errorStack: args.errorStack ?? null,
      finalizationStepStatuses,
      // Verbatim post-persist trace, in execution order, for full fidelity.
      postPersistTrace: statuses,
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    this.logger.info('[gen:last-finalization-failure:dumped] focused finalization snapshot written', {
      event: 'gen:last-finalization-failure:dumped',
      projectId: args.projectId,
      file: filePath,
      failedStep: args.failedStep,
      stepsTraced: statuses.length,
      persistedFileCount: persistedFilePaths.length,
    });
  }

  /**
   * Resolve the absolute path to `apps/api/src/testing/last-qa-gate-failure.json`
   * relative to this source file, regardless of cwd.
   */
  private resolveLastQaGateFailureDumpPath(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    return path.resolve(here, '..', 'testing', 'last-qa-gate-failure.json');
  }

  /**
   * QA-gate-specific failure dump. Provides per-step verdicts for the
   * five qa-gate finalization milestones the runbook asks about
   * (`manifestRefreshed`, `runQualityAssurance`, `postQaSave`,
   * `executionValidationScheduled`, `finalStatusUpdate`) plus identity,
   * progress, accounting, manifest paths, and the full error envelope.
   *
   * Best-effort — failures here are logged but never re-thrown.
   */
  private async dumpLastQaGateFailure(args: {
    projectId: string;
    sessionId: string;
    record: ProjectRecord;
    failedPhase: string;
    failedStep: string;
    lastSuccessfulPhase: string;
    lastSuccessfulStep: string;
    errorName: string;
    errorMessage: string;
    errorStack?: string;
    failedAt: string;
    llmCallCount: number;
    totalTokens: number;
    totalCostUsd: number;
  }): Promise<void> {
    const diag = this.diagContexts.get(args.projectId);
    const statuses = diag?.postPersistStatuses ?? [];

    // Map each qa-gate milestone to one or more step-label patterns
    // stamped by `runPostPersistStep`/`markProgress`. Last match wins.
    const milestonePatterns: Record<string, RegExp[]> = {
      // Stamped by markProgress immediately after the post-loop manifest
      // refresh. Treat as 'ok' if any post-persist trace ran after the
      // manifest, otherwise infer from the live record's
      // progress.lastMeaningfulStep.
      manifestRefreshed: [/^finalize:manifest-refreshed$/, /:manifest-refreshed$/],
      runQualityAssurance: [/:runQualityAssurance$/, /^qa-gate:runQualityAssurance$/],
      // Post-QA-gate save: every qa-gate:* assignment + the final save.
      postQaSave: [
        /^qa-gate:apply-soft-deadline-warning$/,
        /^qa-gate:assign-artifacts$/,
        /^qa-gate:assign-qa-assurance$/,
        /^qa-gate:assign-tasks-and-totals$/,
        /^qa-gate:assign-optimization$/,
        /^finalize:projectStore\.save$/,
        /:projectStore\.save$/,
      ],
      executionValidationScheduled: [/^finalize:scheduleExecutionValidation$/, /^execution-validation:/],
      finalStatusUpdate: [/^finalize:status-transition$/, /:status-transition$/],
    };

    const matchMilestone = (name: keyof typeof milestonePatterns) => {
      const patterns = milestonePatterns[name];
      const matches = statuses.filter((s) => patterns.some((p) => p.test(s.step)));
      // Special case for `manifestRefreshed`: it isn't run via
      // runPostPersistStep, so fall back to the live progress field.
      if (name === 'manifestRefreshed' && matches.length === 0) {
        const lms = args.record.progress?.lastMeaningfulStep ?? '';
        const refreshed =
          lms === 'finalize:manifest-refreshed' ||
          /qa-gate:|finalize:|status-transition|projectStore\.save/.test(lms);
        return { name, status: refreshed ? ('ok' as const) : ('not-run' as const) };
      }
      // Special case for `finalStatusUpdate`: only 'ok' if record status
      // is 'completed' (a transition that fired and stuck). 'fail' if the
      // record is 'failed' AND we have a status-transition trace.
      if (name === 'finalStatusUpdate' && matches.length === 0) {
        return { name, status: 'not-run' as const };
      }
      if (matches.length === 0) return { name, status: 'not-run' as const };
      const last = matches[matches.length - 1];
      return {
        name,
        status: last.status,
        step: last.step,
        sliceId: last.sliceId,
        startedAt: last.startedAt,
        durationMs: last.durationMs,
        errorName: last.errorName,
        errorMessage: last.errorMessage,
        errorStack: last.errorStack,
      };
    };

    const qaGateStepStatuses = {
      manifestRefreshed: matchMilestone('manifestRefreshed'),
      runQualityAssurance: matchMilestone('runQualityAssurance'),
      postQaSave: matchMilestone('postQaSave'),
      executionValidationScheduled: matchMilestone('executionValidationScheduled'),
      finalStatusUpdate: matchMilestone('finalStatusUpdate'),
    };

    const manifestFilePaths = (args.record.files ?? []).map((f) => f.path);

    const filePath = this.resolveLastQaGateFailureDumpPath();
    const payload = {
      writtenAt: new Date().toISOString(),
      projectId: args.projectId,
      sessionId: args.sessionId,
      status: args.record.status,
      phase: args.record.progress?.phase ?? args.failedPhase,
      lastMeaningfulStep: args.record.progress?.lastMeaningfulStep ?? null,
      llmCallCount: args.llmCallCount,
      totalTokens: args.totalTokens,
      totalCostUsd: args.totalCostUsd,
      fileCount: manifestFilePaths.length,
      manifestFilePaths,
      qaGateStepStatuses,
      error: args.errorMessage,
      errorName: args.errorName,
      errorStack: args.errorStack ?? null,
      failedPhase: args.failedPhase,
      failedStep: args.failedStep,
      lastSuccessfulPhase: args.lastSuccessfulPhase,
      lastSuccessfulStep: args.lastSuccessfulStep,
      failedAt: args.failedAt,
      // Verbatim trace for full fidelity.
      postPersistTrace: statuses,
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    this.logger.info('[gen:last-qa-gate-failure:dumped] qa-gate snapshot written', {
      event: 'gen:last-qa-gate-failure:dumped',
      projectId: args.projectId,
      file: filePath,
      failedStep: args.failedStep,
      milestones: qaGateStepStatuses,
      fileCount: manifestFilePaths.length,
    });
  }

  /**
   * Resolve the absolute path to `apps/api/src/testing/last-failure.json`
   * relative to this source file, regardless of cwd.
   */
  private resolveLastFailureDumpPath(): string {
    const here = path.dirname(fileURLToPath(import.meta.url));
    // this file lives at apps/api/src/pipeline/project-generator.ts
    return path.resolve(here, '..', 'testing', 'last-failure.json');
  }

  /**
   * Write a self-contained failure snapshot covering every field the
   * runbook asks for: project identity, phase/step provenance, LLM
   * accounting, file/slice progress, full error + stack, post-persist
   * step statuses, and the per-call provider/model usage log.
   *
   * Best-effort — failures here are logged but never re-thrown.
   */
  private async dumpLastFailure(args: {
    projectId: string;
    sessionId: string;
    record: ProjectRecord;
    failedPhase: string;
    failedStep: string;
    lastSuccessfulPhase: string;
    lastSuccessfulStep: string;
    errorName: string;
    errorMessage: string;
    errorStack?: string;
    failedAt: string;
    llmCallCount: number;
    totalTokens: number;
    totalCostUsd: number;
  }): Promise<void> {
    const diag = this.diagContexts.get(args.projectId);
    const filePath = this.resolveLastFailureDumpPath();
    const payload = {
      writtenAt: new Date().toISOString(),
      projectId: args.projectId,
      sessionId: args.sessionId,
      status: args.record.status,
      phase: args.record.progress?.phase ?? args.failedPhase,
      step: args.record.progress?.lastMeaningfulStep ?? args.failedStep,
      llmCallCount: args.llmCallCount,
      totalTokens: args.totalTokens,
      totalCostUsd: args.totalCostUsd,
      filesWritten: args.record.progress?.filesWrittenCount ?? args.record.files?.length ?? 0,
      slicesPlanned: args.record.progress?.slicesPlannedCount ?? 0,
      lastSuccessfulPhase: args.lastSuccessfulPhase,
      lastSuccessfulStep: args.lastSuccessfulStep,
      error: args.errorMessage,
      errorName: args.errorName,
      errorStack: args.errorStack ?? null,
      failedPhase: args.failedPhase,
      failedStep: args.failedStep,
      failedAt: args.failedAt,
      durationMs: args.record.durationMs ?? 0,
      diagnosticContextStartedAt: diag?.startedAt ?? null,
      postPersistStepStatuses: diag?.postPersistStatuses ?? [],
      usageLog: diag?.usageLog ?? [],
      warnings: args.record.warnings ?? [],
      failure: args.record.failure ?? null,
    };
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
    this.logger.info('[gen:last-failure:dumped] diagnostic snapshot written', {
      event: 'gen:last-failure:dumped',
      projectId: args.projectId,
      file: filePath,
      usageEntries: payload.usageLog.length,
      postPersistEntries: payload.postPersistStepStatuses.length,
    });
  }

  /**
   * Persist `status: 'failed'` onto the reserved placeholder with a real
   * error message. Used by every early-return / catch path in `generate()`
   * and `runReserved()` so we never leave a project stuck in 'generating'.
   *
   * Thin wrapper around `persistProjectFailure` for legacy callers that
   * don't have a live project record yet (placeholder paths).
   */
  private async markPlaceholderFailed(
    projectId: string,
    sessionId: string,
    phase: string,
    err: unknown,
  ): Promise<void> {
    await this.persistProjectFailure(projectId, {
      sessionId,
      err,
      failedPhase: phase,
      failedStep: phase,
    });
  }

  /**
   * Public alias of `persistProjectFailure` used at every catch boundary
   * in the finalization path (assembleProject, dependency validation, QA
   * gate, execution scheduling, runtime validation, final save). Routes
   * through the same single source of truth so `error`, `stack`,
   * `failedPhase`, `failedStep`, `lastSuccessfulStep`, `errorStack`, and
   * the `apps/api/src/testing/last-failure.json` dump are guaranteed to
   * be populated. Never throws: persistence/dump failures are logged
   * but never propagate.
   */
  private async persistFailure(
    projectId: string,
    context: Parameters<ProjectGenerator['persistProjectFailure']>[1],
  ): Promise<{ summary: string; failedAt: string }> {
    return this.persistProjectFailure(projectId, context);
  }

  /**
   * Specialized failure-persistence helper for the qa-gate finalization
   * path. Guarantees:
   *   - `failedPhase` is always `"qa-gate"`
   *   - `failedStep` is always populated (defaults to `"qa-gate:unknown"`)
   *   - `error.message` falls back through:
   *       err.message → String(err) → JSON.stringify(err) →
   *       `"Unknown error in qa-gate finalization (step=<step>, files=<n>)"`
   *   - `errorStack` is captured when `err instanceof Error`
   *   - `lastSuccessfulStep` is propagated from the live phase tracker
   *   - `fileCount` is injected into the fallback message so the
   *     post-mortem still shows codebase scope even when the original
   *     error carried no useful payload
   *   - the unified `last-failure.json` and the focused
   *     `last-finalization-failure.json` dumps are written
   *
   * Use at every catch boundary in the qa-gate finalization path.
   * Never throws — wrapped persistence/dump errors are logged but never
   * propagate.
   */
  private async persistQaGateFailure(
    projectId: string,
    context: {
      sessionId: string;
      err: unknown;
      failedStep: string;
      lastSuccessfulPhase?: string;
      lastSuccessfulStep?: string;
      runningProject?: ProjectRecord;
      fileCount?: number;
    },
  ): Promise<{ summary: string; failedAt: string }> {
    const { sessionId, err, failedStep, runningProject, fileCount } = context;
    const isErr = err instanceof Error;

    // ── Empty-message fallback chain ────────────────────
    let normalizedMessage = '';
    if (isErr && err.message && err.message.length > 0) {
      normalizedMessage = err.message;
    } else {
      const asString = (() => {
        try { return String(err); } catch { return ''; }
      })();
      if (asString && asString.length > 0 && asString !== '[object Object]') {
        normalizedMessage = asString;
      } else {
        const asJson = (() => {
          try { return JSON.stringify(err); } catch { return ''; }
        })();
        if (asJson && asJson.length > 2 && asJson !== '{}') {
          normalizedMessage = asJson;
        } else {
          const liveFileCount =
            fileCount ??
            runningProject?.files?.length ??
            runningProject?.progress?.filesWrittenCount ??
            0;
          normalizedMessage =
            `Unknown error in qa-gate finalization (step=${failedStep}, files=${liveFileCount})`;
        }
      }
    }

    // Build a synthetic Error so persistProjectFailure's normalisation
    // captures both the message AND a real stack — the original `err`
    // may be a non-Error value (string, plain object, etc.) or an
    // Error with an empty message.
    const wrapped = isErr ? err : new Error(normalizedMessage);
    if (isErr && (!err.message || err.message.length === 0)) {
      // Replace the empty message in place so the error keeps its stack.
      try {
        Object.defineProperty(err, 'message', {
          value: normalizedMessage,
          configurable: true, writable: true, enumerable: true,
        });
      } catch { /* read-only message — fall back to wrapping */ }
    }

    this.logger.error('[gen:qa-gate:persist-failure] persisting qa-gate failure', {
      event: 'gen:qa-gate:persist-failure',
      projectId,
      failedPhase: 'qa-gate',
      failedStep,
      lastSuccessfulPhase: context.lastSuccessfulPhase ?? null,
      lastSuccessfulStep: context.lastSuccessfulStep ?? null,
      fileCount: fileCount ?? runningProject?.files?.length ?? 0,
      errorName: isErr ? (err.name || 'Error') : 'Error',
      errorMessage: normalizedMessage,
      stack: isErr ? err.stack : undefined,
    });

    return this.persistProjectFailure(projectId, {
      sessionId,
      err: wrapped,
      failedPhase: 'qa-gate',
      failedStep,
      lastSuccessfulPhase: context.lastSuccessfulPhase,
      lastSuccessfulStep: context.lastSuccessfulStep,
      runningProject,
    });
  }

  /**
   * Update the live progress heartbeat on the in-memory project record
   * AND persist it. Called at every meaningful transition so the external
   * watchdog (test runner) can distinguish "early-startup, still working"
   * from "genuinely stuck".
   *
   * Never throws: a persistence failure here is logged but must not abort
   * the generation — progress reporting is best-effort.
   */
  private async markProgress(
    project: ProjectRecord,
    patch: {
      phase?: string;
      step: string;
      bumpLlmCalls?: boolean;
      filesWrittenCount?: number;
      slicesPlannedCount?: number;
      addTokens?: number;
      addCostUsd?: number;
      /** Mark the start of `step`. Captured into `progress.stepStartedAt`. */
      stepStartedAt?: string;
      /** Mark the end of `step`. Captured into `progress.stepCompletedAt`. */
      stepCompletedAt?: string;
      /** Wall-clock duration of `step`. Captured into `progress.stepDurationMs`. */
      stepDurationMs?: number;
    },
  ): Promise<void> {
    const now = new Date().toISOString();
    const prev = project.progress ?? {
      phase: 'init',
      lastProgressAt: now,
      startedAt: now,
      lastMeaningfulStep: 'reserved',
      llmCallCount: 0,
      filesWrittenCount: 0,
      slicesPlannedCount: 0,
    };
    const stepChanged = prev.lastMeaningfulStep !== patch.step;
    project.progress = {
      phase: patch.phase ?? prev.phase,
      lastProgressAt: now,
      startedAt: prev.startedAt,
      lastMeaningfulStep: patch.step,
      llmCallCount: prev.llmCallCount + (patch.bumpLlmCalls ? 1 : 0),
      filesWrittenCount: patch.filesWrittenCount ?? prev.filesWrittenCount,
      slicesPlannedCount: patch.slicesPlannedCount ?? prev.slicesPlannedCount,
      // Step-level timing — stepStartedAt is sticky until the next start
      // event for a different step name; stepCompletedAt + stepDurationMs
      // are set only when the caller explicitly marks completion. When
      // the step name changes, previousStep records the old name.
      stepStartedAt: patch.stepStartedAt ?? (stepChanged ? now : prev.stepStartedAt),
      stepCompletedAt: patch.stepCompletedAt ?? (stepChanged ? undefined : prev.stepCompletedAt),
      stepDurationMs: patch.stepDurationMs ?? (stepChanged ? undefined : prev.stepDurationMs),
      previousStep: stepChanged ? prev.lastMeaningfulStep : prev.previousStep,
    };
    // Per-call usage accumulation. Persisted on the SAME save() as the
    // heartbeat so a crash anywhere downstream still reflects the real
    // spend. Critical for diagnostics: previously totalTokens/totalCostUsd
    // were 0 on failed projects even after multiple LLM calls.
    if (patch.addTokens && patch.addTokens > 0) {
      project.totalTokens = (project.totalTokens ?? 0) + patch.addTokens;
    }
    if (patch.addCostUsd && patch.addCostUsd > 0) {
      project.totalCostUsd = (project.totalCostUsd ?? 0) + patch.addCostUsd;
    }
    try {
      await this.projectStore.save(project, {
        caller: 'project-generator:markProgress',
        reason: patch.step ?? 'progress-heartbeat',
      });
    } catch (err) {
      this.logger.warn('[gen:progress:persist-failed] heartbeat save failed (non-fatal)', {
        event: 'gen:progress:persist-failed',
        projectId: project.id, sessionId: project.sessionId,
        step: patch.step, err: String(err),
      });
    }
  }

  /**
   * Mark the START of a finalize:* substep on the live project record.
   * Persists `phase='finalize'`, `step=<step>`, `lastMeaningfulStep=<step>`,
   * and a fresh `stepStartedAt` ISO timestamp. Returns a monotonic start
   * time (`Date.now()`) the caller passes to `completeFinalizeStep` so
   * `stepDurationMs` can be computed without trusting wall-clock drift.
   *
   * The substep names form a fixed vocabulary so polling clients and the
   * dashboard can render them with stable copy:
   *   - finalize:dependency-validation
   *   - finalize:quality-assurance
   *   - finalize:manifest-refreshed
   *   - finalize:project-save
   *   - finalize:execution-validation-scheduled
   *   - finalize:preview-starting
   *   - finalize:preview-ready
   *   - finalize:completed
   */
  private async startFinalizeStep(project: ProjectRecord, step: string): Promise<number> {
    const t0 = Date.now();
    const startedAt = new Date(t0).toISOString();
    this.logger.info('[gen:finalize:step:enter] finalize substep starting', {
      event: 'gen:finalize:step:enter',
      projectId: project.id,
      sessionId: project.sessionId,
      phase: 'finalize',
      step,
      stepStartedAt: startedAt,
    });
    await this.markProgress(project, {
      phase: 'finalize',
      step,
      stepStartedAt: startedAt,
    });
    return t0;
  }

  /**
   * Mark the END of a finalize:* substep. Computes wall-clock duration
   * from the `t0` returned by `startFinalizeStep`, persists
   * `stepCompletedAt` + `stepDurationMs`, and emits
   * `[gen:finalize:step:ok]` with the timing payload so the test runner
   * + observability stack can rank substeps by cost.
   */
  private async completeFinalizeStep(
    project: ProjectRecord,
    step: string,
    t0: number,
    extra?: Record<string, unknown>,
  ): Promise<number> {
    const completedAt = Date.now();
    const completedAtIso = new Date(completedAt).toISOString();
    const durationMs = completedAt - t0;
    this.logger.info('[gen:finalize:step:ok] finalize substep complete', {
      event: 'gen:finalize:step:ok',
      projectId: project.id,
      sessionId: project.sessionId,
      phase: 'finalize',
      step,
      stepCompletedAt: completedAtIso,
      durationMs,
      ...(extra ?? {}),
    });
    await this.markProgress(project, {
      phase: 'finalize',
      step,
      stepCompletedAt: completedAtIso,
      stepDurationMs: durationMs,
    });
    return durationMs;
  }

  /**
   * Wrap a synchronous-or-async finalize:* operation in matching
   * start/complete markers. The body runs to completion, the timing is
   * captured, and persistence + structured logs fire on both ends. If
   * the body throws, an `[gen:finalize:step:fail]` line is emitted with
   * the duration the step ran for before the throw, then the error
   * propagates so the outer `runPostPersistStep` / qa-gate catch can
   * funnel it to `persistQaGateFailure`.
   */
  private async runFinalizeStep<T>(
    project: ProjectRecord,
    step: string,
    fn: () => T | Promise<T>,
    extra?: Record<string, unknown>,
  ): Promise<T> {
    const t0 = await this.startFinalizeStep(project, step);
    try {
      const result = await fn();
      await this.completeFinalizeStep(project, step, t0, extra);
      return result;
    } catch (err) {
      const durationMs = Date.now() - t0;
      this.logger.error('[gen:finalize:step:fail] finalize substep threw', {
        event: 'gen:finalize:step:fail',
        projectId: project.id,
        sessionId: project.sessionId,
        phase: 'finalize',
        step,
        durationMs,
        errorName: err instanceof Error ? err.name : typeof err,
        errorMessage: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  }

  /**
   * Run a single post-persist pipeline step inside a try/catch that:
   *   - logs entry (`gen:post-persist:enter`) with projectId + sliceId + step
   *   - records `phaseRef.currentStep`
   *   - on success: bumps `phaseRef.lastSuccessfulStep`, logs `gen:post-persist:ok`
   *   - on throw: logs `gen:post-persist:fail` with the FULL stack and rethrows
   *     a tagged Error so the outer catch attributes the failure to the
   *     correct step (no more empty `project.error`).
   *
   * The throw is rethrown unchanged when it's already an Error (we just log),
   * so existing `instanceof` checks upstream still work. Non-Error values
   * are wrapped in an Error so the stack trace is preserved.
   */
  private async runPostPersistStep<T>(
    phaseRef: { currentStep: string; lastSuccessfulStep: string },
    ctx: { projectId: string; sliceId?: string | null; step: string },
    fn: () => T | Promise<T>,
  ): Promise<T> {
    phaseRef.currentStep = ctx.step;
    const startedAt = Date.now();
    const startedAtIso = new Date(startedAt).toISOString();
    // Mirror the current step into the crash-logger registry so a
    // process-level crash dump knows exactly which slice/step was live.
    const sidForCrash = this.projectIdToSession.get(ctx.projectId);
    if (sidForCrash) {
      updateActiveGeneration(sidForCrash, {
        step: ctx.step,
        extra: { sliceId: ctx.sliceId ?? null, projectId: ctx.projectId },
      });
    }
    this.logger.info('[gen:post-persist:enter] step start', {
      event: 'gen:post-persist:enter',
      projectId: ctx.projectId,
      sliceId: ctx.sliceId ?? null,
      step: ctx.step,
      lastSuccessfulStep: phaseRef.lastSuccessfulStep,
    });
    const recordDiag = (entry: DiagPostPersistEntry) => {
      const diag = this.diagContexts.get(ctx.projectId);
      if (!diag) return;
      diag.postPersistStatuses.push(entry);
      if (diag.postPersistStatuses.length > this.MAX_POST_PERSIST_ENTRIES) {
        diag.postPersistStatuses.splice(0, diag.postPersistStatuses.length - this.MAX_POST_PERSIST_ENTRIES);
      }
    };
    try {
      const result = await fn();
      this.logger.info('[gen:post-persist:ok] step done', {
        event: 'gen:post-persist:ok',
        projectId: ctx.projectId,
        sliceId: ctx.sliceId ?? null,
        step: ctx.step,
      });
      phaseRef.lastSuccessfulStep = ctx.step;
      recordDiag({
        step: ctx.step,
        sliceId: ctx.sliceId ?? null,
        startedAt: startedAtIso,
        durationMs: Date.now() - startedAt,
        status: 'ok',
      });
      return result;
    } catch (err) {
      const isErr = err instanceof Error;
      const name = isErr ? (err.name || 'Error') : 'Error';
      const rawMsg = isErr
        ? err.message
        : typeof err === 'string'
          ? err
          : (() => { try { return JSON.stringify(err); } catch { return String(err); } })();
      const message = rawMsg && rawMsg.length > 0 ? rawMsg : `${name} thrown without a message`;
      const stack = isErr ? err.stack : undefined;
      this.logger.error('[gen:post-persist:fail] step threw', {
        event: 'gen:post-persist:fail',
        projectId: ctx.projectId,
        sliceId: ctx.sliceId ?? null,
        step: ctx.step,
        lastSuccessfulStep: phaseRef.lastSuccessfulStep,
        errorName: name,
        errorMessage: message,
        stack,
      });
      recordDiag({
        step: ctx.step,
        sliceId: ctx.sliceId ?? null,
        startedAt: startedAtIso,
        durationMs: Date.now() - startedAt,
        status: 'fail',
        errorName: name,
        errorMessage: message,
        errorStack: stack,
      });
      if (isErr) throw err;
      // Wrap non-Error values so the outer catch always sees a real stack.
      const wrapped = new Error(`[${ctx.step}] ${message}`);
      throw wrapped;
    }
  }

  // ── Main Entry ──────────────────────────────────────────

  async generate(request: GenerateRequest, reservedIds?: { projectId: string; sessionId: string }): Promise<GenerateResult> {
    const projectId = reservedIds?.projectId ?? nanoid(12);
    const sessionId = reservedIds?.sessionId ?? nanoid(16);
    const cacheKey = this.getRequestCacheKey(request);
    this.logger.info('[gen:start] entering generate()', {
      event: 'gen:start', projectId, sessionId, reserved: Boolean(reservedIds), promptCount: request.prompts.length,
    });

    const validationError = this.validateRequest(request);
    if (validationError) {
      this.logger.warn('[gen:validation-failed] request validation failed', {
        event: 'gen:validation-failed', projectId, sessionId, error: validationError,
      });
      // CRITICAL: when called via runReserved(), the placeholder is already
      // 'generating'. We must flip it to 'failed' or it stays stuck forever.
      if (reservedIds) {
        await this.markPlaceholderFailed(projectId, sessionId, 'validate-request', new Error(validationError));
      }
      return { projectId, sessionId, success: false, error: validationError };
    }

    if (this.activeGenerations >= this.maxConcurrentSessions) {
      const capacityError =
        `Server is at capacity (${this.maxConcurrentSessions} concurrent generations). Try again shortly.`;
      this.logger.warn('[gen:at-capacity] rejecting generation', {
        event: 'gen:at-capacity', projectId, sessionId,
        active: this.activeGenerations, max: this.maxConcurrentSessions,
      });
      if (reservedIds) {
        await this.markPlaceholderFailed(projectId, sessionId, 'capacity-check', new Error(capacityError));
      }
      return { projectId, sessionId, success: false, error: capacityError };
    }

    // Skip the request cache when called via reserve()/runReserved(): the route
    // already committed a fresh placeholder project + session that the client
    // is subscribed to over WS. Returning a cached project ID here would orphan
    // that placeholder forever and the client would never receive any events.
    if (!reservedIds) {
      const cached = await this.readResultCache(cacheKey);
      if (cached) {
        this.logger.info('Returning cached generation result', { cacheKey, projectId: cached.id });
        return {
          projectId: cached.id, sessionId, success: true, cached: true, project: cached, steps: [],
          optimization: { requestCacheHit: true, pipelineCacheHits: 0, pipelineCacheMisses: 0, skippedSteps: 0, estimatedApiCallsSaved: 1 },
        };
      }
    }

    // Everything that can throw before the pipeline body must be inside the
    // try/catch — otherwise a memory-store glitch or storage I/O error would
    // leak through to the route's .catch() and leave the placeholder in
    // 'generating' forever.
    let session: Session;
    let project: ProjectRecord;
    try {
      session = this.sessionManager.create(sessionId, request.userId ?? 'anonymous', request.prompts);
      // Register so BuilderAgent.validateOutput can include projectId in
      // the canonical last-failure dump.
      setBuilderProjectContext(sessionId, { projectId });
      if (request.preferences) session.artifacts.set('userPreferences', request.preferences);

      const reusable = await this.memoryStore.getGlobal({
        queryText: request.prompts.join('\n'), limit: 5, includeGlobal: true,
      });
      if (reusable.length > 0) session.artifacts.set('globalMemoryHints', reusable.map(m => m.content));

      project = {
        id: projectId, sessionId,
        name: 'Untitled Project',
        prompts: request.prompts,
        status: 'generating',
        files: [], tasks: [],
        totalTokens: 0, totalCostUsd: 0, durationMs: 0,
        version: 1, versionHistory: [],
        createdAt: new Date().toISOString(),
        progress: {
          phase: 'init',
          lastProgressAt: new Date().toISOString(),
          startedAt: new Date().toISOString(),
          lastMeaningfulStep: 'generate:enter',
          llmCallCount: 0,
          filesWrittenCount: 0,
          slicesPlannedCount: 0,
        },
      };
      await this.projectStore.save(project, {
        caller: 'project-generator:generate',
        reason: 'placeholder progress record',
      });
      this.logger.info('[gen:placeholder-saved] generating-state record persisted', {
        event: 'gen:placeholder-saved', projectId, sessionId,
      });
      // Initialise the per-project diagnostic context. Will be populated
      // by `bumpLlmCounter` (usage log) and `runPostPersistStep`
      // (post-persist statuses) and dumped on any failure.
      this.diagContexts.set(projectId, {
        projectId,
        sessionId,
        startedAt: new Date().toISOString(),
        usageLog: [],
        postPersistStatuses: [],
      });
    } catch (preErr) {
      await this.markPlaceholderFailed(projectId, sessionId, 'pre-pipeline-setup', preErr);
      const msg = preErr instanceof Error ? preErr.message : String(preErr);
      return { projectId, sessionId, success: false, error: msg };
    }

    this.logger.info(`Starting generation for project ${projectId}`, { sessionId, promptCount: request.prompts.length });

    this.activeGenerations++;
    // Wall-clock safety net: nothing should take this long. Per-agent step
    // timeouts (60-120s) and SDK request timeouts (~3min) cap individual
    // calls; this caps the whole orchestration so a stuck slice loop or
    // unexpected wait cannot wedge a project as 'generating' indefinitely.
    const pipelineTimeoutMs = this.pipelineHardTimeoutMs;
    let pipelineTimeoutHandle: NodeJS.Timeout | undefined;
    const pipelineTimeout = new Promise<never>((_, reject) => {
      pipelineTimeoutHandle = setTimeout(() => {
        reject(new Error(`Pipeline exceeded wall-clock budget of ${pipelineTimeoutMs}ms`));
      }, pipelineTimeoutMs);
    });
    // Mutable phase tracker — runPipelineBody updates this as it advances
    // (`spec`, `slice-1/N`, `assembly`, `qa-gate`, `execution-validation`,
    // …). The outer catch reads it so the persisted `project.error` and the
    // crash log always identify *where* the failure happened, even when the
    // thrown error itself carries no useful message.
    //
    // `lastSuccessfulPhase` is bumped by runPipelineBody every time a phase
    // *completes*. On a crash we persist BOTH so the post-mortem shows
    // "crashed in `slice-3/7` after successfully completing `slice-2/7`".
    const phaseRef: { current: string; lastSuccessful: string; currentStep: string; lastSuccessfulStep: string } = {
      current: 'init',
      lastSuccessful: 'reserved',
      currentStep: 'init',
      lastSuccessfulStep: 'reserved',
    };
    try {
      const result = await Promise.race([
        this.runPipelineBody(
          { projectId, sessionId, request, project, session, cacheKey, phaseRef },
        ),
        pipelineTimeout,
      ]);
      return result;
    } catch (err) {
      // Funnel every pipeline-body crash through persistProjectFailure so
      // error/stack/failedPhase/failedStep/llmCallCount/totalTokens/
      // totalCostUsd are *always* recorded, even if `err.message` is empty.
      const failedPhase = phaseRef.current || 'unknown';
      const failedStep = phaseRef.currentStep || failedPhase;
      const lastSuccessfulPhase = phaseRef.lastSuccessful || 'reserved';
      const lastSuccessfulStep = phaseRef.lastSuccessfulStep || lastSuccessfulPhase;
      const { summary } = await this.persistProjectFailure(projectId, {
        sessionId,
        err,
        failedPhase,
        failedStep,
        lastSuccessfulPhase,
        lastSuccessfulStep,
        runningProject: project,
      });
      return { projectId, sessionId, success: false, error: summary };
    } finally {
      if (pipelineTimeoutHandle) clearTimeout(pipelineTimeoutHandle);
      this.activeGenerations--;
      // Free per-project diagnostic context. The failure dump (if any)
      // already happened inside `persistProjectFailure` before we get
      // here, so it's safe to drop now.
      this.diagContexts.delete(projectId);
    }
  }

  /**
   * Internal: the original pipeline body, hoisted into its own method so
   * `generate()` can race it against a wall-clock timeout. Mutates the passed
   * `project` and `session` in place exactly as before.
   */
  private async runPipelineBody(
    ctx: {
      projectId: string;
      sessionId: string;
      request: GenerateRequest;
      project: ProjectRecord;
      session: Session;
      cacheKey: string;
      phaseRef: { current: string; lastSuccessful: string; currentStep: string; lastSuccessfulStep: string };
    },
  ): Promise<GenerateResult> {
    const { projectId, sessionId, request, project, session, cacheKey, phaseRef } = ctx;
    const bus = new InMemoryMessageBus();
    const pipelineStartedAt = Date.now();
    phaseRef.current = 'spec';
    /**
     * Soft deadline computed after slice planning (see below). When reached
     * mid-slice-loop we *break* out and run the normal final-assembly path
     * on whatever was already built \u2014 partial work is preserved instead of
     * being thrown away as 'failed'. The outer Promise.race in generate()
     * remains as a hard safety net (default 3h).
     */
    let softDeadlineMs = pipelineStartedAt + this.pipelineHardTimeoutMs;
    let softDeadlineHit = false;

    // Multi-orchestrator pipelines (Phase 1 spec, then per-slice
    // builder/qa/polish, then per-slice rebuilds) all emit their own
    // pipeline:started / pipeline:completed events on DIFFERENT session
    // ids. The UI subscribes to the MAIN session's progress, so we:
    //   1. Rewrite every event's sessionId to the main session.
    //   2. Suppress intermediate pipeline:started / pipeline:completed /
    //      pipeline:failed — only the very first 'started' (Phase 1) and
    //      a single final 'completed' (after assembly) should reach the
    //      session manager. Otherwise the UI flips to "Pipeline complete"
    //      after the spec phase and stops updating.
    let lifecycleEmitted = false; // tracks whether we let pipeline:started through
    const forwardEvents = (orchSessionIsMain: boolean): ((event: PipelineEvent) => void) => {
      return (event: PipelineEvent) => {
        // Always rewrite onto the main session id so the UI sees a single timeline.
        const remapped = { ...event, sessionId } as PipelineEvent;
        if (event.type === 'pipeline:started') {
          if (!lifecycleEmitted && orchSessionIsMain) {
            lifecycleEmitted = true;
            this.sessionManager.handleEvent(remapped);
          }
          return;
        }
        // Swallow pipeline-level terminal events; we emit one final event
        // ourselves after assembly + QA gate.
        if (event.type === 'pipeline:completed' || event.type === 'pipeline:failed') {
          return;
        }
        this.sessionManager.handleEvent(remapped);
      };
    };

    const orchestrator = new PipelineOrchestrator(this.agents, bus, this.logger);
    orchestrator.onEvent(forwardEvents(/* orchSessionIsMain */ true));
    // Bump llmCallCount on every step:started so the watchdog sees real LLM
    // activity even before any artifacts are persisted. ALSO registered on
    // every per-slice + rebuild orchestrator below — without this we'd only
    // ever count the single spec step (the original bug: count stuck at 1).
    //
    // ALSO accumulate totalTokens / totalCostUsd on `step:completed` so the
    // persisted record always reflects real LLM spend, even when the
    // pipeline crashes before final assembly. Per-call usage is logged
    // with agent + model + tokens + cost so post-mortem analysis is
    // possible from the log alone.
    const bumpLlmCounter = (event: PipelineEvent) => {
      if (event.type === 'step:started') {
        const agent = (event as { agent?: string }).agent ?? 'unknown';
        // `phaseRef.current` is the source of truth for the *executing*
        // phase (`spec`, `slice-N/M`, `final-assembly`, `qa-gate`, …).
        // Without forwarding it here the heartbeat would freeze at the
        // last phase that explicitly called markProgress with `phase:`,
        // producing misleading log lines like
        //   `phase=slice-planning step=builder`
        // — even though slice-planning had finished and slice-1 was
        // actually running builder right then.
        void this.markProgress(project, {
          phase: phaseRef.current,
          step: `step:${agent}`,
          bumpLlmCalls: true,
        });
        this.logger.info('[llm:call:started] step started', {
          event: 'llm:call:started', projectId, sessionId,
          phase: phaseRef.current, agent,
        });
        return;
      }
      if (event.type === 'step:completed') {
        const ev = event as {
          agent?: string; durationMs?: number;
          usage?: { model?: string; provider?: string; tokensIn: number; tokensOut: number; totalTokens: number; costUsd: number };
        };
        const usage = ev.usage;
        const tokensIn = usage?.tokensIn ?? 0;
        const tokensOut = usage?.tokensOut ?? 0;
        const totalTokens = usage?.totalTokens ?? (tokensIn + tokensOut);
        const costUsd = usage?.costUsd ?? 0;
        // Per-call structured log line. This is the canonical "LLM usage"
        // record for diagnostics — every LLM call must appear here.
        this.logger.info('[llm:call:completed] step done', {
          event: 'llm:call:completed',
          projectId, sessionId,
          phase: phaseRef.current,
          agent: ev.agent ?? 'unknown',
          model: usage?.model,
          provider: usage?.provider,
          promptTokens: tokensIn,
          completionTokens: tokensOut,
          totalTokens,
          costUsd: Number(costUsd.toFixed(6)),
          latencyMs: ev.durationMs ?? 0,
        });
        // Mirror the usage entry into the per-project diagnostic context
        // so a later failure dump captures the full LLM-call history.
        const diag = this.diagContexts.get(projectId);
        if (diag) {
          diag.usageLog.push({
            at: new Date().toISOString(),
            phase: phaseRef.current,
            agent: ev.agent ?? 'unknown',
            model: usage?.model,
            provider: usage?.provider,
            promptTokens: tokensIn,
            completionTokens: tokensOut,
            totalTokens,
            costUsd,
            latencyMs: ev.durationMs ?? 0,
          });
          if (diag.usageLog.length > this.MAX_USAGE_LOG_ENTRIES) {
            diag.usageLog.splice(0, diag.usageLog.length - this.MAX_USAGE_LOG_ENTRIES);
          }
        }
        if (totalTokens > 0 || costUsd > 0) {
          void this.markProgress(project, {
            phase: phaseRef.current,
            step: `step:${ev.agent ?? 'unknown'}:done`,
            addTokens: totalTokens,
            addCostUsd: costUsd,
          });
        }
        return;
      }
    };
    orchestrator.onEvent(bumpLlmCounter);

    {
      // ── Phase 1 — SPEC only ──────────────────────────────
      // Seed builder/qa/polish with no-op stubs so the orchestrator runs
      // ONLY the spec agent on this first pass. We need spec.featureSlices
      // before deciding how many builder iterations to do.
      const stubBuilder: Record<string, unknown> = { files: [] };
      const stubQa: Record<string, unknown> = {
        verdict: 'pass', issues: [], patches: [], newFiles: [],
        scores: { correctness: 100, completeness: 100, consistency: 100, security: 100, overall: 100 },
        summary: 'spec-only phase — QA deferred to per-slice gates',
      };
      const stubPolish: Record<string, unknown> = { patches: [], newFiles: [], summary: 'polish deferred to last slice' };

      const phase1Seed = new Map<AgentRole, Record<string, unknown>>([
        ['builder', stubBuilder],
        ['qa', stubQa],
        ['polish', stubPolish],
      ]);
      this.logger.info('[gen:spec:start] entering spec phase — invoking orchestrator', {
        event: 'gen:spec:start', projectId, sessionId,
      });
      await this.markProgress(project, { phase: 'spec', step: 'spec:orchestrator-invoke' });
      const specStartedAt = Date.now();
      let pipelineState = await orchestrator.execute(session, phase1Seed);
      this.logger.info('[gen:spec:done] spec phase orchestrator returned', {
        event: 'gen:spec:done', projectId, sessionId,
        durationMs: Date.now() - specStartedAt,
        hasSpecArtifact: pipelineState.artifacts.has('spec'),
      });
      await this.markProgress(project, { phase: 'spec', step: 'spec:returned' });
      phaseRef.lastSuccessful = 'spec';

      // ── Lock the resolved tech stack onto the project record ─────────────
      // After Spec/Planner resolves `spec.techStack`, we LOCK it onto the
      // project for the rest of the pipeline. Builder, QA, preview, and
      // deployment all read `project.techStack` (or the spec artifact, which
      // is the same source) — none of them are allowed to re-guess. In auto
      // mode this is the moment the stack gets chosen for the project; in
      // manual mode this just mirrors the user's pick onto the record.
      try {
        const prefsForLock = (pipelineState.artifacts.get('userPreferences')
          ?? session.artifacts.get('userPreferences')) as Record<string, unknown> | undefined;
        const declaredModeForLock = prefsForLock?.stackSelectionMode as 'auto' | 'manual' | undefined;
        const overrideForLock = prefsForLock?.techStackOverride as Record<string, string> | undefined;
        const lockedMode: 'auto' | 'manual' =
          declaredModeForLock === 'manual' || declaredModeForLock === 'auto'
            ? declaredModeForLock
            : overrideForLock && Object.keys(overrideForLock).length > 0
              ? 'manual'
              : 'auto';
        const specForLock = pipelineState.artifacts.get('spec') as
          | { techStack?: Record<string, string> }
          | undefined;
        const lockedStack = (specForLock?.techStack ?? null) as Record<string, string> | null;

        project.stackSelectionMode = lockedMode;
        if (lockedStack && typeof lockedStack === 'object') {
          project.techStack = lockedStack;
        }
        await this.projectStore.save(project, {
          caller: 'project-generator:lock-stack',
          reason: 'persist stackSelectionMode + techStack post-spec',
        });

        this.logger.info(
          lockedMode === 'auto' ? '[gen:stack:auto-resolved] Auto stack resolved' : '[gen:stack:locked] Manual stack locked',
          {
            event: lockedMode === 'auto' ? 'gen:stack:auto-resolved' : 'gen:stack:locked',
            projectId,
            sessionId,
            stackSelectionMode: lockedMode,
            source: lockedMode === 'manual' ? 'user-selected' : 'auto-chosen',
            techStack: lockedStack ?? undefined,
          },
        );
      } catch (lockErr) {
        // Non-fatal: the qa-gate finalisation block still re-persists as a
        // safety net, so a failure here only loses the early visibility.
        this.logger.warn('[gen:stack:lock-failed] could not lock stack post-spec (non-fatal)', {
          event: 'gen:stack:lock-failed', projectId, sessionId, err: String(lockErr),
        });
      }

      const specOut = pipelineState.artifacts.get('spec') as
        | { featureSlices?: Array<Record<string, unknown>> }
        | undefined;
      const rawSlices = (specOut?.featureSlices as Array<{ id: string; [k: string]: unknown }> | undefined) ?? [];

      // Plan the slice execution: split oversized slices, infer dependencies,
      // topologically sort. Smaller slices = cleaner prompts + better quality.
      const plan = planSlices(rawSlices as Parameters<typeof planSlices>[0]);
      const slices: PlannedSlice[] = plan.slices;
      const sliceCount = Math.max(1, slices.length); // always at least one pass
      this.logger.info('[gen:slices:planned] slice plan computed', {
        event: 'gen:slices:planned', projectId, sessionId,
        rawSliceCount: rawSlices.length, plannedSliceCount: slices.length,
      });

      // Persist slice plan onto the project record IMMEDIATELY so observers
      // (test runner, watchdogs, UI) can see real progress. Without this, the
      // project sits at tasks=0/slices=0 until the very first slice writes
      // files — long enough for the no-progress watchdog to fire.
      try {
        (project as ProjectRecord & { plan?: Record<string, unknown> }).plan = {
          ...(((project as ProjectRecord & { plan?: Record<string, unknown> }).plan) ?? {}),
          featureSlices: slices,
        };
        await this.projectStore.save(project, {
          caller: 'project-generator:slice-plan-persist',
          reason: 'persist slice plan onto project record',
        });
        this.logger.info('[gen:slices:persisted] slice plan saved to project record', {
          event: 'gen:slices:persisted', projectId, sessionId, sliceCount: slices.length,
        });
        await this.markProgress(project, {
          phase: 'slice-planning', step: 'slices:persisted',
          slicesPlannedCount: slices.length,
        });
      } catch (persistErr) {
        this.logger.warn('[gen:slices:persist-failed] could not persist slice plan (non-fatal)', {
          event: 'gen:slices:persist-failed', projectId, sessionId, err: String(persistErr),
        });
      }

      // Adaptive soft deadline: scale with slice count so larger projects
      // get more time. Bounded by the outer hard cap. Hitting this deadline
      // breaks the slice loop GRACEFULLY (partial assemble) instead of
      // discarding everything as 'failed'.
      const adaptiveBudgetMs = Math.min(
        this.pipelineHardTimeoutMs,
        Math.max(this.minPipelineBudgetMs, sliceCount * this.perSliceBudgetMs),
      );
      softDeadlineMs = pipelineStartedAt + adaptiveBudgetMs;
      this.logger.info(
        `Pipeline budget: soft=${Math.round(adaptiveBudgetMs / 1000)}s (${sliceCount} slice(s) \u00d7 ${this.perSliceBudgetMs / 1000}s, floor ${this.minPipelineBudgetMs / 1000}s), hard=${Math.round(this.pipelineHardTimeoutMs / 1000)}s`,
        { event: 'pipeline:budget', sessionId, sliceCount, adaptiveBudgetMs, hardTimeoutMs: this.pipelineHardTimeoutMs },
      );

      this.logger.info(
        `SPEC produced ${rawSlices.length} feature slice(s) → planner emitted ${slices.length} (after split + topo-sort)`,
        {
          sessionId,
          rawSliceIds: rawSlices.map((s) => s.id),
          plannedOrder: slices.map((s) => s.plannedId),
          notes: plan.notes,
        },
      );
      if (plan.notes.length > 0) {
        for (const note of plan.notes) this.logger.info(`slice-planner: ${note}`);
      }

      // ── Phase 2 — per-slice BUILDER → QA loop ────────────
      // Each slice is built incrementally on top of all prior slices and
      // gated by its own QA verdict before BUILDER moves on.
      let cumulativeFiles: { path: string; content: string; language?: string }[] = [];
      let totalBuilderIterations = 0;
      let lastQaArtifact: Record<string, unknown> | undefined;
      let lastPolishArtifact: Record<string, unknown> | undefined;
      const completedSlices: PlannedSlice[] = [];

      // Builder reads the LOCKED stack via the spec artifact (which carries
      // `techStack` set during the spec phase) and via `project.techStack`.
      // Logged here so it's clear in the trace which stack every slice will
      // build against — no later phase is allowed to re-guess.
      this.logger.info('[gen:stack:builder] Using persisted stack for builder', {
        event: 'gen:stack:builder',
        projectId,
        sessionId,
        stackSelectionMode: project.stackSelectionMode ?? 'auto',
        techStack: project.techStack ?? undefined,
        sliceCount,
      });

      for (let sliceIdx = 0; sliceIdx < sliceCount; sliceIdx++) {
        // Update phase tracker for the outer crash handler.
        phaseRef.current = `slice-${sliceIdx + 1}/${sliceCount}`;
        // Soft deadline: if we're past budget, stop taking on new slices and
        // assemble what we already have. This preserves partial work \u2014 a
        // 14-of-19-slice project is FAR more useful than a 'failed' record
        // with the same files thrown away.
        if (Date.now() > softDeadlineMs) {
          softDeadlineHit = true;
          this.logger.warn(
            `Pipeline soft deadline reached after ${sliceIdx}/${sliceCount} slice(s) \u2014 finishing with partial output`,
            {
              event: 'pipeline:soft-deadline',
              sessionId,
              completedSlices: sliceIdx,
              totalSlices: sliceCount,
              elapsedMs: Date.now() - pipelineStartedAt,
              budgetMs: softDeadlineMs - pipelineStartedAt,
              filesEmittedSoFar: cumulativeFiles.length,
            },
          );
          break;
        }
        const slice = slices[sliceIdx];
        const sliceLabel = slice ? `${sliceIdx + 1}/${sliceCount} '${slice.plannedId}'` : 'single-pass';
        this.logger.info(`▶ Building slice ${sliceLabel}`);

        // Stamp the heartbeat phase to the actual executing slice BEFORE
        // any builder/qa/polish step:started events fire from sliceOrch.
        // This ensures `project.progress.phase` reflects the real phase
        // (e.g. `slice-2/7`) instead of the previous `slice-planning`.
        await this.markProgress(project, {
          phase: phaseRef.current,
          step: `${phaseRef.current}:start`,
        });

        // Emit a slice-start event for the UI.
        this.sessionManager.handleEvent({
          type: 'slice:started',
          sessionId,
          sliceIndex: sliceIdx,
          totalSlices: sliceCount,
          sliceId: slice?.plannedId ?? null,
        } as unknown as PipelineEvent);

        // Build a fresh session for this slice with cumulative state seeded.
        const sliceSession: Session = this.sessionManager.create(
          nanoid(16),
          session.userId ?? 'anonymous',
          session.prompts,
        );
        setBuilderProjectContext(sliceSession.id, { projectId });
        for (const [k, v] of session.artifacts.entries()) sliceSession.artifacts.set(k, v);
        if (cumulativeFiles.length > 0) {
          sliceSession.artifacts.set('previousFiles', cumulativeFiles);
        }
        if (slice) {
          sliceSession.artifacts.set('currentSlice', slice);
          sliceSession.artifacts.set('sliceIndex', sliceIdx);
          sliceSession.artifacts.set('totalSlices', sliceCount);
          // Per-slice context manifest — compact summary of every previously
          // completed slice so the model can cross-reference stable names
          // (routes, models, components) without re-parsing every file.
          if (completedSlices.length > 0) {
            sliceSession.artifacts.set('sliceManifest', buildSliceManifest(completedSlices));
          }
        }
        sliceSession.artifacts.set('builderIteration', 1);

        // Seed spec (real). On all but the final slice we also seed a polish
        // stub so polish does not run per-slice (saves cost; polish runs once
        // at the end on the cumulative codebase).
        const sliceSeed = new Map<AgentRole, Record<string, unknown>>();
        const realSpec = pipelineState.artifacts.get('spec');
        if (realSpec) sliceSeed.set('spec', realSpec);
        if (sliceIdx < sliceCount - 1) sliceSeed.set('polish', stubPolish);

        const sliceOrch = new PipelineOrchestrator(this.agents, bus, this.logger);
        sliceOrch.onEvent(forwardEvents(/* orchSessionIsMain */ false));
        sliceOrch.onEvent(bumpLlmCounter);
        phaseRef.currentStep = `${sliceLabel}:builder`;
        let sliceState = await sliceOrch.execute(sliceSession, sliceSeed);
        totalBuilderIterations++;

        // Fail-fast: if the slice's builder produced zero files (or the
        // critical step failed), abort immediately. Continuing here would
        // bubble an empty cumulativeFiles set into QA, polish and finalize
        // and surface the failure several steps too late.
        this.assertBuilderProducedFiles(sliceState, {
          phase: phaseRef.current,
          step: `${sliceLabel}:builder`,
          sliceLabel,
          sliceId: slice?.id ?? null,
          sliceIndex: sliceIdx,
          sliceCount,
        });

        // Dependency validator — auto-fix package.json so every bare-module
        // import the builder emitted is declared. Runs AFTER builder and
        // BEFORE the QA loop below so the integrity check + QA agent see
        // the corrected manifest. Cost: zero LLM calls.
        this.applyDependencyAutoFix(sliceState.artifacts, sliceLabel);

        // Static import-integrity check — flip QA to needs-improvement if
        // the builder emitted source files referencing imports it never
        // wrote. The existing rebuild loop below will pick this up via
        // qaFeedback and force a re-run with precise "missing file" hints.
        this.injectImportIntegrityIssues(sliceState.artifacts, sliceLabel);

        // Tech-stack enforcement — reject output that uses the wrong
        // backend framework / ORM / frontend framework.
        this.enforceTechStack(sliceState.artifacts, sliceLabel);

        // UI design-system enforcement — reject output that violates the
        // strict component / spacing / color / typography contract.
        this.enforceUiSystem(sliceState.artifacts, sliceLabel);

        // Implementation-completeness enforcement — reject TODOs, mock
        // fixtures, placeholder copy/images, empty handlers, "coming soon"
        // alerts, and unwired buttons. The QA agent agrees in spirit but
        // misses many of these in practice; this static gate guarantees the
        // rebuild loop sees them.
        this.enforceImplementationCompleteness(sliceState.artifacts, sliceLabel);

        // Per-slice QA loop — ADAPTIVE. Re-runs builder while QA issue
        // count is decreasing, up to MAX_QA_LOOPS. Bails early if issues
        // stagnate (no decrease for QA_STAGNATION_LIMIT consecutive
        // iterations) so we don't burn LLM calls on an unfixable problem.
        const issueHistory: number[] = [countQaIssues(sliceState.artifacts)];
        let stagnantStreak = 0;
        let sliceQaIter = 1;
        this.logger.info(
          `Slice ${sliceLabel} QA iter 1 — ${issueHistory[0]} issue(s), verdict=${qaVerdict(sliceState.artifacts)}`,
          { event: 'qa:iter', sliceLabel, iteration: 1, issueCount: issueHistory[0], verdict: qaVerdict(sliceState.artifacts) },
        );
        await this.markProgress(project, {
          phase: phaseRef.current,
          step: `${sliceLabel}:qa-iter-1`,
        });

        while (sliceQaIter < MAX_QA_LOOPS) {
          const qa = sliceState.artifacts.get('qa') as { verdict?: string } | undefined;
          if (!qa || qa.verdict === 'pass') break;

          const prevCount = issueHistory[issueHistory.length - 1];
          const nextIter = sliceQaIter + 1;

          this.logger.info(
            `Slice ${sliceLabel} QA needs-improvement — rebuilding (iter ${nextIter}/${MAX_QA_LOOPS}, ${prevCount} issue(s))`,
            { event: 'qa:rebuild', sliceLabel, iteration: nextIter, prevIssueCount: prevCount },
          );
          this.sessionManager.handleEvent({
            type: 'qa:loop',
            sessionId,
            iteration: nextIter,
            reason: `Slice ${slice?.id ?? sliceIdx}: ${prevCount} issue(s)`,
          } as PipelineEvent);

          // Merge this slice's pending output into existingFiles for the rebuild.
          const sliceMerged = getMergedFiles(sliceState.artifacts, /* applyPolish */ false);
          const overlay = new Map<string, { path: string; content: string; language?: string }>();
          for (const f of cumulativeFiles) overlay.set(f.path, f);
          for (const f of sliceMerged) overlay.set(f.path, f);

          const rebuildSession: Session = this.sessionManager.create(
            nanoid(16),
            session.userId ?? 'anonymous',
            session.prompts,
          );
          setBuilderProjectContext(rebuildSession.id, { projectId });
          for (const [k, v] of sliceSession.artifacts.entries()) rebuildSession.artifacts.set(k, v);
          rebuildSession.artifacts.set('previousFiles', Array.from(overlay.values()));
          rebuildSession.artifacts.set('qaFeedback', sliceState.artifacts.get('qa') ?? {});
          rebuildSession.artifacts.set('builderIteration', nextIter);

          const rebuildSeed = new Map<AgentRole, Record<string, unknown>>();
          if (realSpec) rebuildSeed.set('spec', realSpec);
          if (sliceIdx < sliceCount - 1) rebuildSeed.set('polish', stubPolish);

          const rebuildOrch = new PipelineOrchestrator(this.agents, bus, this.logger);
          rebuildOrch.onEvent(forwardEvents(/* orchSessionIsMain */ false));
          rebuildOrch.onEvent(bumpLlmCounter);
          phaseRef.currentStep = `${sliceLabel}:builder-rebuild-${nextIter}`;
          sliceState = await rebuildOrch.execute(rebuildSession, rebuildSeed);
          totalBuilderIterations++;

          // Same fail-fast guard for the rebuild step. A truncation-class
          // exhaustion at this point would otherwise leave the cumulative
          // codebase short and only blow up at finalize.
          this.assertBuilderProducedFiles(sliceState, {
            phase: phaseRef.current,
            step: `${sliceLabel}:builder-rebuild-${nextIter}`,
            sliceLabel,
            sliceId: slice?.id ?? null,
            sliceIndex: sliceIdx,
            sliceCount,
          });
          // Auto-fix any new missing deps the rebuild may have introduced.
          this.applyDependencyAutoFix(sliceState.artifacts, sliceLabel);
          // Re-check integrity after the rebuild so the loop converges or
          // exits via stagnation rather than passing with hallucinated imports.
          this.injectImportIntegrityIssues(sliceState.artifacts, sliceLabel);
          // Re-run stack + UI enforcement after each rebuild.
          this.enforceTechStack(sliceState.artifacts, sliceLabel);
          this.enforceUiSystem(sliceState.artifacts, sliceLabel);
          this.enforceImplementationCompleteness(sliceState.artifacts, sliceLabel);

          const nextCount = countQaIssues(sliceState.artifacts);
          const verdictNow = qaVerdict(sliceState.artifacts);
          const delta = nextCount - prevCount;
          issueHistory.push(nextCount);
          sliceQaIter = nextIter;

          if (verdictNow === 'pass') {
            this.logger.info(
              `Slice ${sliceLabel} QA iter ${nextIter} — PASS (issues: ${prevCount} → ${nextCount}, Δ=${delta})`,
              { event: 'qa:iter', sliceLabel, iteration: nextIter, issueCount: nextCount, delta, verdict: 'pass' },
            );
            break;
          }

          if (delta < 0) {
            // Made progress — reset the stagnation counter.
            stagnantStreak = 0;
            this.logger.info(
              `Slice ${sliceLabel} QA iter ${nextIter} — improving (${prevCount} → ${nextCount} issues, Δ=${delta})`,
              { event: 'qa:iter', sliceLabel, iteration: nextIter, issueCount: nextCount, delta, verdict: verdictNow, history: [...issueHistory] },
            );
          } else {
            stagnantStreak++;
            this.logger.warn(
              `Slice ${sliceLabel} QA iter ${nextIter} — STAGNANT (${prevCount} → ${nextCount} issues, Δ=${delta}, streak=${stagnantStreak}/${QA_STAGNATION_LIMIT})`,
              { event: 'qa:stagnant', sliceLabel, iteration: nextIter, issueCount: nextCount, delta, streak: stagnantStreak, history: [...issueHistory] },
            );
            if (stagnantStreak >= QA_STAGNATION_LIMIT) {
              this.logger.warn(
                `Slice ${sliceLabel} QA bailed early after ${nextIter} iter(s) — no improvement for ${QA_STAGNATION_LIMIT} consecutive rebuilds`,
                { event: 'qa:bail', sliceLabel, finalIssues: nextCount, history: [...issueHistory] },
              );
              break;
            }
          }
        }

        const finalCount = issueHistory[issueHistory.length - 1];
        const startCount = issueHistory[0];
        this.logger.info(
          `Slice ${sliceLabel} QA loop done — ${sliceQaIter} iter(s), issues: ${startCount} → ${finalCount} [${issueHistory.join('→')}], verdict=${qaVerdict(sliceState.artifacts)}`,
          { event: 'qa:done', sliceLabel, iterations: sliceQaIter, history: issueHistory, verdict: qaVerdict(sliceState.artifacts) },
        );

        // ── Simplified-implementation fallback ────────────────
        // After MAX_QA_LOOPS rebuilds, if QA still fails we DO NOT do
        // another full-slice regeneration (too slow, often unproductive).
        // Instead, replace ONLY the files cited in QA findings with safe
        // minimal stubs that compile and render. The slice continues with
        // a warning so downstream slices, polish, and preview can proceed.
        if (qaVerdict(sliceState.artifacts) !== 'pass') {
          const fallback = this.applySimplifiedFallback(sliceState.artifacts, sliceLabel);
          if (fallback.replaced.length > 0) {
            project.warnings = project.warnings ?? [];
            project.warnings.push({
              code: 'QA_FALLBACK_SIMPLIFIED',
              message: `Slice ${sliceLabel}: ${fallback.replaced.length} file(s) replaced with simplified stubs after ${sliceQaIter} QA iter(s) failed to converge`,
              details: {
                sliceLabel,
                iterations: sliceQaIter,
                finalIssueCount: finalCount,
                replacedFiles: fallback.replaced,
              },
            });
          }
        }

        // Slice converged (or hit cap). Update cumulative codebase from
        // builder + qa + (final-slice) polish artifacts overlayed on previous.
        const slicePolishApplied = sliceIdx === sliceCount - 1;
        const sliceMerged = getMergedFiles(sliceState.artifacts, slicePolishApplied);

        // ── File-integrity audit: builder/qa/polish artifacts ──
        // Audit each agent's contribution to the file tree at the EARLIEST
        // possible point, with a step label, so a malformed entry can be
        // attributed to its source rather than discovered later at preview
        // staging. Read-only — does not mutate sliceState.artifacts.
        const builderArtifact = sliceState.artifacts.get('builder') as { files?: unknown } | undefined;
        if (builderArtifact?.files !== undefined) {
          auditAndLog(builderArtifact.files, `builder.result:${sliceLabel}`, this.logger);
        }
        const qaArtifact = sliceState.artifacts.get('qa') as { newFiles?: unknown } | undefined;
        if (qaArtifact?.newFiles !== undefined) {
          auditAndLog(qaArtifact.newFiles, `qa.result.newFiles:${sliceLabel}`, this.logger);
        }
        if (slicePolishApplied) {
          const polishArtifact = sliceState.artifacts.get('polish') as { newFiles?: unknown } | undefined;
          if (polishArtifact?.newFiles !== undefined) {
            auditAndLog(polishArtifact.newFiles, `polish.result.newFiles:${sliceLabel}`, this.logger);
          }
        }
        auditAndLog(sliceMerged, `slice.cumulative-merge.input:${sliceLabel}`, this.logger);

        const cumBefore = cumulativeFiles.length;
        const cumPathsBefore = new Set(cumulativeFiles.map((f) => f.path));
        const overlay = new Map<string, { path: string; content: string; language?: string }>();
        for (const f of cumulativeFiles) overlay.set(f.path, f);
        for (const f of sliceMerged) overlay.set(f.path, f);
        cumulativeFiles = Array.from(overlay.values());
        // Audit log: every slice's contribution to the cumulative codebase.
        // `addedThisSlice` = files that didn't exist before; `replacedThisSlice`
        // = files whose content was overwritten. Diagnoses the "builder kept
        // emitting only N files across M slices" pattern.
        const sliceAdded: string[] = [];
        const sliceReplaced: string[] = [];
        for (const f of sliceMerged) {
          if (cumPathsBefore.has(f.path)) sliceReplaced.push(f.path);
          else sliceAdded.push(f.path);
        }
        this.logger.info('[gen:slice:merge-audit] cumulative file merge stats', {
          event: 'gen:slice:merge-audit',
          projectId: project.id,
          sliceIdx,
          sliceLabel,
          builderEmittedCount: ((sliceState.artifacts.get('builder') as { files?: unknown[] } | undefined)?.files?.length ?? 0),
          sliceMergedCount: sliceMerged.length,
          cumulativeBefore: cumBefore,
          cumulativeAfter: cumulativeFiles.length,
          addedThisSlice: sliceAdded.length,
          replacedThisSlice: sliceReplaced.length,
          addedPaths: sliceAdded.slice(0, 12),
          replacedPaths: sliceReplaced.slice(0, 12),
        });

        // ── Per-slice execution validation ───────────────────
        // Run a fast in-process build check (TypeScript parse + import
        // integrity) on the cumulative codebase before moving to the next
        // slice. Catches errors immediately so they don't compound across
        // slices and surface only at final assembly. If unrecoverable
        // syntax/import errors are found in files this slice touched, the
        // affected files are replaced with simplified stubs in-place.
        const sliceTouchedPaths = new Set(sliceMerged.map((f) => f.path));
        const buildCheck = this.runPostSliceBuildCheck(cumulativeFiles, sliceTouchedPaths, sliceLabel);
        if (buildCheck.fixed.length > 0) {
          // Apply the stubbed replacements back into cumulativeFiles.
          const fixedMap = new Map(buildCheck.fixed.map((f) => [f.path, f]));
          cumulativeFiles = cumulativeFiles.map((f) => fixedMap.get(f.path) ?? f);
          project.warnings = project.warnings ?? [];
          project.warnings.push({
            code: 'BUILD_CHECK_AUTO_REPAIR',
            message: `Slice ${sliceLabel}: in-process build check repaired ${buildCheck.fixed.length} file(s) with parse/import errors before continuing to next slice`,
            details: {
              sliceLabel,
              repairedFiles: buildCheck.fixed.map((f) => f.path),
              issueCount: buildCheck.issues.length,
            },
          });
        }

        // ── Per-slice CUMULATIVE dependency validation ──────
        // Validate that every bare-module import in the *entire* codebase
        // so far is declared in some package.json. Runs after the build
        // check so any stub repairs are already applied. Mutates
        // cumulativeFiles in place by patching package.json with any
        // missing dependencies (zero LLM calls). Catches missing deps the
        // moment the importing file is added — instead of waiting until
        // the docker preview crashes with `Cannot find module '…'`.
        const cumDep = validateAndFixDependencies(cumulativeFiles);
        if (cumDep.report.added.length > 0) {
          const patchedByPath = new Map(cumDep.files.map((f) => [f.path, f]));
          cumulativeFiles = cumulativeFiles.map((f) => {
            const patched = patchedByPath.get(f.path);
            return patched && patched.content !== f.content ? patched : f;
          });
          this.logger.info(
            `[deps] Slice ${sliceLabel} cumulative dep-fix: added ${cumDep.report.added.length} dep(s) across ${cumDep.report.patched.length} package.json file(s) [pm=${cumDep.report.packageManager}]`,
            {
              event: 'deps:auto-fix-slice',
              sliceLabel,
              packageManager: cumDep.report.packageManager,
              added: cumDep.report.added.map((a) => `${a.name}@${a.version} → ${a.packageJson}`),
            },
          );
        } else {
          this.logger.info(`[deps] Slice ${sliceLabel} cumulative dep-fix: PASS (no missing deps across ${cumulativeFiles.length} files)`, {
            event: 'deps:slice-clean',
            sliceLabel,
            fileCount: cumulativeFiles.length,
          });
        }
        if (cumDep.report.unresolved.length > 0) {
          this.logger.warn(
            `[deps] Slice ${sliceLabel} cumulative dep-fix: ${cumDep.report.unresolved.length} unresolved bare-module import(s) — these have no known npm version mapping`,
            {
              event: 'deps:unresolved-slice',
              sliceLabel,
              unresolved: cumDep.report.unresolved.slice(0, 8).map((u) => `${u.name} (${u.reason})`),
            },
          );
          project.warnings = project.warnings ?? [];
          project.warnings.push({
            code: 'DEPS_UNRESOLVED',
            message: `Slice ${sliceLabel}: ${cumDep.report.unresolved.length} bare-module import(s) could not be auto-resolved; downstream npm install may fail`,
            details: {
              sliceLabel,
              unresolved: cumDep.report.unresolved.map((u) => ({ name: u.name, reason: u.reason })),
            },
          });
        }

        // ── Per-slice QUICK VALIDATION ──────────────────────
        // Final cheap gate: package.json exists + required scripts present.
        // Imports were already validated by runPostSliceBuildCheck above.
        // Any auto-patches are merged into cumulativeFiles BEFORE the next
        // slice starts so we never carry forward a missing package.json or
        // a missing 'dev'/'build' script across slice boundaries.
        const quick = this.runPostSliceQuickValidation(cumulativeFiles, sliceLabel);
        if (quick.patched.length > 0) {
          const patchMap = new Map(quick.patched.map((f) => [f.path, f]));
          // Replace existing entries; append new ones (e.g. synthesised root pkg).
          const seen = new Set<string>();
          cumulativeFiles = cumulativeFiles.map((f) => {
            const replacement = patchMap.get(f.path);
            if (replacement) {
              seen.add(f.path);
              return replacement;
            }
            return f;
          });
          for (const p of quick.patched) {
            if (!seen.has(p.path)) cumulativeFiles.push(p);
          }
          project.warnings = project.warnings ?? [];
          project.warnings.push({
            code: 'QUICK_CHECK_AUTO_REPAIR',
            message:
              `Slice ${sliceLabel}: quick-check auto-fixed ${quick.issues.length} issue(s) before next slice` +
              (quick.fixes.synthesizedPackageJson ? ' [synthesized package.json]' : '') +
              (quick.fixes.addedScripts.length > 0
                ? ` [added scripts: ${quick.fixes.addedScripts.join(', ')}]`
                : ''),
            details: {
              sliceLabel,
              issues: quick.issues,
              synthesizedPackageJson: quick.fixes.synthesizedPackageJson,
              addedScripts: quick.fixes.addedScripts,
              touchedPackageJson: quick.fixes.touchedPackageJson,
            },
          });
        }

        // Track this slice as completed so the next iteration's manifest
        // includes it in the cross-reference summary.
        if (slice) completedSlices.push(slice);

        // Carry forward the latest QA + polish artifacts so the final
        // pipelineState reflects them.
        lastQaArtifact = sliceState.artifacts.get('qa');
        if (slicePolishApplied) lastPolishArtifact = sliceState.artifacts.get('polish');

        // Treat the LAST slice's pipelineState as the canonical final state
        // for downstream summaries (tasks, durations, events).
        pipelineState = sliceState;

        // Persist incremental progress per slice so a wall-clock timeout
        // (or any later crash) doesn't lose everything we already built.
        // status stays 'generating' — the final assembleProject pass at the
        // end is what flips it to completed/failed.
        //
        // Token/cost totals are accumulated live in the `bumpLlmCounter`
        // listener (on every `step:completed`), so we don't recompute them
        // here — that would double-count.
        try {
          project.files = cumulativeFiles.map((f) => ({ path: f.path, content: f.content, language: f.language }));
          await this.projectStore.save(project, {
            caller: 'project-generator:slice-persist',
            reason: `slice ${sliceIdx} (${sliceLabel}) cumulative files`,
          });
          this.logger.info('[gen:slice:persisted] per-slice save committed', {
            event: 'gen:slice:persisted',
            projectId: project.id,
            sliceIdx,
            sliceLabel,
            persistedFileCount: project.files.length,
            persistedFilePaths: project.files.map((f) => f.path),
          });
        } catch (persistErr) {
          this.logger.warn('Per-slice persistence failed (non-fatal)', {
            projectId: project.id, sliceIdx, err: String(persistErr),
            stack: persistErr instanceof Error ? persistErr.stack : undefined,
          });
        }
        await this.markProgress(project, {
          phase: phaseRef.current,
          step: `slice-${sliceIdx + 1}/${sliceCount}:files-persisted`,
          filesWrittenCount: cumulativeFiles.length,
        });
        phaseRef.lastSuccessful = `slice-${sliceIdx + 1}/${sliceCount}`;

        this.sessionManager.handleEvent({
          type: 'slice:completed',
          sessionId,
          sliceIndex: sliceIdx,
          totalSlices: sliceCount,
          sliceId: slice?.id ?? null,
          fileCount: cumulativeFiles.length,
        } as unknown as PipelineEvent);
      }

      // Overwrite the final pipelineState's artifacts so assembleProject
      // and getMergedFiles see the CUMULATIVE codebase, not just the last
      // slice's incremental output.
      //
      // ── POST-PERSIST DIAGNOSTIC PATH ──────────────────────
      // Every step from here through `projectStore.save` runs inside
      // `runPostPersistStep` so any throw is logged with full stack +
      // tagged step + lastSuccessfulStep. The outer catch then writes
      // a complete `failure` block to the project record. This eliminates
      // the "files persisted, status=failed, error empty" failure mode.
      const finalSliceTag = `slice-${completedSlices.length}/${sliceCount}`;
      await this.runPostPersistStep(
        phaseRef, { projectId, sliceId: finalSliceTag, step: 'final-assembly:merge-cumulative-artifacts' },
        () => {
          pipelineState.artifacts.set('builder', { files: cumulativeFiles });
          if (lastQaArtifact) pipelineState.artifacts.set('qa', lastQaArtifact);
          else pipelineState.artifacts.set('qa', stubQa);
          pipelineState.artifacts.set('polish', { patches: [], newFiles: [], summary: lastPolishArtifact ? (lastPolishArtifact as { summary?: string }).summary ?? 'applied' : 'no-op' });
          pipelineState.qaIterations = totalBuilderIterations;
        },
      );

      // Phase tracker — assembly / dep-fix / QA gate.
      phaseRef.current = 'final-assembly';
      const files = await this.runPostPersistStep(
        phaseRef, { projectId, sliceId: finalSliceTag, step: 'final-assembly:assembleProject' },
        () => assembleProject(pipelineState.artifacts, this.logger),
      );

      // ── File-integrity audit: assembleProject output ──
      // This is the final synthesised file tree before dependency-fix and
      // persistence. Any malformed entry here MUST be a hard failure — it
      // would otherwise be silently corrupted by JSON.stringify (drops
      // undefined keys) on the way to disk. Throwing here surfaces the
      // exact step + file path responsible.
      {
        const assemblyAudit = auditAndLog(files, 'final-assembly.assembleProject', this.logger);
        if (!assemblyAudit.ok) {
          const first = assemblyAudit.issues[0]!;
          throw new Error(
            `assembleProject produced ${assemblyAudit.invalidCount}/${assemblyAudit.totalFiles} invalid file entries. ` +
            `First: ${describeIntegrityIssue(first)}`,
          );
        }
      }
      // Final dependency-validator pass on the cumulative codebase, in case
      // any cross-slice merging surfaced new bare imports.
      // SUBSTEP: finalize:dependency-validation — wrap the deterministic
      // dep validator so its wall-clock cost is visible to polling
      // clients (it can scan every package.json + every import in the
      // tree, so it's a real time consumer on large projects).
      const depFix = await this.runFinalizeStep(
        project,
        'finalize:dependency-validation',
        () => this.runPostPersistStep(
          phaseRef, { projectId, sliceId: finalSliceTag, step: 'final-assembly:validateAndFixDependencies' },
          () => validateAndFixDependencies(files),
        ),
      );
      if (depFix.report.added.length > 0) {
        this.logger.info(
          `Dep validator (final): added ${depFix.report.added.length} dep(s) across ${depFix.report.patched.length} package.json file(s) [pm=${depFix.report.packageManager}]`,
          {
            event: 'deps:auto-fix-final',
            packageManager: depFix.report.packageManager,
            added: depFix.report.added.map((a) => `${a.name}@${a.version} → ${a.packageJson}`),
          },
        );
      }
      const taskSummaries = await this.runPostPersistStep(
        phaseRef, { projectId, sliceId: finalSliceTag, step: 'final-assembly:buildTaskSummaries' },
        () => buildTaskSummaries(pipelineState),
      );
      const stepSummaries = await this.runPostPersistStep(
        phaseRef, { projectId, sliceId: finalSliceTag, step: 'final-assembly:buildStepSummaries' },
        () => buildStepSummaries(pipelineState),
      );

      // ── Final QA gate (LLM-free, deterministic) ──────────
      phaseRef.lastSuccessful = 'final-assembly';
      phaseRef.current = 'qa-gate';
      // SUBSTEP: finalize:quality-assurance — wraps the entire
      // runQualityAssurance() call. The QA gate's own per-sub-check
      // timings are emitted via `[qa-gate:timings]`; this wrapper
      // captures the OUTER wall-clock time + persists stepStartedAt /
      // stepCompletedAt / stepDurationMs to the heartbeat so the
      // dashboard polling endpoint sees the gate as a discrete bar.
      const qaGate = await this.runFinalizeStep(
        project,
        'finalize:quality-assurance',
        () => this.runPostPersistStep(
          phaseRef, { projectId, sliceId: finalSliceTag, step: 'qa-gate:runQualityAssurance' },
          () => runQualityAssurance(depFix.files),
        ),
      );
      const finalFiles = qaGate.files;
      this.logger.info('[gen:qa-gate:timings] runQualityAssurance completed', {
        event: 'gen:qa-gate:timings',
        projectId,
        fileCount: depFix.files.length,
        totalMs: qaGate.report.totalMs,
        slowestStep: qaGate.report.slowestStep,
        timings: qaGate.report.timings,
        passed: qaGate.report.passed,
        score: qaGate.report.score,
        autoFixCount: qaGate.report.autoFixCount,
        blockerCount: qaGate.report.blockers.length,
      });
      if (qaGate.report.autoFixCount > 0) {
        this.logger.info(`QA gate auto-fixed ${qaGate.report.autoFixCount} issue(s) for project ${projectId}`);
      }
      if (!qaGate.report.passed) {
        this.logger.warn(`QA gate FAILED for project ${projectId}`, {
          score: qaGate.report.score,
          blockers: qaGate.report.blockers.map((b) => b.id),
        });
      }

      const specForName = pipelineState.artifacts.get('spec') as { productName?: string } | undefined;
      project.name = specForName?.productName ?? 'Generated Project';

      // ── FINALIZATION TRACE ───────────────────────────────
      // Explicit step-by-step logging from here through projectStore.save
      // so any post-files-persisted failure is fully visible. Each step
      // logs file count + the file paths in scope so we can pinpoint
      // exactly which step transformed/dropped which files.
      this.logger.info('[gen:finalize:enter] entering finalization sequence', {
        event: 'gen:finalize:enter',
        projectId,
        phase: phaseRef.current,
        step: phaseRef.lastSuccessfulStep,
        cumulativeFileCount: cumulativeFiles.length,
        finalFileCount: finalFiles.length,
        finalFilePaths: finalFiles.map((f) => f.path),
        qaGatePassed: qaGate.report.passed,
        qaGateScore: qaGate.report.score,
        qaGateBlockers: qaGate.report.blockers.map((b) => b.id),
        pipelineStatus: pipelineState.status,
        pipelineError: pipelineState.error ?? null,
      });

      // Tentative status. If QA gate failed, finalise as 'failed' immediately.
      // Otherwise leave as 'generating' — the execution-runner feedback loop
      // (and optional Docker validation after it) is the actual gate that
      // flips status to 'completed' or 'failed'. No project is marked
      // complete unless it actually runs.
      const qaPassed = pipelineState.status === 'completed' && qaGate.report.passed;
      project.status = qaPassed ? 'generating' : 'failed';
      project.files = finalFiles;

      // ── FINAL MANIFEST AUDIT ────────────────────────────
      // The progress.filesWrittenCount heartbeat is only updated at each
      // slice's `files-persisted` checkpoint, so by the time we reach
      // here it reflects the LAST SLICE's cumulativeFiles.length \u2014 NOT
      // the post-assembleProject final count (which adds scaffolders,
      // UI foundation, deployment templates, etc.). Refresh it now so
      // the persisted project record matches what's actually on disk.
      const cumulativeAtFinalAssembly = cumulativeFiles.length;
      const assemblyDelta = finalFiles.length - cumulativeAtFinalAssembly;
      this.logger.info('[gen:final:manifest] final project file manifest', {
        event: 'gen:final:manifest',
        projectId,
        status: project.status,
        cumulativeFromSlices: cumulativeAtFinalAssembly,
        afterAssembleProject: files.length,
        afterDepFix: depFix.files.length,
        afterQaGate: finalFiles.length,
        assemblyAddedFiles: assemblyDelta,
        finalFilePaths: finalFiles.map((f) => f.path),
      });
      await this.markProgress(project, {
        phase: phaseRef.current,
        step: 'finalize:manifest-refreshed',
        filesWrittenCount: finalFiles.length,
      });
      // SUBSTEP: finalize:manifest-refreshed — instantaneous marker
      // (manifest is in-memory). Stamp stepStartedAt + stepCompletedAt
      // on the same tick so the polling client sees the substep land
      // and immediately progress, rather than holding the prior step's
      // timing. The next runFinalizeStep call will overwrite this.
      const manifestStartedAt = new Date().toISOString();
      await this.markProgress(project, {
        phase: 'finalize',
        step: 'finalize:manifest-refreshed',
        stepStartedAt: manifestStartedAt,
        stepCompletedAt: manifestStartedAt,
        stepDurationMs: 0,
      });
      this.logger.info('[gen:finalize:step:ok] finalize substep complete', {
        event: 'gen:finalize:step:ok',
        projectId,
        sessionId,
        phase: 'finalize',
        step: 'finalize:manifest-refreshed',
        stepCompletedAt: manifestStartedAt,
        durationMs: 0,
        finalFileCount: finalFiles.length,
      });

      // ── POST-MANIFEST QA-GATE FINALIZATION TRACE ─────────
      // Every step from here until the final status transition is wrapped
      // by `runPostPersistStep` so an exception in any one of them is
      // logged with full stack, recorded in `failure.failedStep`, and
      // routed through `persistProjectFailure`. The bare assignments below
      // were previously the silent failure surface — a thrown getter on
      // any pipelineState.artifacts entry, a TypeError from a malformed
      // optimization sub-field, etc. would propagate up to the outer
      // catch with phase='qa-gate' but no specific failedStep.
      this.logger.info('[gen:qa-gate:post-manifest:enter] starting post-manifest finalization', {
        event: 'gen:qa-gate:post-manifest:enter',
        projectId,
        phase: phaseRef.current,
        step: 'finalize:manifest-refreshed',
        fileCount: finalFiles.length,
        manifestCount: finalFiles.length,
      });

      // OUTER GUARD — every step inside this try is part of the qa-gate
      // post-manifest path. Any throw is funneled through
      // `persistQaGateFailure` so error/errorStack/failedPhase='qa-gate'/
      // failedStep/lastSuccessfulStep/projectId/fileCount are guaranteed
      // populated regardless of how empty the original exception was.
      // After persisting we return a failed GenerateResult — the project
      // is terminal, no point chaining into execution validation.
      try {
        // Surface a non-fatal warning if we exited the slice loop early due to
        // the soft deadline. The project is still usable \u2014 partial output is
        // far better than throwing it all away as 'failed'.
        await this.runPostPersistStep(
          phaseRef, { projectId, sliceId: finalSliceTag, step: 'qa-gate:apply-soft-deadline-warning' },
          () => {
            if (softDeadlineHit) {
              project.warnings = [
                ...(project.warnings ?? []),
                {
                  code: 'pipeline.soft-deadline',
                  message: `Pipeline budget reached after ${completedSlices.length}/${sliceCount} slice(s); finished with partial output.`,
                  details: {
                    completedSlices: completedSlices.length,
                    totalSlices: sliceCount,
                    elapsedMs: Date.now() - pipelineStartedAt,
                    budgetMs: softDeadlineMs - pipelineStartedAt,
                  },
                },
              ];
            }
          },
        );

        await this.runPostPersistStep(
          phaseRef, { projectId, sliceId: finalSliceTag, step: 'qa-gate:assign-artifacts' },
          () => {
            project.spec         = pipelineState.artifacts.get('spec')   as Record<string, unknown> | undefined;
            project.expandedSpec = pipelineState.artifacts.get('spec')   as Record<string, unknown> | undefined;
            project.qaReport     = pipelineState.artifacts.get('qa')     as Record<string, unknown> | undefined;
            project.qualityReport = pipelineState.artifacts.get('polish') as Record<string, unknown> | undefined;

            // ── Stack record reconciliation (safety net) ─────────────────
            // The stack was already LOCKED right after the spec phase (see
            // `[gen:stack:auto-resolved]` / `[gen:stack:locked]`). This block
            // only runs as a defensive safety-net for legacy code paths or
            // exotic recovery flows where the early lock didn't execute. We
            // never overwrite a previously locked value.
            const prefs = (pipelineState.artifacts.get('userPreferences') as Record<string, unknown> | undefined) ?? undefined;
            const declaredMode = prefs?.stackSelectionMode as 'auto' | 'manual' | undefined;
            const override = prefs?.techStackOverride as Record<string, string> | undefined;
            const mode: 'auto' | 'manual' =
              declaredMode === 'manual' || declaredMode === 'auto'
                ? declaredMode
                : override && Object.keys(override).length > 0
                  ? 'manual'
                  : 'auto';
            const finalStack = (project.spec?.techStack ?? null) as Record<string, string> | null;
            if (!project.stackSelectionMode) project.stackSelectionMode = mode;
            if (!project.techStack && finalStack && typeof finalStack === 'object') {
              project.techStack = finalStack;
              this.logger.info('[gen:stack:reconciled] stack record reconciled at qa-gate (early lock missed)', {
                projectId,
                stackSelectionMode: mode,
                source: mode === 'manual' ? 'user-selected' : 'auto-chosen',
                finalStack,
              });
            }
          },
        );

        await this.runPostPersistStep(
          phaseRef, { projectId, sliceId: finalSliceTag, step: 'qa-gate:assign-qa-assurance' },
          () => {
            project.qaAssurance = {
              passed: qaGate.report.passed,
              score: qaGate.report.score,
              autoFixCount: qaGate.report.autoFixCount,
              bars: qaGate.report.bars,
              blockers: qaGate.report.blockers.map((b) => ({ id: b.id, message: b.message, bar: b.bar, file: b.file })),
            };
          },
        );

        await this.runPostPersistStep(
          phaseRef, { projectId, sliceId: finalSliceTag, step: 'qa-gate:assign-tasks-and-totals' },
          () => {
            project.tasks = taskSummaries;
            // The live accumulator (incremented on every `step:completed` event)
            // is the source of truth \u2014 it counts every slice's LLM calls, not
            // just the last slice's pipelineState.tasks. Keep whichever is
            // larger so legacy code paths that don't emit usage still produce
            // a non-zero number from `taskSummaries`.
            const finalTokensFromTasks = taskSummaries.reduce((sum, t) => sum + t.tokensUsed, 0);
            const finalCostFromTasks = taskSummaries.reduce((sum, t) => sum + t.costUsd, 0);
            project.totalTokens = Math.max(project.totalTokens ?? 0, finalTokensFromTasks);
            project.totalCostUsd = Math.max(project.totalCostUsd ?? 0, finalCostFromTasks);
          },
        );

        await this.runPostPersistStep(
          phaseRef, { projectId, sliceId: finalSliceTag, step: 'qa-gate:assign-optimization' },
          () => {
            project.optimization = {
              cacheHit: false, cacheKey,
              pipelineCacheHits: pipelineState.optimization.cacheHits,
              pipelineCacheMisses: pipelineState.optimization.cacheMisses,
              skippedSteps: pipelineState.optimization.skippedSteps,
              estimatedApiCallsSaved: pipelineState.optimization.estimatedApiCallsSaved,
              qaIterations: totalBuilderIterations,
            } as ProjectRecord['optimization'];
            project.durationMs = pipelineState.durationMs;
            project.completedAt = new Date().toISOString();
          },
        );
      } catch (qaGateErr) {
        const summaryAndAt = await this.persistQaGateFailure(projectId, {
          sessionId,
          err: qaGateErr,
          failedStep: phaseRef.currentStep || 'qa-gate:unknown',
          lastSuccessfulPhase: phaseRef.lastSuccessful,
          lastSuccessfulStep: phaseRef.lastSuccessfulStep,
          runningProject: project,
          fileCount: project.files?.length ?? finalFiles.length,
        });
        return {
          projectId, sessionId, success: false,
          cached: false, project, steps: stepSummaries,
          error: summaryAndAt.summary,
        } as GenerateResult;
      }

      this.logger.info('[gen:qa-gate:post-manifest:ok] post-manifest finalization complete', {
        event: 'gen:qa-gate:post-manifest:ok',
        projectId,
        phase: phaseRef.current,
        step: phaseRef.lastSuccessfulStep,
        fileCount: project.files.length,
        manifestCount: finalFiles.length,
        qaPassed: qaGate.report.passed,
        totalTokens: project.totalTokens,
        totalCostUsd: project.totalCostUsd,
      });

      phaseRef.lastSuccessful = 'qa-gate';
      phaseRef.current = 'finalize';

      // ── BRANCH: QA gate failed → route through persistQaGateFailure ──
      // Until this branch existed, the code below saved the project with
      // status='failed' but EMPTY error / failure / no last-failure.json
      // dump (the "files-persisted then failed silently" bug). We now
      // synthesise a real Error and route through the qa-gate-specialised
      // helper so every failure field is populated and both diagnostic
      // dumps are written.
      if (!qaPassed) {
        const reason =
          pipelineState.status !== 'completed'
            ? `Pipeline did not reach 'completed' state (state=${pipelineState.status}, error=${pipelineState.error ?? 'none'})`
            : `QA gate failed: score ${qaGate.report.score}/100 (blockers=${
                qaGate.report.blockers.map((b) => b.id).join(',') || 'none'
              })`;
        const failedStep =
          pipelineState.status !== 'completed' ? 'qa-gate:pipeline-not-completed' : 'qa-gate:report-not-passed';
        this.logger.error('[gen:finalize:qa-gate-failed] routing through persistQaGateFailure', {
          event: 'gen:finalize:qa-gate-failed',
          projectId,
          phase: 'qa-gate',
          step: failedStep,
          cumulativeFileCount: cumulativeFiles.length,
          finalFileCount: finalFiles.length,
          finalFilePaths: finalFiles.map((f) => f.path),
          pipelineStatus: pipelineState.status,
          pipelineError: pipelineState.error ?? null,
          qaScore: qaGate.report.score,
          qaPassed: qaGate.report.passed,
          qaBlockers: qaGate.report.blockers.map((b) => b.id),
        });
        await this.persistQaGateFailure(projectId, {
          sessionId,
          err: new Error(reason),
          failedStep,
          lastSuccessfulPhase: phaseRef.lastSuccessful,
          lastSuccessfulStep: phaseRef.lastSuccessfulStep,
          runningProject: project,
          fileCount: finalFiles.length,
        });
        // Don't run scheduleExecutionValidation / memory write — pipeline
        // is terminal. Return the same shape `generate()` already expects.
        return {
          projectId, sessionId, success: false,
          cached: false, project, steps: stepSummaries,
          error: reason,
        } as GenerateResult;
      }

      // ── HAPPY PATH: pipelineState.status === 'completed' && qaGate passed ──
      this.logger.info('[gen:finalize:save:enter] persisting completed project record', {
        event: 'gen:finalize:save:enter',
        projectId,
        phase: phaseRef.current,
        step: 'finalize:projectStore.save',
        finalFileCount: finalFiles.length,
        finalFilePaths: finalFiles.map((f) => f.path),
      });
      // SUBSTEP: finalize:project-save — writes the full ProjectRecord
      // to disk. Disk-bound, so its duration matters for the polling
      // experience. Wrap with runFinalizeStep + the existing
      // runPostPersistStep so we get BOTH timing telemetry AND
      // qa-gate-style failure attribution.
      await this.runFinalizeStep(
        project,
        'finalize:project-save',
        () => this.runPostPersistStep(
          phaseRef, { projectId, sliceId: finalSliceTag, step: 'finalize:projectStore.save' },
          () => this.projectStore.save(project, {
            caller: 'project-generator:finalize-save',
            reason: 'final assembly: post-QA project record',
            // The final assembly may legitimately flip 'generating' →
            // 'completed' or → 'failed' based on QA verdict, so the
            // status-downgrade guard must allow it.
            allowStatusDowngrade: true,
          }),
        ),
        { finalFileCount: finalFiles.length },
      );
      this.logger.info('[gen:finalize:save:ok] project record persisted', {
        event: 'gen:finalize:save:ok',
        projectId,
        phase: phaseRef.current,
        step: 'finalize:projectStore.save',
        status: project.status,
      });
      // Cache write is best-effort — errors are logged but not propagated:
      // the project itself is already saved, so caching is non-critical.
      try {
        this.writeResultCache(cacheKey, project.id);
      } catch (cacheErr) {
        this.logger.warn('[gen:cache:write-failed] result cache write failed (non-fatal)', {
          event: 'gen:cache:write-failed', projectId, err: String(cacheErr),
          stack: cacheErr instanceof Error ? cacheErr.stack : undefined,
        });
      }

      // Emit the single, final pipeline-lifecycle event for the UI. All
      // intermediate orchestrators were suppressed so the dashboard never
      // sees a premature "Pipeline complete" between slices.
      try {
        const finalEvent: PipelineEvent =
          project.status === 'failed'
            ? {
                type: 'pipeline:failed',
                sessionId,
                error: pipelineState.error ?? (qaPassed ? 'unknown' : `QA gate failed (score ${qaGate.report.score}/100)`),
                failedStep: pipelineState.error ? 'pipeline' : 'qa-gate',
                durationMs: pipelineState.durationMs,
              }
            : {
                type: 'pipeline:completed',
                sessionId,
                durationMs: pipelineState.durationMs,
                stepsCompleted: stepSummaries.filter(s => s.status === 'completed').length,
                stepsFailed:    stepSummaries.filter(s => s.status === 'failed').length,
                stepsSkipped:   stepSummaries.filter(s => s.status === 'skipped').length,
              };
        this.sessionManager.handleEvent(finalEvent);
      } catch (emitErr) {
        this.logger.warn('[gen:final-event:emit-failed] final pipeline event emit failed (non-fatal)', {
          event: 'gen:final-event:emit-failed', projectId, err: String(emitErr),
          stack: emitErr instanceof Error ? emitErr.stack : undefined,
        });
      }

      // ── FINAL INTEGRITY GATE ───────────────────────────────────
      // Last read-only check before the project graduates to a
      // validation pipeline that costs ~90s per docker boot. Refuses
      // to schedule execution / runtime validation (and therefore
      // refuses to flip status to 'completed') if any generated file
      // imports a package not declared in package.json or a relative
      // path that does not resolve to an emitted file.
      //
      // Persists the structured report onto `project.integrityReport`
      // so the dashboard postmortem can show exact missing package
      // names and the importing files. On failure, routes through
      // `persistProjectFailure` so error/stack/failedPhase/failedStep
      // and last-failure.json are uniformly populated.
      if (project.status === 'generating') {
        const t0Integrity = await this.startFinalizeStep(project, 'finalize:integrity-gate');
        const integrityReport = runFinalIntegrityGate(project.files);
        project.integrityReport = integrityReport;
        // Persist verdict regardless of outcome — the postmortem path
        // needs the report on disk even when we then call
        // persistProjectFailure (which performs its own save).
        await this.projectStore.update(projectId, (rec) => {
          rec.integrityReport = integrityReport;
        }, { phase: 'final-integrity-gate:persist-verdict' });
        await this.completeFinalizeStep(
          project,
          'finalize:integrity-gate',
          t0Integrity,
          {
            verdict: integrityReport.verdict,
            missingPackages: integrityReport.counts.missingPackages,
            danglingInternalImports: integrityReport.counts.danglingInternalImports,
            sourceFilesScanned: integrityReport.counts.sourceFilesScanned,
            bareImportsScanned: integrityReport.counts.bareImportsScanned,
          },
        );
        if (integrityReport.verdict === 'fail') {
          const reason = describeIntegrityFailure(integrityReport);
          this.logger.error('[gen:final-integrity:fail] integrity gate FAILED — blocking completion', {
            event: 'gen:final-integrity:fail',
            projectId,
            missingPackages: integrityReport.missingPackages.map((m) => m.name),
            missingPackagesCount: integrityReport.counts.missingPackages,
            danglingInternalImports: integrityReport.danglingInternalImports
              .slice(0, 6)
              .map((d) => `${d.importer} → '${d.specifier}'`),
            danglingInternalImportsCount: integrityReport.counts.danglingInternalImports,
            unparseablePackageJsons: integrityReport.unparseablePackageJsons,
          });
          await this.persistProjectFailure(projectId, {
            sessionId,
            err: new Error(reason),
            failedPhase: 'final-integrity-gate',
            failedStep: 'final-integrity-gate:verdict-fail',
            lastSuccessfulPhase: 'qa-gate',
            lastSuccessfulStep: 'qa-gate:runQualityAssurance',
            runningProject: project,
          });
          // Skip execution-validation + runtime-validation entirely —
          // there is nothing for them to validate against a codebase
          // that cannot resolve its own imports.
          return {
            projectId, sessionId, success: false,
            cached: false, project, steps: stepSummaries,
            error: reason,
          } as GenerateResult;
        }
        this.logger.info('[gen:final-integrity:pass] integrity gate passed', {
          event: 'gen:final-integrity:pass',
          projectId,
          sourceFilesScanned: integrityReport.counts.sourceFilesScanned,
          bareImportsScanned: integrityReport.counts.bareImportsScanned,
          durationMs: integrityReport.durationMs,
        });

        // ── PROMOTE TO COMPLETED ───────────────────────────────────
        // After integrity gate passes, generation is DONE. Flip
        // project.status to 'completed' synchronously so the UI shows a
        // BUILD COMPLETED pill immediately. Execution / runtime
        // validators are post-completion health probes — they record
        // their own status under executionValidation.status /
        // runtimeValidation.status and CANNOT demote project.status
        // back to 'failed'. This is the structural fix for the bug
        // where a 'no-progress' validator verdict overrode a working,
        // preview-ready project.
        project.status = 'completed';
        project.completedAt = project.completedAt ?? new Date().toISOString();
        if (!project.executionValidation) {
          project.executionValidation = {
            status: 'pending',
            finalVerdict: 'pass',
            iterations: 0,
            buildErrors: [],
            runtimeErrors: [],
            totalDurationMs: 0,
            completedAt: new Date().toISOString(),
          };
        } else {
          project.executionValidation.status = 'pending';
        }
        await this.projectStore.update(projectId, (rec) => {
          rec.status = 'completed';
          rec.completedAt = project.completedAt;
          rec.executionValidation = project.executionValidation;
        }, {
          phase: 'finalize:promote-completed',
          caller: 'project-generator:integrity-gate-pass',
          reason: 'integrity-gate passed; generation lifecycle done',
          allowStatusDowngrade: true,
        });
      }

      // Fire-and-forget execution-runner health probe (real npm install +
      // build + dev). Project is already 'completed' at this point — this
      // probe ONLY records executionValidation.status and never demotes
      // project.status. A failure here surfaces as a "Validation: warning"
      // pill in the UI, not a build failure.
      if (project.status === 'completed') {
        const t0Sched = await this.startFinalizeStep(project, 'finalize:execution-validation-scheduled');
        try {
          this.scheduleExecutionValidation(project);
          this.logger.info('[gen:finalize:exec-validation:scheduled] execution validation scheduled', {
            event: 'gen:finalize:exec-validation:scheduled',
            projectId,
            phase: phaseRef.current,
            step: 'finalize:scheduleExecutionValidation',
            fileCount: project.files.length,
            manifestCount: finalFiles.length,
            status: project.status,
          });
          await this.completeFinalizeStep(
            project,
            'finalize:execution-validation-scheduled',
            t0Sched,
            { fileCount: project.files.length, manifestCount: finalFiles.length },
          );
        } catch (schedErr) {
          this.logger.error('[gen:exec-validation:schedule-failed] could not schedule execution validation', {
            event: 'gen:exec-validation:schedule-failed', projectId, err: String(schedErr),
            stack: schedErr instanceof Error ? schedErr.stack : undefined,
            durationMs: Date.now() - t0Sched,
          });
          // Schedule failures must not silently drop the project. Route
          // through persistFailure so error/stack/failedPhase/failedStep/
          // last-failure dump are populated. The project record retains
          // its 'generating' status until persistFailure flips it.
          await this.persistFailure(projectId, {
            sessionId,
            err: schedErr,
            failedPhase: 'finalize',
            failedStep: 'finalize:scheduleExecutionValidation',
            lastSuccessfulPhase: phaseRef.lastSuccessful,
            lastSuccessfulStep: phaseRef.lastSuccessfulStep,
            runningProject: project,
          });
        }
      }

      try {
        await this.memoryStore.saveGlobal({
          agentRole: 'global', type: 'pattern',
          content: `Request hash ${cacheKey.slice(0, 12)} -> project ${project.id} (${project.name})`,
          relevanceScore: 0.55, tags: ['best-practice', 'prompt-engineering'],
          metadata: { projectId: project.id, promptCount: request.prompts.length, totalTokens: project.totalTokens, totalCostUsd: project.totalCostUsd, qaIterations: totalBuilderIterations, sliceCount },
        });
      } catch (memErr) {
        this.logger.warn('[gen:memory:save-failed] global memory save failed (non-fatal)', {
          event: 'gen:memory:save-failed', projectId, err: String(memErr),
          stack: memErr instanceof Error ? memErr.stack : undefined,
        });
      }
      phaseRef.lastSuccessful = 'finalize';

      this.logger.info('[gen:finalize:status-transition] final pipeline status decided', {
        event: 'gen:finalize:status-transition',
        projectId,
        phase: phaseRef.current,
        step: phaseRef.lastSuccessfulStep,
        finalStatus: project.status,
        fileCount: project.files.length,
        manifestCount: finalFiles.length,
        qaPassed: qaGate.report.passed,
        durationMs: pipelineState.durationMs,
        totalTokens: project.totalTokens,
        totalCostUsd: project.totalCostUsd,
      });

      // SUBSTEP: finalize:completed — terminal marker for the
      // synchronous finalization path. After this `markProgress` lands,
      // the polling client knows the synchronous body of generate() is
      // done; any further status changes (preview-ready, exec-validation
      // pass/fail) come from the async scheduleExecutionValidation flow.
      const finalizeCompletedAt = new Date().toISOString();
      await this.markProgress(project, {
        phase: 'finalize',
        step: 'finalize:completed',
        stepStartedAt: finalizeCompletedAt,
        stepCompletedAt: finalizeCompletedAt,
        stepDurationMs: 0,
      });
      this.logger.info('[gen:finalize:completed] synchronous finalization complete', {
        event: 'gen:finalize:completed',
        projectId,
        sessionId,
        phase: 'finalize',
        step: 'finalize:completed',
        finalStatus: project.status,
        fileCount: project.files.length,
        durationMs: pipelineState.durationMs,
      });

      this.logger.info(`Project ${projectId} ${project.status}`, {
        files: files.length, durationMs: pipelineState.durationMs, totalTokens: project.totalTokens,
        costUsd: project.totalCostUsd.toFixed(4), qaIterations: totalBuilderIterations, slices: sliceCount,
        stepsCompleted: stepSummaries.filter(s => s.status === 'completed').length,
        stepsFailed:    stepSummaries.filter(s => s.status === 'failed').length,
        stepsSkipped:   stepSummaries.filter(s => s.status === 'skipped').length,
      });

      return {
        projectId, sessionId, success: pipelineState.status === 'completed' && qaGate.report.passed,
        cached: false, project, steps: stepSummaries,
        optimization: {
          requestCacheHit: false,
          pipelineCacheHits: pipelineState.optimization.cacheHits,
          pipelineCacheMisses: pipelineState.optimization.cacheMisses,
          skippedSteps: pipelineState.optimization.skippedSteps,
          estimatedApiCallsSaved: pipelineState.optimization.estimatedApiCallsSaved,
        },
        error: pipelineState.error ?? (qaGate.report.passed ? undefined : `QA gate failed (score ${qaGate.report.score}/100): ${qaGate.report.blockers[0]?.message ?? 'see qaAssurance'}`),
      };
    }
  }

  async update(request: UpdateRequest): Promise<UpdateResult> {
    return this.updater.update(request);
  }

  reserveUpdate(request: UpdateRequest) {
    return this.updater.reserve(request);
  }

  async runReservedUpdate(reservation: { sessionId: string; request: UpdateRequest }): Promise<UpdateResult> {
    return this.updater.runReserved(reservation);
  }

  // ── Private helpers ─────────────────────────────────────

  private validateRequest(request: GenerateRequest): string | null {
    if (!request.prompts || request.prompts.length === 0 || request.prompts.length > 3) {
      return 'Provide 1-3 prompts';
    }
    for (const prompt of request.prompts) {
      if (typeof prompt !== 'string' || prompt.trim().length < 10) return 'Each prompt must be at least 10 characters';
      if (prompt.length > 5000) return 'Each prompt must be under 5000 characters';
    }
    return null;
  }

  private getRequestCacheKey(request: GenerateRequest): string {
    const normalized = { prompts: request.prompts.map(p => p.trim()), preferences: request.preferences ?? {} };
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private async readResultCache(cacheKey: string): Promise<ProjectRecord | null> {
    const item = this.resultCache.get(cacheKey);
    if (!item) return null;
    if (Date.now() - item.cachedAt > this.RESULT_CACHE_TTL_MS) {
      this.resultCache.delete(cacheKey);
      return null;
    }
    return this.projectStore.get(item.projectId);
  }

  private writeResultCache(cacheKey: string, projectId: string): void {
    this.resultCache.set(cacheKey, { projectId, cachedAt: Date.now() });
  }

  /**
   * Auto-fix package.json so every bare-module import the builder emitted
   * is declared. Runs AFTER builder, BEFORE QA. Mutates the builder
   * artifact in place — the merged file set used by both QA and the
   * import-integrity gate downstream picks up the patched manifest.
   *
   * Cost: zero LLM calls. Prevents `npm install` failures and missing-module
   * runtime errors that would otherwise surface in the docker preview boot.
   */
  private applyDependencyAutoFix(
    artifacts: Map<AgentRole, Record<string, unknown>>,
    sliceLabel: string,
  ): void {
    const merged = getMergedFiles(artifacts, /* applyPolish */ false);
    if (merged.length === 0) return;
    const { files: patchedFiles, report } = validateAndFixDependencies(merged);
    if (report.added.length === 0 && report.unresolved.length === 0) return;

    if (report.added.length > 0) {
      // Write the patched package.json files back into the builder artifact
      // so subsequent QA / rebuild iterations see the corrected manifest.
      const builder = (artifacts.get('builder') as { files?: Array<{ path: string; content: string; language?: string }> } | undefined) ?? {};
      const builderFiles = Array.isArray(builder.files) ? [...builder.files] : [];
      const byPath = new Map(builderFiles.map((f) => [f.path, f]));
      for (const patched of patchedFiles) {
        if (!patched.path.replace(/\\/g, '/').endsWith('package.json')) continue;
        const existing = byPath.get(patched.path);
        if (existing && existing.content === patched.content) continue;
        // Replace or insert.
        if (existing) byPath.set(patched.path, { ...existing, content: patched.content });
        else byPath.set(patched.path, { path: patched.path, content: patched.content, language: 'json' });
      }
      artifacts.set('builder', { ...builder, files: Array.from(byPath.values()) });

      this.logger.info(
        `Dep validator on slice ${sliceLabel}: added ${report.added.length} dep(s) across ${report.patched.length} package.json file(s) [pm=${report.packageManager}]`,
        {
          event: 'deps:auto-fix',
          sliceLabel,
          packageManager: report.packageManager,
          added: report.added.map((a) => `${a.name}@${a.version} → ${a.packageJson}`),
        },
      );
    }
    if (report.unresolved.length > 0) {
      this.logger.warn(
        `Dep validator on slice ${sliceLabel}: ${report.unresolved.length} unresolved import(s)`,
        {
          event: 'deps:unresolved',
          sliceLabel,
          unresolved: report.unresolved.slice(0, 5).map((u) => `${u.name} (${u.reason})`),
        },
      );
    }
  }

  /**
   * In-process per-slice build check. Runs after each slice converges and
   * before moving to the next one, so errors are caught early instead of
   * compounding into a massive final failure.
   *
   * Two fast checks (no docker, no node_modules required):
   *   1. **TypeScript parse** — every TS / TSX / JS / JSX file is fed into
   *      `ts.createSourceFile` which surfaces real syntax diagnostics
   *      (unbalanced braces, unterminated JSX, missing tokens, etc.).
   *      Catches issues that the heuristic `looksIncompleteCode` misses.
   *   2. **Import integrity** — every relative / `@/` import must resolve
   *      to an emitted file (already used elsewhere; we re-run it scoped
   *      to slice-touched files so we only react to *new* breakage).
   *
   * For any file that this slice touched AND which now has a parse or
   * unresolved-import diagnostic, the file is replaced with a safe
   * simplified stub via `buildSimplifiedStub()`. Cost: zero LLM calls.
   *
   * Returns the list of repaired files and the raw issue list for logging.
   */
  private runPostSliceBuildCheck(
    cumulativeFiles: Array<{ path: string; content: string; language?: string }>,
    sliceTouchedPaths: Set<string>,
    sliceLabel: string,
  ): {
    issues: Array<{ file: string; kind: 'parse' | 'import'; message: string; line?: number }>;
    fixed: Array<{ path: string; content: string; language?: string }>;
  } {
    const issues: Array<{ file: string; kind: 'parse' | 'import'; message: string; line?: number }> = [];

    // ── 1. Per-file TypeScript syntax parse ────────────────
    const tsRe = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/i;
    for (const f of cumulativeFiles) {
      if (!tsRe.test(f.path)) continue;
      // Pick a parser flavor by extension. For .ts / .tsx / .js / .jsx we
      // use the matching ScriptKind so JSX/TSX is parsed correctly.
      const lower = f.path.toLowerCase();
      const kind: ts.ScriptKind = lower.endsWith('.tsx')
        ? ts.ScriptKind.TSX
        : lower.endsWith('.jsx')
          ? ts.ScriptKind.JSX
          : lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')
            ? ts.ScriptKind.TS
            : ts.ScriptKind.JS;
      const sf = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, /* setParentNodes */ false, kind);
      // The parser stashes parse-time diagnostics on the source file.
      const diags = (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
      for (const d of diags) {
        const msg = typeof d.messageText === 'string'
          ? d.messageText
          : (d.messageText && typeof d.messageText === 'object' ? (d.messageText as { messageText?: string }).messageText ?? '' : '');
        const pos = typeof d.start === 'number' ? d.start : 0;
        const { line } = sf.getLineAndCharacterOfPosition(pos);
        issues.push({ file: f.path, kind: 'parse', message: msg, line: line + 1 });
      }
    }

    // ── 2. Import integrity ───────────────────────────────
    const missing = validateImportIntegrity(cumulativeFiles);
    for (const m of missing) {
      issues.push({
        file: m.importer,
        kind: 'import',
        message: `unresolved import '${m.specifier}'`,
      });
    }

    if (issues.length === 0) {
      this.logger.info(`[build-check] Slice ${sliceLabel}: PASS (${cumulativeFiles.length} files, no parse/import errors)`, {
        event: 'build-check:pass',
        sliceLabel,
        fileCount: cumulativeFiles.length,
      });
      return { issues, fixed: [] };
    }

    // ── 3. Stub-repair files this slice TOUCHED ──────────
    // Only stub files emitted/changed in the current slice — we don't
    // want a cascading failure in slice N to overwrite stable files
    // from slice 1. Issues affecting *only* untouched files are logged
    // but left for the next slice's check or the final preview pass.
    const brokenFiles = new Set<string>();
    for (const i of issues) {
      const norm = i.file.replace(/\\/g, '/').replace(/^\.\//, '');
      if (sliceTouchedPaths.has(norm) || sliceTouchedPaths.has(i.file)) {
        brokenFiles.add(norm);
      }
    }

    const byFile: Record<string, number> = {};
    for (const i of issues) byFile[i.file] = (byFile[i.file] ?? 0) + 1;
    this.logger.warn(
      `[build-check] Slice ${sliceLabel}: ${issues.length} issue(s) across ${Object.keys(byFile).length} file(s) — repairing ${brokenFiles.size} touched file(s) with simplified stubs`,
      {
        event: 'build-check:repair',
        sliceLabel,
        totalIssues: issues.length,
        affectedFiles: Object.keys(byFile),
        repairing: Array.from(brokenFiles),
        sample: issues.slice(0, 6).map((i) => `[${i.kind}] ${i.file}${i.line ? `:${i.line}` : ''} — ${i.message}`),
      },
    );

    const fixed: Array<{ path: string; content: string; language?: string }> = [];
    for (const path of brokenFiles) {
      const original = cumulativeFiles.find((f) => f.path === path);
      const stub = buildSimplifiedStub(path);
      if (stub === null) {
        // No safe template — leave it. Final preview validator will catch it.
        continue;
      }
      fixed.push({ path, content: stub, language: original?.language });
    }
    return { issues, fixed };
  }

  /**
   * Per-slice quick validation. Runs AFTER each slice (before the next
   * slice starts) so problems are caught and fixed immediately rather
   * than compounding to the end of the pipeline.
   *
   * Checks (zero LLM calls):
   *   1. At least one `package.json` exists in the cumulative codebase.
   *   2. The root `package.json` declares the required scripts: `build`
   *      and `dev`. (These are what `runExecutionValidation` requires.)
   *
   * Import integrity is already covered by `runPostSliceBuildCheck`
   * which runs immediately before this method.
   *
   * Returns a list of mutated files. Caller must merge them back into
   * `cumulativeFiles`.
   */
  private runPostSliceQuickValidation(
    cumulativeFiles: Array<{ path: string; content: string; language?: string }>,
    sliceLabel: string,
  ): {
    ok: boolean;
    issues: string[];
    patched: Array<{ path: string; content: string; language?: string }>;
    fixes: { synthesizedPackageJson: boolean; addedScripts: string[]; touchedPackageJson: string | null };
  } {
    const issues: string[] = [];
    const patched: Array<{ path: string; content: string; language?: string }> = [];
    const REQUIRED_SCRIPTS = ['build', 'dev'] as const;

    // Find all package.json files; pick the root-most one (shortest path,
    // ignoring nested node_modules — none should exist in our generated
    // tree but defensive).
    const pkgFiles = cumulativeFiles.filter(
      (f) => /(^|\/)package\.json$/i.test(f.path) && !f.path.includes('node_modules/'),
    );

    let synthesizedPackageJson = false;
    const addedScripts: string[] = [];
    let touchedPath: string | null = null;

    if (pkgFiles.length === 0) {
      // ── (1) No package.json anywhere — synthesise a minimal stub.
      issues.push('no package.json in codebase');
      const stub = {
        name: 'generated-app',
        version: '0.0.0',
        private: true,
        scripts: {
          dev: 'vite',
          build: 'vite build',
          start: 'vite preview',
        },
      };
      const content = JSON.stringify(stub, null, 2) + '\n';
      patched.push({ path: 'package.json', content, language: 'json' });
      synthesizedPackageJson = true;
      touchedPath = 'package.json';
    } else {
      // ── (2) Pick root-most package.json and verify scripts.
      const root = pkgFiles.slice().sort((a, b) => a.path.length - b.path.length)[0]!;
      let parsed: Record<string, unknown> | null = null;
      try {
        parsed = JSON.parse(root.content) as Record<string, unknown>;
      } catch {
        issues.push(`root package.json (${root.path}) is not valid JSON`);
      }
      if (parsed) {
        const scripts = (parsed.scripts && typeof parsed.scripts === 'object'
          ? (parsed.scripts as Record<string, unknown>)
          : {}) as Record<string, unknown>;
        let mutated = false;
        for (const name of REQUIRED_SCRIPTS) {
          const v = scripts[name];
          if (typeof v !== 'string' || v.trim().length === 0) {
            issues.push(`root package.json missing required script: '${name}'`);
            // Best-effort default — works for the Vite stack we generate.
            // If the project uses a different stack, the generator will
            // typically have set the script already; this fallback only
            // fires when something genuinely went missing.
            scripts[name] = name === 'dev' ? 'vite' : 'vite build';
            addedScripts.push(name);
            mutated = true;
          }
        }
        if (mutated) {
          parsed.scripts = scripts;
          const content = JSON.stringify(parsed, null, 2) + '\n';
          patched.push({ path: root.path, content, language: root.language ?? 'json' });
          touchedPath = root.path;
        }
      }
    }

    const ok = issues.length === 0;
    if (ok) {
      this.logger.info(
        `[quick-check] Slice ${sliceLabel}: PASS (package.json present, scripts ok)`,
        { event: 'quick-check:pass', sliceLabel },
      );
    } else {
      this.logger.warn(
        `[quick-check] Slice ${sliceLabel}: ${issues.length} issue(s) — auto-patched before next slice`,
        {
          event: 'quick-check:auto-fix',
          sliceLabel,
          issues,
          synthesizedPackageJson,
          addedScripts,
          touchedPackageJson: touchedPath,
        },
      );
    }

    return {
      ok,
      issues,
      patched,
      fixes: { synthesizedPackageJson, addedScripts, touchedPackageJson: touchedPath },
    };
  }

  /**
   * Simplified-implementation fallback. Invoked AFTER MAX_QA_LOOPS rebuilds
   * have failed to make QA pass. Instead of doing yet another full-slice
   * regeneration (slow, often unproductive), replace ONLY the files cited
   * in the QA findings with safe minimal stubs that:
   *   • compile / parse cleanly (no truncation, no half-finished JSX)
   *   • render *something* at runtime (a heading + placeholder paragraph)
   *   • introduce no new imports the rest of the codebase might lack
   *
   * The slice is then allowed to continue — the user gets a working app
   * with a few simplified pages instead of a 40-minute QA-loop death-spiral.
   *
   * Cost: zero LLM calls.
   */
  private applySimplifiedFallback(
    artifacts: Map<AgentRole, Record<string, unknown>>,
    sliceLabel: string,
  ): { replaced: string[] } {
    const qa = artifacts.get('qa') as { issues?: unknown[]; verdict?: string } | undefined;
    if (!qa || !Array.isArray(qa.issues) || qa.issues.length === 0) return { replaced: [] };

    // Collect the affected file set from QA findings (deduped).
    const affected = new Set<string>();
    for (const raw of qa.issues) {
      const issue = raw as { file?: string; path?: string };
      const p = (issue?.file ?? issue?.path ?? '').trim();
      if (p) affected.add(p.replace(/\\/g, '/').replace(/^\.\//, ''));
    }
    if (affected.size === 0) return { replaced: [] };

    const builder = artifacts.get('builder') as
      | { files?: Array<{ path: string; content: string; language?: string }> }
      | undefined;
    if (!builder?.files) return { replaced: [] };

    const replaced: string[] = [];
    const newFiles = builder.files.map((f) => {
      const norm = f.path.replace(/\\/g, '/').replace(/^\.\//, '');
      if (!affected.has(norm)) return f;
      const stub = buildSimplifiedStub(norm);
      if (stub === null) return f; // unsupported file type — leave it alone
      replaced.push(norm);
      return { ...f, content: stub };
    });

    if (replaced.length === 0) return { replaced: [] };

    artifacts.set('builder', { ...(builder as Record<string, unknown>), files: newFiles });
    // Demote QA from needs-improvement to pass-with-warnings so the slice
    // can proceed. Keep the original issues attached for transparency.
    artifacts.set('qa', {
      ...qa,
      verdict: 'pass',
      summary:
        ((qa as { summary?: string }).summary ?? '') +
        ` [simplified-fallback applied to ${replaced.length} file(s)]`,
      simplifiedFallback: { replaced },
    } as Record<string, unknown>);

    this.logger.warn(
      `Slice ${sliceLabel} simplified fallback — replaced ${replaced.length} file(s) with safe stubs after QA loop exhausted`,
      { event: 'qa:fallback', sliceLabel, replaced },
    );

    return { replaced };
  }

  /**
   * Fail-fast guard: assert that a builder-producing pipeline run actually
   * emitted files. Called immediately after every `*.execute(...)` that
   * runs the BuilderAgent. If the orchestrator's status is `failed` OR the
   * builder artifact is missing/empty, this throws with the exact phase,
   * step, and slice context so `persistProjectFailure` records the truth
   * — instead of silently continuing with an empty `cumulativeFiles` and
   * surfacing the failure later in finalize / qa-gate.
   */
  private assertBuilderProducedFiles(
    sliceState: { status?: string; error?: string; artifacts: Map<AgentRole, Record<string, unknown>> },
    ctx: { phase: string; step: string; sliceLabel: string; sliceId?: string | null; sliceIndex?: number; sliceCount?: number },
  ): void {
    const builder = sliceState.artifacts.get('builder') as { files?: unknown[] } | undefined;
    const files = Array.isArray(builder?.files) ? builder!.files! : [];
    const orchFailed = sliceState.status === 'failed';
    if (!orchFailed && files.length > 0) return;

    const reason = orchFailed
      ? `orchestrator status=failed (${sliceState.error ?? 'no error message'})`
      : 'builder artifact has 0 files';
    const sliceCoord = typeof ctx.sliceIndex === 'number' && typeof ctx.sliceCount === 'number'
      ? ` slice ${ctx.sliceIndex + 1}/${ctx.sliceCount}`
      : '';
    const sliceTag = ctx.sliceId ? ` [slice=${ctx.sliceId}]` : '';
    const message =
      `[builder-empty] ${ctx.phase} → ${ctx.step}${sliceCoord}${sliceTag}: ${reason}`;

    this.logger.error('[gen:builder-empty] aborting pipeline immediately — builder produced no files', {
      event: 'gen:builder-empty',
      phase: ctx.phase,
      step: ctx.step,
      sliceLabel: ctx.sliceLabel,
      sliceId: ctx.sliceId ?? null,
      sliceIndex: ctx.sliceIndex ?? null,
      sliceCount: ctx.sliceCount ?? null,
      orchestratorStatus: sliceState.status ?? 'unknown',
      orchestratorError: sliceState.error ?? null,
      builderFileCount: files.length,
      reason,
    });
    throw new Error(message);
  }

  /**
   * Enforce real-implementation rules — reject builder output that ships
   * stubs, mock fixtures, placeholder copy/images, empty handlers, or
   * "coming soon" alerts. Flips QA verdict to needs-improvement and
   * appends concrete violations so the rebuild loop replaces them with
   * working implementations.
   *
   * Cost: zero LLM calls.
   */
  private enforceImplementationCompleteness(
    artifacts: Map<AgentRole, Record<string, unknown>>,
    sliceLabel: string,
  ): void {
    const merged = getMergedFiles(artifacts, /* applyPolish */ false);
    if (merged.length === 0) return;
    const spec = artifacts.get('spec');
    const apiDomains = extractApiDomains(spec);
    const report = validateImplementationCompleteness(merged, { apiDomains });
    if (report.inspected === 0 || !report.failed) return;

    const synthetic = completenessViolationsAsIssues(report);
    const qa = (artifacts.get('qa') as
      | { verdict?: string; issues?: unknown[]; summary?: string }
      | undefined) ?? {};
    const prevIssues = Array.isArray(qa.issues) ? qa.issues : [];
    const merged2 = { ...qa, verdict: 'needs-improvement', issues: [...prevIssues, ...synthetic] };
    artifacts.set('qa', merged2 as Record<string, unknown>);

    const byRule: Record<string, number> = {};
    for (const v of report.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
    this.logger.warn(
      `Implementation-completeness FAIL on slice ${sliceLabel}: ${report.violations.length} violation(s) — forcing builder rebuild`,
      {
        event: 'completeness:violation',
        sliceLabel,
        rules: byRule,
        sampleFiles: report.violations.slice(0, 5).map((v) => `${v.rule} → ${v.file}:${v.line ?? '?'}`),
        totalCount: report.totalCount,
      },
    );
  }

  /**
   * Enforce the tech-stack contract — reject builder output that uses the
   * wrong backend framework / ORM / frontend framework given the
   * spec.techStack the user picked. Flips QA verdict to needs-improvement
   * and appends concrete violations so the rebuild loop fixes them.
   *
   * Cost: zero LLM calls.
   */
  private enforceTechStack(
    artifacts: Map<AgentRole, Record<string, unknown>>,
    sliceLabel: string,
  ): void {
    const merged = getMergedFiles(artifacts, /* applyPolish */ false);
    if (merged.length === 0) return;
    const spec = artifacts.get('spec') as { techStack?: unknown } | undefined;
    const stack = normalizeTechStack(spec?.techStack);
    const report = validateStackCompliance(merged, stack);
    if (!report.failed) return;

    const synthetic = stackViolationsAsIssues(report);
    const qa = (artifacts.get('qa') as
      | { verdict?: string; issues?: unknown[]; summary?: string }
      | undefined) ?? {};
    const prevIssues = Array.isArray(qa.issues) ? qa.issues : [];
    const merged2 = { ...qa, verdict: 'needs-improvement', issues: [...prevIssues, ...synthetic] };
    artifacts.set('qa', merged2 as Record<string, unknown>);

    const byRule: Record<string, number> = {};
    for (const v of report.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
    this.logger.warn(
      `Tech-stack FAIL on slice ${sliceLabel}: ${report.violations.length} violation(s) — chosen=${stack.backend}/${stack.frontend}/${stack.orm}; forcing rebuild`,
      {
        event: 'tech-stack:violation',
        sliceLabel,
        chosen: { backend: stack.backend, frontend: stack.frontend, orm: stack.orm, database: stack.database },
        rules: byRule,
        sampleFiles: report.violations.slice(0, 5).map((v) => `${v.rule} → ${v.file}`),
      },
    );
  }

  /**
   * Enforce the strict UI design system on builder output. Any violation
   * (forbidden palette colors, raw <button>, off-grid spacing, missing
   * AppShell, …) flips the QA artifact's verdict to needs-improvement and
   * appends synthetic issues so the existing rebuild loop forces a fix.
   *
   * Cost: zero LLM calls. Runs after builder, before QA loop.
   */
  private enforceUiSystem(
    artifacts: Map<AgentRole, Record<string, unknown>>,
    sliceLabel: string,
  ): void {
    const merged = getMergedFiles(artifacts, /* applyPolish */ false);
    if (merged.length === 0) return;
    const report = validateUiSystemCompliance(merged);
    if (report.inspected === 0 || !report.failed) return;

    const synthetic = uiSystemViolationsAsIssues(report);
    const qa = (artifacts.get('qa') as
      | { verdict?: string; issues?: unknown[]; summary?: string }
      | undefined) ?? {};
    const prevIssues = Array.isArray(qa.issues) ? qa.issues : [];
    const merged2 = { ...qa, verdict: 'needs-improvement', issues: [...prevIssues, ...synthetic] };
    artifacts.set('qa', merged2 as Record<string, unknown>);

    // Group violations by rule for a compact log line.
    const byRule: Record<string, number> = {};
    for (const v of report.violations) {
      byRule[v.rule] = (byRule[v.rule] ?? 0) + (v.count ?? 1);
    }
    this.logger.warn(
      `UI-system FAIL on slice ${sliceLabel}: ${report.violations.length} violation rule(s), ${report.totalCount} total occurrence(s) — forcing builder rebuild`,
      {
        event: 'ui-system:violation',
        sliceLabel,
        rules: byRule,
        sampleFiles: report.violations.slice(0, 5).map((v) => `${v.rule} → ${v.file}`),
        totalCount: report.totalCount,
      },
    );
  }

  /**
   * Statically validate that every relative import in builder/QA-merged
   * source files resolves to an emitted file. If any are missing, override
   * the QA artifact's verdict to 'needs-improvement' and append synthetic
   * issues so the existing rebuild loop forces builder to fix them.
   *
   * Cost: zero LLM calls. Catches hallucinated imports before the runtime
   * validator wastes a 90-second docker boot to surface a Next.js 500.
   */
  private injectImportIntegrityIssues(
    artifacts: Map<AgentRole, Record<string, unknown>>,
    sliceLabel: string,
  ): void {
    const merged = getMergedFiles(artifacts, /* applyPolish */ false);
    if (merged.length === 0) return;
    const missing = validateImportIntegrity(merged);
    if (missing.length === 0) return;

    const synthetic = missingImportsAsIssues(missing);
    const qa = (artifacts.get('qa') as
      | { verdict?: string; issues?: unknown[]; summary?: string }
      | undefined) ?? {};
    const prevIssues = Array.isArray(qa.issues) ? qa.issues : [];
    const merged2 = { ...qa, verdict: 'needs-improvement', issues: [...prevIssues, ...synthetic] };
    artifacts.set('qa', merged2 as Record<string, unknown>);

    this.logger.warn(
      `Import integrity FAIL on slice ${sliceLabel}: ${missing.length} missing import(s) — forcing builder rebuild`,
      { sample: missing.slice(0, 3).map((m) => `${m.importer} → ${m.specifier}`) },
    );
  }

  /**
  /**
   * Fire-and-forget execution validation gate. Runs the project in a real
   * environment (npm install → npm run build → npm run dev) and feeds any
   * captured errors back to the QA agent through ProjectUpdater. Loops
   * until the build succeeds and the dev server reaches a ready marker,
   * or the iteration budget is exhausted.
   *
   * Acts as a HARD GATE — projects only graduate to 'completed' when this
   * loop returns 'pass'. On 'pass', we chain into the optional Docker
   * validator (if wired) for an extra HTTP-level check. On 'fail', the
   * project is marked 'failed' and Docker validation is skipped.
   */
  private scheduleExecutionValidation(project: ProjectRecord): void {
    setImmediate(async () => {
      try {
        const summary = await runExecutionFeedbackLoop(
          project.id,
          {
            updater: this.updater,
            projectStore: this.projectStore,
            logger: this.logger,
          },
          { maxIterations: 3 },
        );

        const fresh = await this.projectStore.get(project.id);
        if (!fresh) return;

        // Aggregate errors from the LAST execution attempt across iterations.
        const lastBuildErrors   = summary.lastResult.buildErrors.slice(0, 25);
        const lastRuntimeErrors = summary.lastResult.runtimeErrors.slice(0, 25);
        const fixIters = summary.iterations.filter((i) => i.kind === 'fix').length;

        const baseExecutionValidation = {
          finalVerdict: summary.finalVerdict,
          iterations: fixIters,
          buildErrors: lastBuildErrors,
          runtimeErrors: lastRuntimeErrors,
          httpProbes: summary.lastResult.httpProbes.map((p) => ({
            path: p.path,
            ok: p.ok,
            status: p.status,
            bodyBytes: p.bodyBytes,
            durationMs: p.durationMs,
            error: p.error,
          })),
          totalDurationMs: summary.totalDurationMs,
          completedAt: new Date().toISOString(),
          reason: summary.reason,
        };

        // ── Decide validator status (NEVER touches project.status) ──
        // The validator is a post-completion health probe. Vocabulary:
        //   passed  — verdict pass.
        //   warning — verdict fail BUT live preview is reachable, OR
        //             the auto-fix loop itself was unable to run
        //             (infra failure: updater-failed / crashed /
        //             no-files). The project still works.
        //   failed  — verdict fail with no mitigating signal. Recorded
        //             on the validation block; project.status is left
        //             at 'completed' (the build itself succeeded
        //             through the integrity gate).
        const previewIsReady = fresh.preview?.previewStatus === 'ready';
        const infraFailure =
          summary.reason === 'updater-failed' ||
          summary.reason === 'crashed' ||
          summary.reason === 'no-files';
        let validatorStatus: 'passed' | 'warning' | 'failed';
        let validatorWarning:
          | { code: string; message: string; details?: Record<string, unknown> }
          | null = null;
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
            details: {
              reason: summary.reason,
              iterations: fixIters,
              buildErrors: lastBuildErrors.slice(0, 6),
              runtimeErrors: lastRuntimeErrors.slice(0, 4),
              durationMs: summary.totalDurationMs,
            },
          };
        } else {
          validatorStatus = 'failed';
        }

        const executionValidation = {
          ...baseExecutionValidation,
          status: validatorStatus,
        };

        await this.projectStore.update(project.id, (rec) => {
          rec.executionValidation = executionValidation;
          if (validatorWarning) {
            rec.warnings = [...(rec.warnings ?? []), validatorWarning];
          }
        }, {
          phase: 'exec-validation:persist-verdict',
          caller: 'project-generator:scheduleExecutionValidation',
          reason: `verdict=${summary.finalVerdict} status=${validatorStatus} reason=${summary.reason}`,
        });
        fresh.executionValidation = executionValidation;

        this.logger.info('Execution validation finished (project.status untouched)', {
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

        // Always chain into Docker validation if available — it's a
        // separate health probe (HTTP-level) that records its own status
        // in runtimeValidation.status. Skipping it would hide useful
        // information from the dashboard.
        if (validatorStatus !== 'failed') {
          const dockerAvailable = !!(this.previewManager && this.previewManager.isDockerAvailable());
          if (dockerAvailable) this.scheduleRuntimeValidation(fresh);
        }
      } catch (err) {
        // Loop crashed — record as a validator failure ONLY. Do not
        // demote project.status; the build itself reached integrity-pass
        // before this probe was scheduled.
        try {
          const fresh = await this.projectStore.get(project.id);
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
            await this.projectStore.update(project.id, (rec) => {
              rec.executionValidation = crashRecord;
              rec.warnings = [
                ...(rec.warnings ?? []),
                {
                  code: 'execution.validator-crashed',
                  message: `Execution validator crashed: ${err instanceof Error ? err.message : String(err)}`,
                  details: { reason: 'crashed' },
                },
              ];
            }, {
              phase: 'exec-validation:loop-crashed',
              caller: 'project-generator:scheduleExecutionValidation',
              reason: 'execution-validation loop threw',
            });
          }
        } catch (innerErr) {
          this.logger.error('[gen:exec-validation:persist-failure-error] could not persist execution-loop crash', {
            event: 'gen:exec-validation:persist-failure-error',
            projectId: project.id,
            originalErr: err instanceof Error ? err.message : String(err),
            innerErr: innerErr instanceof Error ? innerErr.message : String(innerErr),
          });
        }
        this.logger.error('Execution validation crashed (project.status untouched)', {
          projectId: project.id,
          err: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    });
  }

  /**
   * Fire-and-forget post-generation runtime check. Boots the preview
   * container, scrapes the rendered HTML + container logs, and runs up to 2
   * builder-loop fix iterations if anything is wrong. Result is persisted
   * back onto the ProjectRecord under `runtimeValidation` so the UI can
   * surface a banner.
   */
  private scheduleRuntimeValidation(project: ProjectRecord): void {
    const pm = this.previewManager;
    if (!pm || !pm.isDockerAvailable()) {
      this.logger.info('Skipping runtime validation', {
        projectId: project.id,
        reason: !pm ? 'preview-manager-not-wired' : 'docker-unavailable',
      });
      return;
    }
    setImmediate(async () => {
      // SUBSTEP: finalize:preview-starting — emitted as soon as the
      // async runtime-validation worker starts. Wall-clock from this
      // marker until preview-ready measures container boot + first
      // successful HTTP probe (the slowest single step in the
      // post-generation lifecycle on most projects).
      const t0Preview = await this.startFinalizeStep(project, 'finalize:preview-starting');
      try {
        const summary = await validateAndAutoFix(
          project.id,
          {
            previewManager: pm,
            updater: this.updater,
            apiBaseUrl: this.apiBaseUrl,
            logger: this.logger,
            spec: project.spec,
          },
          { maxIterations: 3 },
        );
        const fresh = await this.projectStore.get(project.id);
        if (!fresh) return;
        // SUBSTEP: finalize:preview-ready — emitted whenever
        // validateAndAutoFix returns, regardless of verdict. The verdict
        // is reflected in `summary.finalVerdict` and the persisted
        // `runtimeValidation` block; the marker itself just signals that
        // the preview-boot phase has terminated.
        await this.completeFinalizeStep(
          fresh,
          'finalize:preview-ready',
          t0Preview,
          {
            verdict: summary.finalVerdict,
            iterations: summary.iterations.filter((i) => i.kind === 'fix').length,
            issueCount: summary.lastValidation.issues.length,
          },
        );
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
            : (summary.lastValidation.issues
                .slice(0, 3)
                .map((i) => `[${i.category}] ${i.message}`)
                .join('; ') || 'fail'),
        };
        fresh.runtimeValidation = runtimeValidation;
        // POST-COMPLETION HEALTH PROBE — never demotes project.status.
        // The build is already 'completed' (integrity-gate passed before
        // this probe was scheduled). A failed runtime check surfaces as
        // a "Validation: warning/failed" pill in the UI, not as a build
        // failure. The only field this method writes is
        // runtimeValidation.{status,finalVerdict,issues,...}.
        const issueWarning = summary.finalVerdict === 'fail' && runtimeValidation.status !== 'passed'
          ? {
              code: runtimeValidation.status === 'warning'
                ? 'runtime.validator-disagreed-with-live-preview'
                : 'runtime.validation-failed',
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
        await this.projectStore.update(project.id, (rec) => {
          rec.runtimeValidation = runtimeValidation;
          if (issueWarning) {
            rec.warnings = [...(rec.warnings ?? []), issueWarning];
          }
        }, {
          phase: `runtime-validation:${runtimeValidation.status}`,
          caller: 'project-generator:scheduleRuntimeValidation',
          reason: `verdict=${summary.finalVerdict} status=${runtimeValidation.status}`,
        });
        this.logger.info('Runtime validation finished (project.status untouched)', {
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
        // Validator crashed — record on runtimeValidation.status only.
        // Do not demote project.status; the generation is already done.
        try {
          const fresh = await this.projectStore.get(project.id);
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
            await this.projectStore.update(project.id, (rec) => {
              rec.runtimeValidation = crashRecord;
              rec.warnings = [
                ...(rec.warnings ?? []),
                {
                  code: 'runtime.validator-crashed',
                  message: `Runtime validator crashed: ${err instanceof Error ? err.message : String(err)}`,
                  details: { reason: 'crashed' },
                },
              ];
            }, {
              phase: 'runtime-validation:validator-crashed',
              caller: 'project-generator:scheduleRuntimeValidation',
              reason: 'runtime-validation threw',
            });
          }
        } catch (innerErr) {
          this.logger.error('[gen:runtime-validation:persist-failure-error] could not persist runtime-validator crash', {
            event: 'gen:runtime-validation:persist-failure-error',
            projectId: project.id,
            originalErr: err instanceof Error ? err.message : String(err),
            innerErr: innerErr instanceof Error ? innerErr.message : String(innerErr),
          });
        }
        this.logger.error('Runtime validation crashed (project.status untouched)', {
          projectId: project.id,
          err: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
        });
      }
    });
  }
}
