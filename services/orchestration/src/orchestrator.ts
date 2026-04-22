import { Logger, generateId, now } from '@devteam/core';
import type {
  Project,
  CreateProjectRequest,
  PipelineState,
  ProjectFile,
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
  finalizeState,
} from './pipeline.js';
import { startPipelineStep, completePipelineStep, emitPipelineProgress } from './orchestrator-events.js';
import { runProjectUpdate } from './orchestrator-update.js';

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
    const pipeline = buildInitialPipelineState(sessionId, projectId, ['planner', 'coder', 'reviewer', 'tester', 'devops']);
    const emit = (type: string, data: unknown) => this.emit(sessionId!, type, data);

    this.emit(sessionId, 'session.started', { sessionId, projectId });
    sessionManager.update(sessionId, { status: 'running', pipeline });

    let project: Project = existingProject ?? {
      id: projectId, name: 'Untitled', prompt: request.prompt, preferences: request.preferences,
      artifacts: { files: [] }, status: 'running', sessionId, createdAt: now(), updatedAt: now(),
    };

    try {
      // ── Plan ──────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'planner', sessionId, emit);
      const planResult = await runStep({ role: 'planner', input: { prompt: request.prompt, preferences: request.preferences }, ctx, run: (i, c) => this.planner.run(i, c) });
      completePipelineStep(pipeline, 'planner', planResult, sessionId, emit);
      const plan = planResult.output;
      project.name = plan.projectName;
      project.artifacts.plan = plan.summary;

      // ── Code ──────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'coder', sessionId, emit);
      const codeResult = await runStep({ role: 'coder', input: { plan }, ctx, run: (i, c) => this.coder.run(i, c) });
      completePipelineStep(pipeline, 'coder', codeResult, sessionId, emit);
      const codeOutput = codeResult.output;
      project.artifacts.files = codeOutput.files;

      // ── Review ────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'reviewer', sessionId, emit);
      const reviewResult = await runStep({ role: 'reviewer', input: { files: codeOutput.files, plan: { summary: plan.summary, goals: plan.goals } }, ctx, run: (i, c) => this.reviewer.run(i, c) });
      completePipelineStep(pipeline, 'reviewer', reviewResult, sessionId, emit);
      project.artifacts.reviewNotes = reviewResult.output.summary;

      // ── Test ──────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'tester', sessionId, emit);
      const testResult = await runStep({
        role: 'tester', input: { files: codeOutput.files, plan }, ctx, run: (i, c) => this.tester.run(i, c),
        canSkip: (input) => input.files.filter(f => !f.path.includes('test')).length === 0 ? 'No source files to test' : false,
      });
      completePipelineStep(pipeline, 'tester', testResult, sessionId, emit);
      if (!testResult.skipped) {
        const testFiles = testResult.output.testFiles.map((t): ProjectFile => ({ path: t.path, content: t.content, language: t.framework }));
        project.artifacts.files = [...project.artifacts.files, ...testFiles];
        project.artifacts.testSuite = testResult.output.summary;
      }

      // ── DevOps ────────────────────────────────────────────────────────────
      startPipelineStep(pipeline, 'devops', sessionId, emit);
      const devopsResult = await runStep({ role: 'devops', input: { files: project.artifacts.files, projectName: project.name, preferences: request.preferences }, ctx, run: (i, c) => this.devops.run(i, c) });
      completePipelineStep(pipeline, 'devops', devopsResult, sessionId, emit);
      if (!devopsResult.skipped) {
        project.artifacts.files = [...project.artifacts.files, ...devopsResult.output.deploymentFiles];
        project.artifacts.deploymentConfig = devopsResult.output.summary;
      }

      // ── Finalize ──────────────────────────────────────────────────────────
      finalizeState(pipeline, 'completed');
      project.status = 'completed';
      project.updatedAt = now();
      project.costUsd = pipeline.totalCostUsd;
      project.tokensUsed = pipeline.totalTokens;
      sessionManager.update(sessionId, { status: 'completed', pipeline });
      this.emit(sessionId, 'session.completed', { projectId });
      if (this.deps.onProjectSave) await this.deps.onProjectSave(project);
      this.logger.info('Pipeline completed', { projectId, files: project.artifacts.files.length, costUsd: project.costUsd });
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

  startUpdateAsync(existingProject: Project, newPrompt: string): { sessionId: string } {
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
