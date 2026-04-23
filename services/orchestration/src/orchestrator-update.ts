// Update pipeline logic — extracted from Orchestrator.runUpdate().

import { now } from '@devteam/core';
import type { Project, PipelineState, ProjectFile } from '@devteam/core';
import type { AgentContext } from '@devteam/agents';
import type { PlannerAgent, CoderAgent, ReviewerAgent } from '@devteam/agents';
import { sessionManager } from './session-manager.js';
import { runStep, buildInitialPipelineState, finalizeState } from './pipeline.js';
import { startPipelineStep, completePipelineStep, type OnEventFn } from './orchestrator-events.js';

interface UpdateAgents {
  planner: PlannerAgent;
  coder: CoderAgent;
  reviewer: ReviewerAgent;
}

interface UpdateDeps {
  onProjectSave?: (project: Project) => Promise<void>;
}

export async function runProjectUpdate(
  existingProject: Project,
  newPrompt: string,
  sessionId: string,
  ctx: AgentContext,
  agents: UpdateAgents,
  deps: UpdateDeps,
  onEvent: OnEventFn,
  logger: { info(msg: string, data?: object): void; error(msg: string, data?: object): void },
): Promise<{ project: Project; pipeline: PipelineState }> {
  const projectId = existingProject.id;

  const pipeline = buildInitialPipelineState(sessionId, projectId, ['planner', 'coder', 'reviewer']);
  onEvent('session.started', { sessionId, projectId });
  sessionManager.update(sessionId, { status: 'running', pipeline });

  const contextualPrompt = [
    `EXISTING PROJECT: ${existingProject.name}`,
    `CURRENT FILES: ${existingProject.artifacts.files.map(f => f.path).join(', ')}`,
    '',
    `UPDATE REQUEST: ${newPrompt}`,
  ].join('\n');

  const project: Project = { ...existingProject, prompt: newPrompt, status: 'running', sessionId, updatedAt: now() };

  try {
    // ── Plan ──────────────────────────────────────────────────────────────
    startPipelineStep(pipeline, 'planner', sessionId, onEvent);
    const planResult = await runStep({
      role: 'planner',
      input: { prompt: contextualPrompt, preferences: existingProject.preferences },
      ctx,
      run: (input, c) => agents.planner.run(input, c),
    });
    completePipelineStep(pipeline, 'planner', planResult, sessionId, onEvent);
    const plan = planResult.output;

    // ── Code ──────────────────────────────────────────────────────────────
    startPipelineStep(pipeline, 'coder', sessionId, onEvent);
    const codeResult = await runStep({
      role: 'coder',
      input: { plan, existingFiles: existingProject.artifacts.files },
      ctx,
      run: (input, c) => agents.coder.run(input, c),
    });
    completePipelineStep(pipeline, 'coder', codeResult, sessionId, onEvent);

    const newFiles: ProjectFile[] = codeResult.output.files;
    const newPaths = new Set(newFiles.map(f => f.path));
    const keptFiles = existingProject.artifacts.files.filter(f => !newPaths.has(f.path));
    const mergedFiles = [...keptFiles, ...newFiles];
    const changedPaths = newFiles.map(f => f.path);

    // ── Review ────────────────────────────────────────────────────────────
    startPipelineStep(pipeline, 'reviewer', sessionId, onEvent);
    const reviewResult = await runStep({
      role: 'reviewer',
      input: { files: newFiles, plan: { summary: plan.summary, goals: plan.goals } },
      ctx,
      run: (input, c) => agents.reviewer.run(input, c),
    });
    completePipelineStep(pipeline, 'reviewer', reviewResult, sessionId, onEvent);

    project.artifacts = {
      ...existingProject.artifacts,
      files: mergedFiles,
      plan: plan.summary,
      reviewNotes: reviewResult.output.summary,
    };
    project.prompt = newPrompt;
    project.status = 'completed';
    project.updatedAt = now();
    project.costUsd = (existingProject.costUsd ?? 0) + (pipeline.totalCostUsd ?? 0);
    project.tokensUsed = (existingProject.tokensUsed ?? 0) + (pipeline.totalTokens ?? 0);

    // Attach the changed file list to the most recent prompt history entry
    // (the route handler already appended the prompt text pre-pipeline).
    if (project.prompts && project.prompts.length > 0) {
      const last = project.prompts[project.prompts.length - 1];
      if (last && last.sessionId === sessionId) {
        last.changedFiles = changedPaths;
      }
    }

    finalizeState(pipeline, 'completed');
    sessionManager.update(sessionId, { status: 'completed', pipeline });
    onEvent('session.completed', { projectId });

    if (deps.onProjectSave) await deps.onProjectSave(project);

    logger.info('Update pipeline completed', { projectId, changedFiles: changedPaths.length, costUsd: pipeline.totalCostUsd });
    return { project, pipeline };
  } catch (error) {
    finalizeState(pipeline, 'failed');
    project.status = 'failed';
    project.updatedAt = now();
    sessionManager.update(sessionId, { status: 'failed', pipeline });
    const msg = error instanceof Error ? error.message : String(error);
    onEvent('session.failed', { error: msg });
    logger.error('Update pipeline failed', { sessionId, error: msg });
    throw error;
  }
}
