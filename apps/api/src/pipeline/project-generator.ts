// Project Generator — orchestrates the 4-step pipeline and assembles the final project.
//
// Pipeline:  spec → builder → qa → polish
// Loop:      if qa.verdict === 'needs-improvement', re-run builder + qa
//            (cap MAX_QA_LOOPS) before allowing polish.

import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import type { AgentRole, Session } from '../../../../packages/agent-core/src/types.js';
import type { BaseAgent, Logger } from '../../../../packages/agent-core/src/base-agent.js';
import {
  PipelineOrchestrator,
  type PipelineEvent,
} from '../../../../packages/agent-core/src/orchestrator.js';
import { InMemoryMessageBus } from '../../../../packages/agent-core/src/message-bus.js';
import { getMergedFiles } from '../../../../packages/agent-core/src/agent-input-builder.js';
import { validateImportIntegrity, missingImportsAsIssues } from '../../../../packages/agent-core/src/import-integrity.js';
import { SessionManager } from './session-manager.js';
import { ProjectStore, type ProjectRecord } from '../storage/project-store.js';
import { FileMemoryStore } from '../storage/memory-store.js';
import { assembleProject, buildTaskSummaries, buildStepSummaries } from './project-assembler.js';
import { runQualityAssurance } from './quality-assurance.js';
import { ProjectUpdater } from './project-updater.js';
import type { PreviewManager } from '../preview/preview-manager.js';
import { validateAndAutoFix } from './auto-fix.js';

export type {
  GenerateRequest, UpdateRequest, GenerateResult, UpdateResult, StepSummary,
} from './generator-types.js';

import type { GenerateRequest, GenerateResult, UpdateRequest, UpdateResult } from './generator-types.js';

const MAX_QA_LOOPS = 2; // total: 1 initial pass + up to 2 re-builds.

export class ProjectGenerator {
  private agents: Map<AgentRole, BaseAgent>;
  private projectStore: ProjectStore;
  private memoryStore: FileMemoryStore;
  private sessionManager: SessionManager;
  private logger: Logger;
  private resultCache = new Map<string, { projectId: string; cachedAt: number }>();
  private readonly RESULT_CACHE_TTL_MS = 30 * 60 * 1000;
  private activeGenerations = 0;
  private readonly maxConcurrentSessions: number;
  /** Wall-clock cap on a single pipeline run. Per-agent step timeouts and
   *  SDK request timeouts cap individual calls; this caps everything. */
  private readonly pipelineHardTimeoutMs: number = 45 * 60 * 1000;
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
  reserve(request: GenerateRequest): { projectId: string; sessionId: string; projectName: string; request: GenerateRequest } {
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
    };
    // Fire-and-forget save — the pipeline will overwrite this record once it
    // completes; we do not block the HTTP response on disk I/O.
    void this.projectStore.save(placeholder).catch((err) => {
      this.logger.error('Failed to save placeholder project record', { projectId, err: String(err) });
    });
    return { projectId, sessionId, projectName, request };
  }

  /**
   * Execute the pipeline against a previously reserved project + session.
   * Re-uses the IDs so the WS subscription that the client opened immediately
   * after reservation receives every event.
   */
  async runReserved(reservation: { projectId: string; sessionId: string; request: GenerateRequest }): Promise<GenerateResult> {
    return this.generate(reservation.request, { projectId: reservation.projectId, sessionId: reservation.sessionId });
  }

  // ── Main Entry ──────────────────────────────────────────

  async generate(request: GenerateRequest, reservedIds?: { projectId: string; sessionId: string }): Promise<GenerateResult> {
    const projectId = reservedIds?.projectId ?? nanoid(12);
    const sessionId = reservedIds?.sessionId ?? nanoid(16);
    const cacheKey = this.getRequestCacheKey(request);

    const validationError = this.validateRequest(request);
    if (validationError) {
      return { projectId, sessionId, success: false, error: validationError };
    }

    if (this.activeGenerations >= this.maxConcurrentSessions) {
      return {
        projectId, sessionId, success: false,
        error: `Server is at capacity (${this.maxConcurrentSessions} concurrent generations). Try again shortly.`,
      };
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

    const session = this.sessionManager.create(sessionId, request.userId ?? 'anonymous', request.prompts);
    if (request.preferences) session.artifacts.set('userPreferences', request.preferences);

    const reusable = await this.memoryStore.getGlobal({ queryText: request.prompts.join('\n'), limit: 5, includeGlobal: true });
    if (reusable.length > 0) session.artifacts.set('globalMemoryHints', reusable.map(m => m.content));

    const project: ProjectRecord = {
      id: projectId, sessionId,
      name: 'Untitled Project',
      prompts: request.prompts,
      status: 'generating',
      files: [], tasks: [],
      totalTokens: 0, totalCostUsd: 0, durationMs: 0,
      version: 1, versionHistory: [],
      createdAt: new Date().toISOString(),
    };
    await this.projectStore.save(project);

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
    try {
      const result = await Promise.race([
        this.runPipelineBody(
          { projectId, sessionId, request, project, session, cacheKey },
        ),
        pipelineTimeout,
      ]);
      return result;
    } catch (err) {
      const error = (err as Error).message;
      const stack = (err as Error).stack;
      project.status = 'failed';
      project.error = error || 'Unknown pipeline error';
      project.completedAt = new Date().toISOString();
      await this.projectStore.save(project);
      this.logger.error(`Project ${projectId} crashed`, { error, stack });
      return { projectId, sessionId, success: false, error };
    } finally {
      if (pipelineTimeoutHandle) clearTimeout(pipelineTimeoutHandle);
      this.activeGenerations--;
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
    },
  ): Promise<GenerateResult> {
    const { projectId, sessionId, request, project, session, cacheKey } = ctx;
    const bus = new InMemoryMessageBus();

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
      let pipelineState = await orchestrator.execute(session, phase1Seed);

      const specOut = pipelineState.artifacts.get('spec') as
        | { featureSlices?: Array<Record<string, unknown>> }
        | undefined;
      const slices = (specOut?.featureSlices as Array<{ id: string; [k: string]: unknown }> | undefined) ?? [];
      const sliceCount = Math.max(1, slices.length); // always at least one pass

      this.logger.info(`SPEC produced ${slices.length} feature slice(s) — building incrementally`, {
        sessionId, sliceIds: slices.map((s) => s.id),
      });

      // ── Phase 2 — per-slice BUILDER → QA loop ────────────
      // Each slice is built incrementally on top of all prior slices and
      // gated by its own QA verdict before BUILDER moves on.
      let cumulativeFiles: { path: string; content: string; language?: string }[] = [];
      let totalBuilderIterations = 0;
      let lastQaArtifact: Record<string, unknown> | undefined;
      let lastPolishArtifact: Record<string, unknown> | undefined;

      for (let sliceIdx = 0; sliceIdx < sliceCount; sliceIdx++) {
        const slice = slices[sliceIdx];
        const sliceLabel = slice ? `${sliceIdx + 1}/${sliceCount} '${slice.id}'` : 'single-pass';
        this.logger.info(`▶ Building slice ${sliceLabel}`);

        // Emit a slice-start event for the UI.
        this.sessionManager.handleEvent({
          type: 'slice:started',
          sessionId,
          sliceIndex: sliceIdx,
          totalSlices: sliceCount,
          sliceId: slice?.id ?? null,
        } as unknown as PipelineEvent);

        // Build a fresh session for this slice with cumulative state seeded.
        const sliceSession: Session = this.sessionManager.create(
          nanoid(16),
          session.userId ?? 'anonymous',
          session.prompts,
        );
        for (const [k, v] of session.artifacts.entries()) sliceSession.artifacts.set(k, v);
        if (cumulativeFiles.length > 0) {
          sliceSession.artifacts.set('previousFiles', cumulativeFiles);
        }
        if (slice) {
          sliceSession.artifacts.set('currentSlice', slice);
          sliceSession.artifacts.set('sliceIndex', sliceIdx);
          sliceSession.artifacts.set('totalSlices', sliceCount);
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
        let sliceState = await sliceOrch.execute(sliceSession, sliceSeed);
        totalBuilderIterations++;

        // Static import-integrity check — flip QA to needs-improvement if
        // the builder emitted source files referencing imports it never
        // wrote. The existing rebuild loop below will pick this up via
        // qaFeedback and force a re-run with precise "missing file" hints.
        this.injectImportIntegrityIssues(sliceState.artifacts, sliceLabel);

        // Per-slice QA loop — re-run BUILDER for THIS slice until QA passes
        // or we hit the cap.
        let sliceQaIter = 1;
        while (sliceQaIter <= MAX_QA_LOOPS) {
          const qa = sliceState.artifacts.get('qa') as { verdict?: string } | undefined;
          if (!qa || qa.verdict === 'pass') break;

          this.logger.info(`Slice ${sliceLabel} QA needs-improvement — rebuilding (iter ${sliceQaIter + 1})`);
          this.sessionManager.handleEvent({
            type: 'qa:loop',
            sessionId,
            iteration: sliceQaIter + 1,
            reason: `Slice ${slice?.id ?? sliceIdx}: ${(qa as { issues?: unknown[] }).issues?.length ?? 0} issue(s)`,
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
          for (const [k, v] of sliceSession.artifacts.entries()) rebuildSession.artifacts.set(k, v);
          rebuildSession.artifacts.set('previousFiles', Array.from(overlay.values()));
          rebuildSession.artifacts.set('qaFeedback', sliceState.artifacts.get('qa') ?? {});
          rebuildSession.artifacts.set('builderIteration', sliceQaIter + 1);

          const rebuildSeed = new Map<AgentRole, Record<string, unknown>>();
          if (realSpec) rebuildSeed.set('spec', realSpec);
          if (sliceIdx < sliceCount - 1) rebuildSeed.set('polish', stubPolish);

          const rebuildOrch = new PipelineOrchestrator(this.agents, bus, this.logger);
          rebuildOrch.onEvent(forwardEvents(/* orchSessionIsMain */ false));
          sliceState = await rebuildOrch.execute(rebuildSession, rebuildSeed);
          totalBuilderIterations++;
          // Re-check integrity after the rebuild so the loop converges or
          // exits via MAX_QA_LOOPS rather than passing with hallucinated imports.
          this.injectImportIntegrityIssues(sliceState.artifacts, sliceLabel);
          sliceQaIter++;
        }

        // Slice converged (or hit cap). Update cumulative codebase from
        // builder + qa + (final-slice) polish artifacts overlayed on previous.
        const slicePolishApplied = sliceIdx === sliceCount - 1;
        const sliceMerged = getMergedFiles(sliceState.artifacts, slicePolishApplied);
        const overlay = new Map<string, { path: string; content: string; language?: string }>();
        for (const f of cumulativeFiles) overlay.set(f.path, f);
        for (const f of sliceMerged) overlay.set(f.path, f);
        cumulativeFiles = Array.from(overlay.values());

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
        try {
          project.files = cumulativeFiles.map((f) => ({ path: f.path, content: f.content, language: f.language }));
          await this.projectStore.save(project);
        } catch (persistErr) {
          this.logger.warn('Per-slice persistence failed (non-fatal)', {
            projectId: project.id, sliceIdx, err: String(persistErr),
          });
        }

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
      pipelineState.artifacts.set('builder', { files: cumulativeFiles });
      if (lastQaArtifact) pipelineState.artifacts.set('qa', lastQaArtifact);
      else pipelineState.artifacts.set('qa', stubQa);
      // Polish patches were already merged into cumulativeFiles for the last
      // slice; clear them so the assembler doesn't try to re-apply.
      pipelineState.artifacts.set('polish', { patches: [], newFiles: [], summary: lastPolishArtifact ? (lastPolishArtifact as { summary?: string }).summary ?? 'applied' : 'no-op' });

      pipelineState.qaIterations = totalBuilderIterations;

      const files = assembleProject(pipelineState.artifacts, this.logger);
      const taskSummaries = buildTaskSummaries(pipelineState);
      const stepSummaries = buildStepSummaries(pipelineState);

      // ── Final QA gate (LLM-free, deterministic) ──────────
      const qaGate = runQualityAssurance(files);
      const finalFiles = qaGate.files;
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

      // Tentative status. If QA gate failed, finalise as 'failed' immediately.
      // If QA gate passed AND we'll run runtime validation, leave as 'generating'
      // so the UI does not show "completed" while we still might fail. The
      // scheduleRuntimeValidation finaliser flips to 'completed' on pass or
      // 'failed' on fail. Without a runtime validator (no docker), we can
      // only commit to 'completed' here.
      const qaPassed = pipelineState.status === 'completed' && qaGate.report.passed;
      const willValidate = !!(this.previewManager && this.previewManager.isDockerAvailable());
      project.status = qaPassed ? (willValidate ? 'generating' : 'completed') : 'failed';
      project.files = finalFiles;
      project.spec         = pipelineState.artifacts.get('spec')   as Record<string, unknown> | undefined;
      project.expandedSpec = pipelineState.artifacts.get('spec')   as Record<string, unknown> | undefined;
      project.qaReport     = pipelineState.artifacts.get('qa')     as Record<string, unknown> | undefined;
      project.qualityReport = pipelineState.artifacts.get('polish') as Record<string, unknown> | undefined;
      project.qaAssurance = {
        passed: qaGate.report.passed,
        score: qaGate.report.score,
        autoFixCount: qaGate.report.autoFixCount,
        bars: qaGate.report.bars,
        blockers: qaGate.report.blockers.map((b) => ({ id: b.id, message: b.message, bar: b.bar, file: b.file })),
      };
      project.tasks = taskSummaries;
      project.totalTokens = taskSummaries.reduce((sum, t) => sum + t.tokensUsed, 0);
      project.totalCostUsd = taskSummaries.reduce((sum, t) => sum + t.costUsd, 0);
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

      await this.projectStore.save(project);
      this.writeResultCache(cacheKey, project.id);

      // Emit the single, final pipeline-lifecycle event for the UI. All
      // intermediate orchestrators were suppressed so the dashboard never
      // sees a premature "Pipeline complete" between slices.
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

      // Fire-and-forget runtime validation + auto-fix. Best-effort: if
      // Docker is missing, the preview manager isn't wired, or anything
      // throws, we just log and move on — the user already has the project.
      this.scheduleRuntimeValidation(project);

      await this.memoryStore.saveGlobal({
        agentRole: 'global', type: 'pattern',
        content: `Request hash ${cacheKey.slice(0, 12)} -> project ${project.id} (${project.name})`,
        relevanceScore: 0.55, tags: ['best-practice', 'prompt-engineering'],
        metadata: { projectId: project.id, promptCount: request.prompts.length, totalTokens: project.totalTokens, totalCostUsd: project.totalCostUsd, qaIterations: totalBuilderIterations, sliceCount },
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
        fresh.runtimeValidation = {
          finalVerdict: summary.finalVerdict,
          iterations: summary.iterations.filter((i) => i.kind === 'fix').length,
          issues: summary.lastValidation.issues.map((i) => ({ category: i.category, message: i.message, hint: i.hint })),
          totalDurationMs: summary.totalDurationMs,
          completedAt: new Date().toISOString(),
        };
        // FINAL GATE — never expose status='completed' on a broken system.
        // Pipeline-level QA already passed (we wouldn't be here otherwise);
        // the runtime check is the last word. Pass → completed. Fail → failed.
        if (fresh.status === 'generating') {
          fresh.status = summary.finalVerdict === 'pass' ? 'completed' : 'failed';
        } else if (fresh.status === 'completed' && summary.finalVerdict === 'fail') {
          // Defensive: if anything else flipped to completed, demote it.
          fresh.status = 'failed';
        }
        await this.projectStore.save(fresh);
        this.logger.info('Runtime validation complete', {
          projectId: project.id,
          verdict: summary.finalVerdict,
          finalStatus: fresh.status,
          fixes: fresh.runtimeValidation.iterations,
          issues: fresh.runtimeValidation.issues.length,
          durationMs: summary.totalDurationMs,
        });
      } catch (err) {
        // Validator threw — do not leave the project stuck in 'generating'.
        // Mark it failed so the UI surfaces the failure rather than spinning.
        try {
          const fresh = await this.projectStore.get(project.id);
          if (fresh && fresh.status === 'generating') {
            fresh.status = 'failed';
            fresh.runtimeValidation = {
              finalVerdict: 'fail', iterations: 0,
              issues: [{ category: 'unknown', message: `Validator crashed: ${String(err)}` }],
              totalDurationMs: 0, completedAt: new Date().toISOString(),
            };
            await this.projectStore.save(fresh);
          }
        } catch { /* ignore */ }
        this.logger.error('Runtime validation failed', { projectId: project.id, err: String(err) });
      }
    });
  }
}
