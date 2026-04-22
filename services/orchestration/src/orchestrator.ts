import { Logger, generateId, now, AppError } from '@devteam/core';
import type {
  Project,
  CreateProjectRequest,
  PipelineState,
  ProjectFile,
  PromptHistoryEntry,
  ProjectVersion,
} from '@devteam/core';
import {
  PlannerAgent,
  CoderAgent,
  ReviewerAgent,
  TesterAgent,
  DevOpsAgent,
} from '@devteam/agents';
import type { AgentContext, AgentMemoryAdapter, AgentLLMAdapter } from '@devteam/agents';
import { sessionManager } from './session-manager.js';
import {
  runStep,
  buildInitialPipelineState,
  updateStepInState,
  finalizeState,
} from './pipeline.js';

// ─── Orchestrator ─────────────────────────────────────────────────────────────

export interface OrchestratorDeps {
  memory: AgentMemoryAdapter;
  llm: AgentLLMAdapter;
  onEvent?: (sessionId: string, type: string, data: unknown) => void;
  onProjectSave?: (project: Project) => Promise<void>;
}

export class Orchestrator {
  private readonly logger = new Logger('orchestrator');
  private readonly planner = new PlannerAgent();
  private readonly coder = new CoderAgent();
  private readonly reviewer = new ReviewerAgent();
  private readonly tester = new TesterAgent();
  private readonly devops = new DevOpsAgent();

  constructor(private readonly deps: OrchestratorDeps) {}

  // ── startAsync: returns immediately, runs full pipeline in background ───────
  startAsync(request: CreateProjectRequest): { projectId: string; sessionId: string; project: Project } {
    const projectId = generateId('proj');
    const session = sessionManager.create(projectId);
    const sessionId = session.id;

    const project: Project = {
      id: projectId,
      name: 'Generating…',
      prompt: request.prompt,
      preferences: request.preferences,
      artifacts: { files: [] },
      status: 'running',
      sessionId,
      createdAt: now(),
      updatedAt: now(),
    };

    // Fire and forget — defer to next tick so HTTP response is sent before events start
    setImmediate(() => {
      this.run(request, projectId, sessionId, project).catch(() => { /* logged inside run() */ });
    });

    return { projectId, sessionId, project };
  }

  async run(request: CreateProjectRequest, projectId?: string, sessionId?: string, existingProject?: Project): Promise<{ project: Project; pipeline: PipelineState }> {
    if (!projectId || !sessionId) {
      // Called directly (e.g. from tests) — create session here
      projectId = generateId('proj');
      const session = sessionManager.create(projectId);
      sessionId = session.id;
    }

    const ctx: AgentContext = {
      sessionId,
      projectId,
      memory: this.deps.memory,
      llm: this.deps.llm,
    };

    const pipeline = buildInitialPipelineState(sessionId, projectId, [
      'planner', 'coder', 'reviewer', 'tester', 'devops',
    ]);

    this.emit(sessionId, 'session.started', { sessionId, projectId });
    sessionManager.update(sessionId, { status: 'running', pipeline });

    let project: Project = existingProject ?? {
      id: projectId,
      name: 'Untitled',
      prompt: request.prompt,
      preferences: request.preferences,
      artifacts: { files: [] },
      status: 'running',
      sessionId,
      createdAt: now(),
      updatedAt: now(),
    };

    try {
      // ── Step 1: Plan ────────────────────────────────────────────────────
      this.startStep(pipeline, 'planner', sessionId);
      const planResult = await runStep({
        role: 'planner',
        input: { prompt: request.prompt, preferences: request.preferences },
        ctx,
        run: (input, c) => this.planner.run(input, c),
      });
      this.completeStep(pipeline, 'planner', planResult, sessionId);

      const plan = planResult.output;
      project.name = plan.projectName;
      project.artifacts.plan = plan.summary;

      // ── Step 2: Code ────────────────────────────────────────────────────
      this.startStep(pipeline, 'coder', sessionId);
      const codeResult = await runStep({
        role: 'coder',
        input: { plan },
        ctx,
        run: (input, c) => this.coder.run(input, c),
      });
      this.completeStep(pipeline, 'coder', codeResult, sessionId);

      const codeOutput = codeResult.output;
      project.artifacts.files = codeOutput.files;

      // ── Step 3: Review ──────────────────────────────────────────────────
      this.startStep(pipeline, 'reviewer', sessionId);
      const reviewResult = await runStep({
        role: 'reviewer',
        input: { files: codeOutput.files, plan: { summary: plan.summary, goals: plan.goals } },
        ctx,
        run: (input, c) => this.reviewer.run(input, c),
      });
      this.completeStep(pipeline, 'reviewer', reviewResult, sessionId);

      const review = reviewResult.output;
      project.artifacts.reviewNotes = review.summary;

      // ── Step 4: Test ────────────────────────────────────────────────────
      this.startStep(pipeline, 'tester', sessionId);
      const testResult = await runStep({
        role: 'tester',
        input: { files: codeOutput.files, plan },
        ctx,
        run: (input, c) => this.tester.run(input, c),
        canSkip: (input) =>
          input.files.filter((f) => !f.path.includes('test')).length === 0
            ? 'No source files to test'
            : false,
      });
      this.completeStep(pipeline, 'tester', testResult, sessionId);

      if (!testResult.skipped) {
        const testFiles = testResult.output.testFiles.map(
          (t): ProjectFile => ({ path: t.path, content: t.content, language: t.framework }),
        );
        project.artifacts.files = [...project.artifacts.files, ...testFiles];
        project.artifacts.testSuite = testResult.output.summary;
      }

      // ── Step 5: DevOps ──────────────────────────────────────────────────
      this.startStep(pipeline, 'devops', sessionId);
      const devopsResult = await runStep({
        role: 'devops',
        input: {
          files: project.artifacts.files,
          projectName: project.name,
          preferences: request.preferences,
        },
        ctx,
        run: (input, c) => this.devops.run(input, c),
      });
      this.completeStep(pipeline, 'devops', devopsResult, sessionId);

      if (!devopsResult.skipped) {
        project.artifacts.files = [
          ...project.artifacts.files,
          ...devopsResult.output.deploymentFiles,
        ];
        project.artifacts.deploymentConfig = devopsResult.output.summary;
      }

      // ── Finalize ────────────────────────────────────────────────────────
      finalizeState(pipeline, 'completed');
      project.status = 'completed';
      project.updatedAt = now();
      project.costUsd = pipeline.totalCostUsd;
      project.tokensUsed = pipeline.totalTokens;

      sessionManager.update(sessionId, { status: 'completed', pipeline });
      this.emit(sessionId, 'session.completed', { projectId });

      if (this.deps.onProjectSave) {
        await this.deps.onProjectSave(project);
      }

      this.logger.info('Pipeline completed', {
        projectId,
        files: project.artifacts.files.length,
        costUsd: project.costUsd,
      });

      return { project, pipeline };
    } catch (error) {
      finalizeState(pipeline, 'failed');
      project.status = 'failed';
      project.updatedAt = now();
      sessionManager.update(sessionId, { status: 'failed', pipeline });
      const msg = error instanceof Error ? error.message : String(error);
      this.emit(sessionId, 'session.failed', { error: msg });
      this.logger.error('Pipeline failed', { sessionId, error: msg });
      throw error;
    }
  }

  // ── startUpdateAsync: iteratively update an existing project ────────────────
  startUpdateAsync(existingProject: Project, newPrompt: string): { sessionId: string } {
    const session = sessionManager.create(existingProject.id);
    const sessionId = session.id;

    setImmediate(() => {
      this.runUpdate(existingProject, newPrompt, sessionId).catch(() => { /* logged inside */ });
    });

    return { sessionId };
  }

  async runUpdate(
    existingProject: Project,
    newPrompt: string,
    sessionId: string,
  ): Promise<{ project: Project; pipeline: PipelineState }> {
    const projectId = existingProject.id;

    const ctx: AgentContext = {
      sessionId,
      projectId,
      memory: this.deps.memory,
      llm: this.deps.llm,
    };

    const pipeline = buildInitialPipelineState(sessionId, projectId, [
      'planner', 'coder', 'reviewer',
    ]);

    this.emit(sessionId, 'session.started', { sessionId, projectId });
    sessionManager.update(sessionId, { status: 'running', pipeline });

    // Build a combined prompt giving agents full context of existing project
    const contextualPrompt = [
      `EXISTING PROJECT: ${existingProject.name}`,
      `CURRENT FILES: ${existingProject.artifacts.files.map((f) => f.path).join(', ')}`,
      '',
      `UPDATE REQUEST: ${newPrompt}`,
    ].join('\n');

    const project: Project = {
      ...existingProject,
      prompt: newPrompt,
      status: 'running',
      sessionId,
      updatedAt: now(),
    };

    try {
      // ── Step 1: Plan ────────────────────────────────────────────────────
      this.startStep(pipeline, 'planner', sessionId);
      const planResult = await runStep({
        role: 'planner',
        input: { prompt: contextualPrompt, preferences: existingProject.preferences },
        ctx,
        run: (input, c) => this.planner.run(input, c),
      });
      this.completeStep(pipeline, 'planner', planResult, sessionId);

      const plan = planResult.output;

      // ── Step 2: Code ────────────────────────────────────────────────────
      this.startStep(pipeline, 'coder', sessionId);
      const codeResult = await runStep({
        role: 'coder',
        input: { plan, existingFiles: existingProject.artifacts.files },
        ctx,
        run: (input, c) => this.coder.run(input, c),
      });
      this.completeStep(pipeline, 'coder', codeResult, sessionId);

      const newFiles: ProjectFile[] = codeResult.output.files;

      // Merge: new files overwrite matching paths; keep unmodified files
      const newPaths = new Set(newFiles.map((f) => f.path));
      const keptFiles = existingProject.artifacts.files.filter((f) => !newPaths.has(f.path));
      const mergedFiles = [...keptFiles, ...newFiles];
      const changedPaths = newFiles.map((f) => f.path);

      // ── Step 3: Review ──────────────────────────────────────────────────
      this.startStep(pipeline, 'reviewer', sessionId);
      const reviewResult = await runStep({
        role: 'reviewer',
        input: { files: newFiles, plan: { summary: plan.summary, goals: plan.goals } },
        ctx,
        run: (input, c) => this.reviewer.run(input, c),
      });
      this.completeStep(pipeline, 'reviewer', reviewResult, sessionId);

      // Save a version snapshot before applying changes
      const versionId = generateId('ver');
      const newVersion: ProjectVersion = {
        id: versionId,
        createdAt: now(),
        promptText: newPrompt,
        files: existingProject.artifacts.files,
        summary: `Before: ${newPrompt}`,
      };

      // Record prompt in history
      const promptEntry: PromptHistoryEntry = {
        text: newPrompt,
        createdAt: now(),
        sessionId,
        changedFiles: changedPaths,
      };

      // Finalize updated project
      project.artifacts = {
        ...existingProject.artifacts,
        files: mergedFiles,
        plan: plan.summary,
        reviewNotes: reviewResult.output.summary,
      };
      project.prompts = [...(existingProject.prompts ?? [{ text: existingProject.prompt, createdAt: existingProject.createdAt }]), promptEntry];
      project.versions = [...(existingProject.versions ?? []), newVersion];
      project.status = 'completed';
      project.updatedAt = now();
      project.costUsd = (existingProject.costUsd ?? 0) + (pipeline.totalCostUsd ?? 0);
      project.tokensUsed = (existingProject.tokensUsed ?? 0) + (pipeline.totalTokens ?? 0);

      finalizeState(pipeline, 'completed');
      sessionManager.update(sessionId, { status: 'completed', pipeline });
      this.emit(sessionId, 'session.completed', { projectId });

      if (this.deps.onProjectSave) {
        await this.deps.onProjectSave(project);
      }

      this.logger.info('Update pipeline completed', {
        projectId,
        changedFiles: changedPaths.length,
        costUsd: pipeline.totalCostUsd,
      });

      return { project, pipeline };
    } catch (error) {
      finalizeState(pipeline, 'failed');
      project.status = 'failed';
      project.updatedAt = now();
      sessionManager.update(sessionId, { status: 'failed', pipeline });
      const msg = error instanceof Error ? error.message : String(error);
      this.emit(sessionId, 'session.failed', { error: msg });
      this.logger.error('Update pipeline failed', { sessionId, error: msg });
      throw error;
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private startStep(pipeline: PipelineState, role: string, sessionId: string): void {
    updateStepInState(pipeline, role as never, { status: 'running', startedAt: now() });
    this.emit(sessionId, 'step.started', { role });
    sessionManager.emit(sessionId, 'step.started', { role });
    this.emitProgress(sessionId, pipeline);
  }

  private completeStep(
    pipeline: PipelineState,
    role: string,
    result: { cacheHit: boolean; skipped: boolean; skipReason?: string; durationMs: number; costUsd: number; inputTokens: number; outputTokens: number },
    sessionId: string,
  ): void {
    const status = result.skipped ? 'skipped' : 'completed';
    updateStepInState(pipeline, role as never, {
      status,
      completedAt: now(),
      durationMs: result.durationMs,
      costUsd: result.costUsd,
      tokensUsed: result.inputTokens + result.outputTokens,
      skippedReason: result.skipReason,
    });

    if (result.cacheHit) pipeline.optimization.cacheHits++;
    else if (result.skipped) pipeline.optimization.skippedSteps++;
    else pipeline.optimization.executedSteps++;

    pipeline.optimization.estimatedApiCallsSaved =
      pipeline.optimization.cacheHits + pipeline.optimization.skippedSteps;

    this.emit(sessionId, status === 'skipped' ? 'step.skipped' : 'step.completed', {
      role,
      durationMs: result.durationMs,
      cacheHit: result.cacheHit,
    });
    sessionManager.emit(sessionId, 'step.completed', { role, status });
    this.emitProgress(sessionId, pipeline);
  }

  private emit(sessionId: string, type: string, data: unknown): void {
    this.deps.onEvent?.(sessionId, type, data);
  }

  private emitProgress(sessionId: string, pipeline: PipelineState): void {
    const completedCount = pipeline.steps.filter((s) => s.status === 'completed' || s.status === 'skipped').length;
    const totalCount = pipeline.steps.length;
    const progressData = {
      sessionId: pipeline.sessionId,
      projectId: pipeline.projectId,
      status: pipeline.status,
      progress: totalCount > 0 ? completedCount / totalCount : 0,
      steps: pipeline.steps.map((step) => ({
        stepId: step.role,
        name: step.role,
        agent: step.role,
        status: step.status,
        durationMs: step.durationMs || 0,
        error: step.error,
      })),
      currentStep: pipeline.steps.find((s) => s.status === 'running')
        ? {
            stepId: pipeline.steps.find((s) => s.status === 'running')!.role,
            name: pipeline.steps.find((s) => s.status === 'running')!.role,
            agent: pipeline.steps.find((s) => s.status === 'running')!.role,
            description: 'Running...',
            attempt: 1,
          }
        : null,
    };
    sessionManager.emit(sessionId, 'progress', progressData);
  }
}
