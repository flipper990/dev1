import { nanoid } from 'nanoid';
import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { BaseAgent, Logger } from '../../../../packages/agent-core/src/base-agent.js';
import {
  PipelineOrchestrator,
  type PipelineEvent,
} from '../../../../packages/agent-core/src/orchestrator.js';
import { InMemoryMessageBus } from '../../../../packages/agent-core/src/message-bus.js';
import { SessionManager } from './session-manager.js';
import { ProjectStore, type ProjectRecord, type ProjectSnapshot, type VersionMeta } from '../storage/project-store.js';
import { FileMemoryStore } from '../storage/memory-store.js';
import { computeFileDiffs } from './diff-utils.js';
import { assembleProject, buildTaskSummaries, buildStepSummaries } from './project-assembler.js';
import { runQualityAssurance } from './quality-assurance.js';
import type { UpdateRequest, UpdateResult } from './generator-types.js';
import { config } from '../config.js';
import { createInitialBudgetDiagnostics } from '../llm/generation-budget.js';
import { buildStructuredFailureDiagnostics } from './failure-diagnostics.js';
import { evaluateQaGateDecision } from './qa-gate-policy.js';

export class ProjectUpdater {
  private agents: Map<AgentRole, BaseAgent>;
  private projectStore: ProjectStore;
  private memoryStore: FileMemoryStore;
  private sessionManager: SessionManager;
  private logger: Logger;
  private activeGenerations = 0;

  constructor(
    agents: Map<AgentRole, BaseAgent>,
    projectStore: ProjectStore,
    memoryStore: FileMemoryStore,
    sessionManager: SessionManager,
    logger: Logger,
  ) {
    this.agents = agents;
    this.projectStore = projectStore;
    this.memoryStore = memoryStore;
    this.sessionManager = sessionManager;
    this.logger = logger;
  }

  /**
   * Allocate a sessionId synchronously so the HTTP caller can subscribe to
   * the WS stream before the (long-running) update starts.
   */
  reserve(request: UpdateRequest): { projectId: string; sessionId: string; request: UpdateRequest } {
    return { projectId: request.projectId, sessionId: nanoid(16), request };
  }

  async runReserved(reservation: { sessionId: string; request: UpdateRequest }): Promise<UpdateResult> {
    return this.update(reservation.request, { sessionId: reservation.sessionId });
  }

  private stampStructuredFailure(args: {
    project: ProjectRecord;
    sessionId: string;
    failedPhase: string;
    failedStep: string;
    failedAgent: string;
    failureReason: string;
    filesGeneratedBeforeFailure?: number;
    recoveryAttempted?: boolean;
  }): void {
    const { project, sessionId, failedPhase, failedStep, failedAgent, failureReason } = args;
    const progress = this.sessionManager.getProgress(sessionId);
    const retryCount = Number(progress?.retryAttempt ?? 0);
    const structured = buildStructuredFailureDiagnostics({
      project,
      failedPhase,
      failedStep,
      failedAgent,
      failureReason,
      retryCount,
      filesGeneratedBeforeFailure: args.filesGeneratedBeforeFailure ?? project.files?.length ?? 0,
      recoveryAttempted: args.recoveryAttempted ?? false,
    });
    const failedAt = new Date().toISOString();
    const summary = `${failedPhase}/${failedStep}: ${failureReason}`;

    project.status = 'failed';
    project.projectStatus = 'failed';
    project.verificationStatus = 'failed';
    project.error = summary;
    project.completedAt = project.completedAt ?? failedAt;
    project.updatedAt = failedAt;
    project.failure = {
      failedPhase,
      failedStep,
      errorName: 'UpdateFailure',
      errorMessage: failureReason,
      failedAt,
      lastSuccessfulPhase: project.failure?.lastSuccessfulPhase ?? project.progress?.phase ?? 'update',
      lastSuccessfulStep: project.failure?.lastSuccessfulStep ?? project.progress?.lastMeaningfulStep ?? failedStep,
      llmCallCount: project.failure?.llmCallCount ?? project.progress?.llmCallCount ?? 0,
      classification: structured.classification,
      failureCategory: structured.failure.failureCategory,
      failurePhase: structured.failure.failurePhase,
      failureReason: structured.failure.failureReason,
      failedAgent: structured.failure.failedAgent,
      retryCount: structured.failure.retryCount,
      lastValidCheckpoint: structured.failure.lastValidCheckpoint,
      filesGeneratedBeforeFailure: structured.failure.filesGeneratedBeforeFailure,
      recoveryAttempted: structured.failure.recoveryAttempted,
      recommendedNextAction: structured.failure.recommendedNextAction,
      zeroFileClassification: structured.failure.zeroFileClassification,
    };
    project.diagnostics = project.diagnostics ?? {};
    project.diagnostics.generationFailureTrace = structured.trace as NonNullable<
      NonNullable<ProjectRecord['diagnostics']>['generationFailureTrace']
    >;
  }

  async update(request: UpdateRequest, reservedIds?: { sessionId: string }): Promise<UpdateResult> {
    const { projectId, prompts, userId, preferences, scope = 'code', runtimeFeedback } = request;
    const sessionId = reservedIds?.sessionId ?? nanoid(16);
    const preserveLifecycle = userId === 'system-execution-loop' || userId === 'system-auto-fix';

    const existing = await this.projectStore.get(projectId);
    if (!existing) {
      return { projectId, sessionId, success: false, error: `Project ${projectId} not found` };
    }
    if (existing.status === 'generating') {
      // Runtime auto-fix and execution-feedback loop both run DURING the
      // generating window (the pipeline schedules them before flipping
      // status), so allow them to bypass the human-update guard. Other
      // callers must wait.
      const systemBypassUsers = new Set(['system-auto-fix', 'system-execution-loop']);
      if (!systemBypassUsers.has(userId ?? '')) {
        return { projectId, sessionId, success: false, error: 'Project is still generating; wait for it to complete before updating' };
      }
    }

    const allPrompts = [...(existing.prompts ?? []), ...prompts];
    const session = this.sessionManager.create(sessionId, userId ?? 'system', allPrompts);
    session.artifacts.set('projectId', projectId);
    session.artifacts.set('generationPhase', 'update');
    if (preferences) session.artifacts.set('userPreferences', preferences);
    if (runtimeFeedback) session.artifacts.set('runtimeFeedback', runtimeFeedback as unknown as Record<string, unknown>);

    const reusable = await this.memoryStore.getGlobal({ queryText: allPrompts.join('\n'), limit: 5, includeGlobal: true });
    if (reusable.length > 0) session.artifacts.set('globalMemoryHints', reusable.map(m => m.content));

    const seedArtifacts = new Map<AgentRole, Record<string, unknown>>();
    if (scope !== 'full' && existing.spec) seedArtifacts.set('spec', existing.spec as Record<string, unknown>);
    if (existing.files?.length) session.artifacts.set('existingFiles', existing.files);

    const previousLifecycle = {
      status: existing.status,
      projectStatus: existing.projectStatus ?? existing.status,
      verificationStatus: existing.verificationStatus ?? 'pending',
      error: existing.error,
      failure: existing.failure,
      completedAt: existing.completedAt,
    };
    if (!preserveLifecycle) {
      existing.status = 'generating';
      existing.projectStatus = 'generating';
      existing.verificationStatus = 'pending';
    }
    existing.sessionId = sessionId;
    existing.diagnostics = {
      ...(existing.diagnostics ?? {}),
      generationBudget: existing.diagnostics?.generationBudget ?? createInitialBudgetDiagnostics(config.generationBudget),
    };
    await this.projectStore.save(existing, {
      caller: 'project-updater:start',
      reason: preserveLifecycle ? 'system update preserving lifecycle status' : 'update flow flips generatedâ†’generating',
      allowStatusDowngrade: true,
    });

    const bus = new InMemoryMessageBus();
    const orchestrator = new PipelineOrchestrator(this.agents, bus, this.logger);
    orchestrator.onEvent((event: PipelineEvent) => this.sessionManager.handleEvent(event));

    this.logger.info(`Starting update for project ${projectId}`, {
      sessionId, scope, newPrompts: prompts.length, seededRoles: [...seedArtifacts.keys()],
    });

    this.activeGenerations++;
    try {
      const pipelineState = await orchestrator.execute(session, seedArtifacts);

      const assembled = assembleProject(pipelineState.artifacts, this.logger);

      // â”€â”€ File-loss safeguard â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // The pipeline regenerates the entire codebase on every update. If
      // the builder LLM crashes / rate-limits / returns empty (a single
      // "produced no files" failure mid auto-fix loop), `assembled` can
      // collapse to just the deterministic deployment scaffolding. Without
      // this check we'd persist an 11-file project over a previous 60-file
      // project and the user loses everything they had.
      //
      // Heuristic: if the existing project had React/source files and the
      // new assembly has no source files at all (or <30% of the previous
      // file count), keep the existing files and mark this update failed.
      const existingFiles = existing.files ?? [];
      const isSourceFile = (p: string): boolean =>
        /\.(?:tsx?|jsx?|css|scss|mdx?|html?|prisma|toml|ya?ml)$/i.test(p) &&
        !/^(?:Dockerfile|docker-compose|\.dockerignore|\.github\/|infra\/|scripts\/|vercel\.json|\.env)/.test(p);
      const existingSourceCount = existingFiles.filter((f) => isSourceFile(f.path)).length;
      const newSourceCount = assembled.filter((f) => isSourceFile(f.path)).length;

      const builderTask = pipelineState.tasks?.find((t) => t.agentRole === 'builder');
      const builderFailed = builderTask?.status === 'failed';

      const lostMostFiles =
        existingSourceCount >= 5 &&
        (newSourceCount === 0 || newSourceCount < Math.floor(existingSourceCount * 0.3));

      if (lostMostFiles) {
        const failureReason =
          builderFailed && builderTask?.error?.message
            ? `Builder failed: ${builderTask.error.message}. Existing files preserved.`
            : `Update would have deleted ${existingSourceCount - newSourceCount} source file(s); existing files preserved.`;
        this.logger.error(
          `Project ${projectId} update aborted: regression detected ` +
          `(existing ${existingSourceCount} source files -> new ${newSourceCount}). ` +
          `Builder task: ${builderTask?.status ?? 'missing'}${builderTask?.error ? ` (${builderTask.error.message})` : ''}. ` +
          `Keeping existing files; not overwriting.`,
        );
        this.stampStructuredFailure({
          project: existing,
          sessionId,
          failedPhase: 'update:file-loss-safeguard',
          failedStep: 'update:file-loss-safeguard',
          failedAgent: builderFailed ? 'builder' : 'pipeline',
          failureReason,
          filesGeneratedBeforeFailure: newSourceCount,
          recoveryAttempted: false,
        });
        await this.projectStore.save(existing, {
          caller: 'project-updater:file-loss-safeguard',
          reason: `existing ${existingSourceCount} -> new ${newSourceCount} source files`,
          allowStatusDowngrade: true,
        });
        return {
          projectId,
          sessionId,
          success: false,
          error: failureReason,
        };
      }

      // â”€â”€ Final QA gate â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
      // Same guarantee as ProjectGenerator: no low-quality output is
      // ever marked `generated`. Deterministic fixes applied in-place.
      const qa = runQualityAssurance(assembled);
      const newFiles = qa.files;
      if (qa.report.autoFixCount > 0) {
        this.logger.info(`QA gate auto-fixed ${qa.report.autoFixCount} issue(s) on update of ${projectId}`);
      }
      if (!qa.report.passed) {
        this.logger.warn(`QA gate FAILED on update of ${projectId}`, {
          score: qa.report.score,
          blockers: qa.report.blockers.map((b) => b.id),
        });
      }

      const diffs = computeFileDiffs(existing.files ?? [], newFiles);

      const previousVersion = existing.version ?? 1;
      const snapshot: ProjectSnapshot = {
        version: previousVersion,
        createdAt: new Date().toISOString(),
        files: existing.files ?? [],
        spec: existing.spec as Record<string, unknown> | undefined,
        plan: existing.plan as Record<string, unknown> | undefined,
        diffs,
        prompts: existing.prompts ?? [],
        totalTokens: existing.totalTokens ?? 0,
        totalCostUsd: existing.totalCostUsd ?? 0,
        durationMs: existing.durationMs ?? 0,
      };
      await this.projectStore.saveSnapshot(projectId, snapshot);

      const newVersion = previousVersion + 1;
      const taskSummaries = buildTaskSummaries(pipelineState);
      const stepSummaries = buildStepSummaries(pipelineState);
      const specOut = pipelineState.artifacts.get('spec') as { productName?: string } | undefined;

      const versionMeta: VersionMeta = {
        version: newVersion,
        createdAt: new Date().toISOString(),
        prompts,
        diffs,
        totalTokens: taskSummaries.reduce((s, t) => s + t.tokensUsed, 0),
        totalCostUsd: taskSummaries.reduce((s, t) => s + t.costUsd, 0),
        durationMs: pipelineState.durationMs,
      };

      existing.name = specOut?.productName ?? existing.name;
      const qaDecision = evaluateQaGateDecision(qa.report, {
        tier: 'tier1',
        pipelineCompleted: pipelineState.status === 'completed',
      });
      const updateSucceeded = qaDecision.passed;
      existing.status = preserveLifecycle
        ? previousLifecycle.status
        : (updateSucceeded ? 'generated' : 'failed');
      existing.projectStatus = preserveLifecycle
        ? previousLifecycle.projectStatus
        : existing.status;
      existing.verificationStatus = preserveLifecycle
        ? previousLifecycle.verificationStatus
        : (updateSucceeded ? 'pending' : 'failed');
      existing.prompts = allPrompts;
      existing.files = newFiles;
      existing.spec         = pipelineState.artifacts.get('spec') as Record<string, unknown> | undefined ?? existing.spec;
      existing.expandedSpec = pipelineState.artifacts.get('spec') as Record<string, unknown> | undefined ?? existing.expandedSpec;
      existing.qaReport     = pipelineState.artifacts.get('qa') as Record<string, unknown> | undefined;
      existing.qualityReport = pipelineState.artifacts.get('polish') as Record<string, unknown> | undefined;
      existing.qaAssurance = {
        passed: qaDecision.passed,
        score: qa.report.score,
        autoFixCount: qa.report.autoFixCount,
        bars: qa.report.bars,
        blockers: qa.report.blockers.map((b) => ({ id: b.id, message: b.message, bar: b.bar, file: b.file })),
      };
      existing.tasks = taskSummaries;
      existing.totalTokens = (existing.totalTokens ?? 0) + versionMeta.totalTokens;
      existing.totalCostUsd = (existing.totalCostUsd ?? 0) + versionMeta.totalCostUsd;
      existing.durationMs = (existing.durationMs ?? 0) + pipelineState.durationMs;
      existing.version = newVersion;
      existing.versionHistory = [...(existing.versionHistory ?? []), versionMeta];
      existing.updatedAt = new Date().toISOString();
      if (!updateSucceeded && !preserveLifecycle) {
        const qaReason = qaDecision.reason;
        const failureReason = pipelineState.error ?? qaReason;
        this.stampStructuredFailure({
          project: existing,
          sessionId,
          failedPhase: qaDecision.passed ? 'update:pipeline' : 'qa-gate',
          failedStep: qaDecision.passed ? 'update:pipeline' : 'qa-gate:runQualityAssurance',
          failedAgent: qaDecision.passed ? 'pipeline' : 'qa',
          failureReason,
          filesGeneratedBeforeFailure: newFiles.length,
          recoveryAttempted: qa.report.autoFixCount > 0,
        });
      } else if (!updateSucceeded && preserveLifecycle) {
        existing.error = previousLifecycle.error;
        existing.failure = previousLifecycle.failure;
        existing.completedAt = previousLifecycle.completedAt;
      }
      await this.projectStore.save(existing, {
        caller: 'project-updater:final-save',
        reason: `update v${newVersion} â†’ status=${existing.status}`,
        allowStatusDowngrade: true,
      });

      this.logger.info(`Project ${projectId} updated to v${newVersion}`, {
        files: newFiles.length,
        filesAdded: diffs.filter(d => d.op === 'added').length,
        filesModified: diffs.filter(d => d.op === 'modified').length,
        filesDeleted: diffs.filter(d => d.op === 'deleted').length,
        durationMs: pipelineState.durationMs,
      });

      return {
        projectId, sessionId,
        success: updateSucceeded,
        project: existing, version: newVersion, diffs, steps: stepSummaries,
        error: pipelineState.error ?? (qaDecision.passed ? undefined : qaDecision.reason),
      };

    } catch (err) {
      const error = (err as Error).message;
      if (!preserveLifecycle) {
        this.stampStructuredFailure({
          project: existing,
          sessionId,
          failedPhase: 'update:catch',
          failedStep: 'update:catch',
          failedAgent: 'pipeline',
          failureReason: error,
          filesGeneratedBeforeFailure: existing.files?.length ?? 0,
          recoveryAttempted: false,
        });
      } else {
        existing.status = previousLifecycle.status;
        existing.projectStatus = previousLifecycle.projectStatus;
        existing.verificationStatus = previousLifecycle.verificationStatus;
        existing.error = previousLifecycle.error;
        existing.failure = previousLifecycle.failure;
        existing.completedAt = previousLifecycle.completedAt;
      }
      await this.projectStore.save(existing, {
        caller: 'project-updater:catch',
        reason: error.slice(0, 200),
        allowStatusDowngrade: true,
      });
      this.logger.error(`Project ${projectId} update crashed`, { error });
      return { projectId, sessionId, success: false, error };
    } finally {
      this.activeGenerations--;
    }
  }
}

