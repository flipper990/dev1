import { Logger, generateId, now } from '@devteam/core';
import type {
  Project,
  CreateProjectRequest,
  PipelineState,
  ProjectFile,
} from '@devteam/core';
import {
  PlannerAgent,
  ArchitectAgent,
  CoderAgent,
  ReviewerAgent,
  DebuggerAgent,
  TesterAgent,
  OptimizerAgent,
  DevOpsAgent,
  IntentAnalyzerAgent,
  UIUXAgent,
  IntegrationAgent,
} from '@devteam/agents';
import type { AgentContext, AgentMemoryAdapter, AgentLLMAdapter } from '@devteam/agents';
import { sessionManager } from './session-manager.js';
import {
  runStep,
  buildInitialPipelineState,
  finalizeState,
} from './pipeline.js';
import { startPipelineStep, completePipelineStep, emitPipelineProgress } from './orchestrator-events.js';
import { runProjectUpdate } from './orchestrator-update.js';
import {
  assertWithinLimits,
  evaluateUsage,
  checkMidRunLimit,
  acquireProjectLock,
  releaseProjectLock,
} from './cost-guard.js';
import { config } from '@devteam/core';

export interface OrchestratorDeps {
  memory: AgentMemoryAdapter;
  llm: AgentLLMAdapter;
  onEvent?: (sessionId: string, type: string, data: unknown) => void;
  onProjectSave?: (project: Project) => Promise<void>;
}

export class Orchestrator {
  private readonly logger = new Logger('orchestrator');
  private readonly intent    = new IntentAnalyzerAgent();
  private readonly planner   = new PlannerAgent();
  private readonly architect = new ArchitectAgent();
  private readonly uiux      = new UIUXAgent();
  private readonly coder     = new CoderAgent();
  private readonly integration = new IntegrationAgent();
  private readonly reviewer  = new ReviewerAgent();
  private readonly debugger  = new DebuggerAgent();
  private readonly tester    = new TesterAgent();
  private readonly optimizer = new OptimizerAgent();
  private readonly devops    = new DevOpsAgent();

  constructor(private readonly deps: OrchestratorDeps) {}

  startAsync(request: CreateProjectRequest): { projectId: string; sessionId: string; project: Project } {
    const projectId = generateId('proj');
    const session = sessionManager.create(projectId);
    const sessionId = session.id;

    const project: Project = {
      id: projectId, name: 'Generating…', prompt: request.prompt,
      preferences: request.preferences, artifacts: { files: [] },
      status: 'running', sessionId, createdAt: now(), updatedAt: now(),
    };

    setImmediate(() => {
      this.run(request, projectId, sessionId, project).catch(() => { /* logged inside run() */ });
    });

    return { projectId, sessionId, project };
  }

  async run(
    request: CreateProjectRequest,
    projectId?: string,
    sessionId?: string,
    existingProject?: Project,
  ): Promise<{ project: Project; pipeline: PipelineState }> {
    if (!projectId || !sessionId) {
      projectId = generateId('proj');
      const session = sessionManager.create(projectId);
      sessionId = session.id;
    }

    const ctx: AgentContext = { sessionId, projectId, memory: this.deps.memory, llm: this.deps.llm };
    const pipeline = buildInitialPipelineState(sessionId, projectId, [
      'intent_analyzer',
      'planner',
      'architect',
      'ui_ux',
      'coder',
      'integration',
      'reviewer',
      'debugger',
      'tester',
      'optimizer',
      'devops',
    ]);
    const emit = (type: string, data: unknown) => this.emit(sessionId!, type, data);

    this.emit(sessionId, 'session.started', { sessionId, projectId });
    sessionManager.update(sessionId, { status: 'running', pipeline });

    let project: Project = existingProject ?? {
      id: projectId, name: 'Untitled', prompt: request.prompt, preferences: request.preferences,
      artifacts: { files: [] }, status: 'running', sessionId, createdAt: now(), updatedAt: now(),
    };

    // ── Pre-flight cost check — throw before consuming any tokens ─────────
    try {
      const preUsage = assertWithinLimits(project);
      acquireProjectLock(projectId, sessionId);
      emit('usage.snapshot', { projectId, sessionId, ...preUsage, phase: 'pre' });
      if (preUsage.nearLimit) {
        emit('usage.warning', { projectId, sessionId, ...preUsage });
        this.logger.info('Project approaching cost limits', {
          projectId, costUsd: preUsage.costUsd, limit: preUsage.costLimitUsd,
          pct: Number((preUsage.maxPct * 100).toFixed(1)),
        });
      }
    } catch (err) {
      finalizeState(pipeline, 'failed');
      sessionManager.update(sessionId, { status: 'failed', pipeline });
      const msg = err instanceof Error ? err.message : String(err);
      project.status = 'failed';
      project.error = msg;
      project.updatedAt = now();
      this.emit(sessionId, 'session.failed', { error: msg, code: 'COST_LIMIT_EXCEEDED' });
      this.logger.error('Run blocked by cost limit', { projectId, error: msg });
      if (this.deps.onProjectSave) await this.deps.onProjectSave(project);
      throw err;
    }

    // Cumulative cost threshold — emit a one-shot warning the first time the
    // in-flight pipeline cost crosses (warnThresholdPct * limit). Hard abort
    // happens if the running total exceeds the cap entirely.
    let warnedMidRun = false;
    const midRunGuard = () => {
      const cumulativeCost = (project.costUsd ?? 0) + (pipeline.totalCostUsd ?? 0);
      const usage = evaluateUsage(project, pipeline.totalCostUsd ?? 0);
      if (!warnedMidRun && cumulativeCost >= config.limits.warnThresholdPct * usage.costLimitUsd) {
        warnedMidRun = true;
        emit('usage.warning', { projectId, sessionId, costUsd: cumulativeCost, costLimitUsd: usage.costLimitUsd });
        this.logger.info('Mid-run cost warning', { projectId, costUsd: cumulativeCost, limit: usage.costLimitUsd });
      }
      const reason = checkMidRunLimit(project, pipeline.totalCostUsd ?? 0);
      if (reason) throw new Error(reason);
    };

    try {
      // ── Intent Analyzer ───────────────────────────────────────────────────
      startPipelineStep(pipeline, 'intent_analyzer', sessionId, emit);
      const intentResult = await runStep({
        role: 'intent_analyzer',
        input: { prompt: request.prompt, preferences: request.preferences },
        ctx,
        run: (i, c) => this.intent.run(i, c),
      });
      completePipelineStep(pipeline, 'intent_analyzer', intentResult, sessionId, emit);
      midRunGuard();
      const intent = intentResult.output;
      const effectivePrompt = intent.refinedPrompt || request.prompt;

      // ── Plan ──────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'planner', sessionId, emit);
      const planResult = await runStep({ role: 'planner', input: { prompt: effectivePrompt, preferences: request.preferences }, ctx, run: (i, c) => this.planner.run(i, c) });
      completePipelineStep(pipeline, 'planner', planResult, sessionId, emit);
      const plan = planResult.output;
      project.name = plan.projectName;
      project.artifacts.plan = plan.summary;

      // ── Architecture ──────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'architect', sessionId, emit);
      const architectResult = await runStep({ role: 'architect', input: { plan }, ctx, run: (i, c) => this.architect.run(i, c) });
      completePipelineStep(pipeline, 'architect', architectResult, sessionId, emit);
      const architectureOverview = architectResult.skipped ? plan.architecture : architectResult.output.overview;
      const apiEndpoints = architectResult.skipped ? [] : architectResult.output.apiEndpoints;
      const dataModels   = architectResult.skipped ? [] : architectResult.output.dataModels;

      // ── UI/UX ──────────────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'ui_ux', sessionId, emit);
      const uiuxResult = await runStep({
        role: 'ui_ux',
        input: { plan, intent },
        ctx,
        run: (i, c) => this.uiux.run(i, c),
        canSkip: () => intent.capabilities.hasFrontend === false
          ? 'Project has no frontend — no design system needed'
          : false,
      });
      completePipelineStep(pipeline, 'ui_ux', uiuxResult, sessionId, emit);
      const designSystem   = uiuxResult.skipped ? undefined : uiuxResult.output.designSystem;
      const layoutPatterns = uiuxResult.skipped ? []        : uiuxResult.output.layoutPatterns;
      const componentsNeeded = uiuxResult.skipped ? []      : uiuxResult.output.componentsNeeded;
      const styleFiles     = uiuxResult.skipped ? []        : uiuxResult.output.styleFiles;
      if (styleFiles.length) {
        project.artifacts.files = [...project.artifacts.files, ...styleFiles];
      }

      // ── Code ───────────────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'coder', sessionId, emit);
      const codeResult = await runStep({
        role: 'coder',
        input: {
          plan,
          architecture: architectureOverview,
          designSystem,
          layoutPatterns,
          componentsNeeded,
          existingStyleFiles: styleFiles,
        },
        ctx,
        run: (i, c) => this.coder.run(i, c),
      });
      completePipelineStep(pipeline, 'coder', codeResult, sessionId, emit);
      midRunGuard();
      const codeOutput = codeResult.output;
      // Merge: coder output wins over pre-generated style files with the same path,
      // but pre-generated style files that coder didn't touch stay in the bundle.
      const coderPaths = new Set(codeOutput.files.map((f) => f.path));
      const preservedStyleFiles = styleFiles.filter((f) => !coderPaths.has(f.path));
      project.artifacts.files = [...codeOutput.files, ...preservedStyleFiles];

      // ── Integration ───────────────────────────────────────────────────
      startPipelineStep(pipeline, 'integration', sessionId, emit);
      const integrationResult = await runStep({
        role: 'integration',
        input: {
          files: project.artifacts.files,
          apiEndpoints,
          architecture: { overview: architectureOverview, dataModels },
          intent,
        },
        ctx,
        run: (i, c) => this.integration.run(i, c),
        canSkip: () =>
          !intent.capabilities.hasFrontend || !intent.capabilities.hasBackend
            ? 'Integration needs both frontend and backend'
            : false,
      });
      completePipelineStep(pipeline, 'integration', integrationResult, sessionId, emit);
      if (!integrationResult.skipped && integrationResult.output.files.length > 0) {
        const integPaths = new Set(integrationResult.output.files.map((f) => f.path));
        const unchanged = project.artifacts.files.filter((f) => !integPaths.has(f.path));
        project.artifacts.files = [...unchanged, ...integrationResult.output.files];
      }

      // ── Review ────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'reviewer', sessionId, emit);
      const reviewResult = await runStep({ role: 'reviewer', input: { files: codeOutput.files, plan: { summary: plan.summary, goals: plan.goals } }, ctx, run: (i, c) => this.reviewer.run(i, c) });
      completePipelineStep(pipeline, 'reviewer', reviewResult, sessionId, emit);
      const reviewOutput = reviewResult.output;
      project.artifacts.reviewNotes = reviewOutput.summary;

      // ── Debug / Fix ───────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'debugger', sessionId, emit);
      const debugResult = await runStep({
        role: 'debugger',
        input: { files: project.artifacts.files, reviewIssues: reviewOutput.issues ?? [], securityConcerns: reviewOutput.securityConcerns ?? [] },
        ctx,
        run: (i, c) => this.debugger.run(i, c),
        canSkip: (input) => input.reviewIssues.filter(i => i.severity === 'critical' || i.severity === 'major').length === 0 && input.securityConcerns.length === 0
          ? 'No critical/major issues or security concerns to fix'
          : false,
      });
      completePipelineStep(pipeline, 'debugger', debugResult, sessionId, emit);
      if (!debugResult.skipped) {
        // Merge: replace only fixed files; keep the rest untouched
        const fixedPaths = new Set(debugResult.output.files.map(f => f.path));
        const unchanged = project.artifacts.files.filter(f => !fixedPaths.has(f.path));
        project.artifacts.files = [...debugResult.output.files, ...unchanged];
      }

      // ── Test ──────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'tester', sessionId, emit);
      const testResult = await runStep({
        role: 'tester', input: { files: project.artifacts.files, plan }, ctx, run: (i, c) => this.tester.run(i, c),
        canSkip: (input) => input.files.filter(f => !f.path.includes('test')).length === 0 ? 'No source files to test' : false,
      });
      completePipelineStep(pipeline, 'tester', testResult, sessionId, emit);
      if (!testResult.skipped) {
        const testFiles = testResult.output.testFiles.map((t): ProjectFile => ({ path: t.path, content: t.content, language: t.framework }));
        project.artifacts.files = [...project.artifacts.files, ...testFiles];
        project.artifacts.testSuite = testResult.output.summary;
      }

      // ── Optimize ──────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'optimizer', sessionId, emit);
      const optimizeResult = await runStep({
        role: 'optimizer',
        input: { files: project.artifacts.files.filter(f => !f.path.includes('test')), performanceConcerns: reviewOutput.performanceConcerns ?? [] },
        ctx,
        run: (i, c) => this.optimizer.run(i, c),
        canSkip: (input) => {
          // Skip optimizer entirely for simple projects (landing pages, tiny CRUD).
          if (intent.complexity === 'simple') return 'Simple project — skipping optimizer to save tokens';
          if (input.performanceConcerns.length === 0) return 'No specific performance concerns identified';
          return false;
        },
      });
      completePipelineStep(pipeline, 'optimizer', optimizeResult, sessionId, emit);
      if (!optimizeResult.skipped) {
        // Replace source files with optimized versions; keep test files untouched
        const optimizedPaths = new Set(optimizeResult.output.files.map(f => f.path));
        const testFiles = project.artifacts.files.filter(f => f.path.includes('test') || !optimizedPaths.has(f.path));
        project.artifacts.files = [...optimizeResult.output.files, ...testFiles];
      }

      // ── DevOps ────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'devops', sessionId, emit);
      const devopsResult = await runStep({ role: 'devops', input: { files: project.artifacts.files, projectName: project.name, preferences: request.preferences }, ctx, run: (i, c) => this.devops.run(i, c) });
      completePipelineStep(pipeline, 'devops', devopsResult, sessionId, emit);
      if (!devopsResult.skipped) {
        // Merge: devops files take precedence over any same-named files from coder
        const devopsPaths = new Set(devopsResult.output.deploymentFiles.map(f => f.path));
        const nonConflicting = project.artifacts.files.filter(f => !devopsPaths.has(f.path));
        project.artifacts.files = [...nonConflicting, ...devopsResult.output.deploymentFiles];
        project.artifacts.deploymentConfig = devopsResult.output.summary;
      }

      // ── Finalize ──────────────────────────────────────────────────────────
      finalizeState(pipeline, 'completed');
      project.status = 'completed';
      project.updatedAt = now();
      project.costUsd         = (project.costUsd         ?? 0) + (pipeline.totalCostUsd ?? 0);
      project.tokensUsed      = (project.tokensUsed      ?? 0) + (pipeline.totalTokens  ?? 0);
      project.generationCount = (project.generationCount ?? 0) + 1;
      sessionManager.update(sessionId, { status: 'completed', pipeline });
      this.emit(sessionId, 'session.completed', { projectId });

      // Final usage snapshot + structured cost summary log.
      const postUsage = evaluateUsage(project);
      this.emit(sessionId, 'usage.snapshot', { projectId, sessionId, ...postUsage, phase: 'post' });
      this.logger.info('Pipeline completed', {
        projectId,
        files:            project.artifacts.files.length,
        runCostUsd:       pipeline.totalCostUsd,
        runTokens:        pipeline.totalTokens,
        cumulativeCost:   project.costUsd,
        cumulativeTokens: project.tokensUsed,
        generationCount:  project.generationCount,
        costPctOfLimit:   Number((postUsage.costPct * 100).toFixed(1)),
        cacheHits:        pipeline.optimization.cacheHits,
        skippedSteps:     pipeline.optimization.skippedSteps,
        apiCallsSaved:    pipeline.optimization.estimatedApiCallsSaved,
      });
      releaseProjectLock(projectId, sessionId);
      if (this.deps.onProjectSave) await this.deps.onProjectSave(project);
      return { project, pipeline };
    } catch (error) {
      finalizeState(pipeline, 'failed');
      project.status = 'failed';
      project.updatedAt = now();
      sessionManager.update(sessionId, { status: 'failed', pipeline });
      const msg = error instanceof Error ? error.message : String(error);
      project.error = msg;
      // Preserve partial accounting even on failure so limits reflect reality.
      project.costUsd    = (project.costUsd    ?? 0) + (pipeline.totalCostUsd ?? 0);
      project.tokensUsed = (project.tokensUsed ?? 0) + (pipeline.totalTokens  ?? 0);
      this.emit(sessionId, 'session.failed', { error: msg });
      this.logger.error('Pipeline failed', {
        sessionId, error: msg,
        runCostUsd: pipeline.totalCostUsd, cumulativeCost: project.costUsd,
      });
      releaseProjectLock(projectId, sessionId);
      if (this.deps.onProjectSave) await this.deps.onProjectSave(project);
      throw error;
    }
  }

  startUpdateAsync(existingProject: Project, newPrompt: string): { sessionId: string } {
    // Pre-flight cost guard — throw synchronously so the caller (HTTP route)
    // can return 402 before we ever spin up a session.
    assertWithinLimits(existingProject);

    const session = sessionManager.create(existingProject.id);
    const sessionId = session.id;
    setImmediate(() => {
      const ctx: AgentContext = { sessionId, projectId: existingProject.id, memory: this.deps.memory, llm: this.deps.llm };
      const emit = (type: string, data: unknown) => this.emit(sessionId, type, data);
      runProjectUpdate(existingProject, newPrompt, sessionId, ctx,
        { planner: this.planner, coder: this.coder, reviewer: this.reviewer },
        { onProjectSave: this.deps.onProjectSave },
        emit, this.logger,
      ).catch(() => { /* logged inside */ });
    });
    return { sessionId };
  }

  private emit(sessionId: string, type: string, data: unknown): void {
    this.deps.onEvent?.(sessionId, type, data);
  }
}
