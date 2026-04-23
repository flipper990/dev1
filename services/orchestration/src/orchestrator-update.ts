// Update / iteration pipeline — extracted from Orchestrator.runUpdate().
//
// Responsibilities:
//   1. Snapshot the current project as a ProjectVersion BEFORE touching state
//      (so the user can always roll back).
//   2. Run a shortened 3-stage pipeline (planner → coder → reviewer) with the
//      existing file tree handed to the coder as patch-mode context.
//   3. Apply the coder's patch + deletions to the previous file set.
//   4. Compute a real file diff (added / modified / removed) and persist it
//      onto the prompt-history entry so the UI can render change summaries.
//   5. Never reset state on failure — preserve the prior artifacts entirely.

import { generateId, now } from '@devteam/core';
import type { Project, PipelineState, ProjectFile, ProjectVersion } from '@devteam/core';
import type { AgentContext } from '@devteam/agents';
import type { PlannerAgent, CoderAgent, ReviewerAgent } from '@devteam/agents';
import { sessionManager } from './session-manager.js';
import { runStep, buildInitialPipelineState, finalizeState } from './pipeline.js';
import { startPipelineStep, completePipelineStep, type OnEventFn } from './orchestrator-events.js';
import { diffFiles, applyCoderPatch } from './project-diff.js';
import { acquireProjectLock, releaseProjectLock, evaluateUsage } from './cost-guard.js';

const MAX_VERSIONS_RETAINED = 10;

interface UpdateAgents {
  planner: PlannerAgent;
  coder: CoderAgent;
  reviewer: ReviewerAgent;
}

interface UpdateDeps {
  onProjectSave?: (project: Project) => Promise<void>;
}

/**
 * Build a pre-update snapshot. This is a cheap deep-ish clone of the
 * artifacts.files array (which is what rollback actually needs to restore).
 */
function takeSnapshot(project: Project, promptText: string): ProjectVersion {
  return {
    id: generateId('ver'),
    createdAt: now(),
    promptText,
    summary: project.artifacts.plan ?? '',
    files: project.artifacts.files.map((f) => ({ ...f })),
  };
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
  const pipeline  = buildInitialPipelineState(sessionId, projectId, ['planner', 'coder', 'reviewer']);
  onEvent('session.started', { sessionId, projectId });
  sessionManager.update(sessionId, { status: 'running', pipeline });

  // Acquire per-project lock to prevent duplicate concurrent pipelines.
  acquireProjectLock(projectId, sessionId);

  // ── 1. Snapshot BEFORE mutating anything ──────────────────────────────────
  const snapshot = takeSnapshot(existingProject, newPrompt);
  const retainedVersions = [...(existingProject.versions ?? []), snapshot].slice(-MAX_VERSIONS_RETAINED);

  // Working project — carries forward every pre-existing field so nothing is lost.
  const project: Project = {
    ...existingProject,
    prompt: newPrompt,
    status: 'running',
    sessionId,
    updatedAt: now(),
    versions: retainedVersions,
    error: undefined,
  };

  const prevFiles: ProjectFile[] = existingProject.artifacts.files;
  const contextualPrompt = [
    `EXISTING PROJECT: ${existingProject.name}`,
    `CURRENT FILE COUNT: ${prevFiles.length}`,
    '',
    `UPDATE REQUEST: ${newPrompt}`,
  ].join('\n');

  try {
    // ── 2a. Plan the change ────────────────────────────────────────────────
    startPipelineStep(pipeline, 'planner', sessionId, onEvent);
    const planResult = await runStep({
      role: 'planner',
      input: { prompt: contextualPrompt, preferences: existingProject.preferences },
      ctx,
      run: (input, c) => agents.planner.run(input, c),
    });
    completePipelineStep(pipeline, 'planner', planResult, sessionId, onEvent);
    const plan = planResult.output;

    // ── 2b. Patch the codebase (coder in patch mode) ───────────────────────
    startPipelineStep(pipeline, 'coder', sessionId, onEvent);
    const codeResult = await runStep({
      role: 'coder',
      input: {
        plan,
        existingFiles:      prevFiles,
        updateInstructions: newPrompt,
      },
      ctx,
      run: (input, c) => agents.coder.run(input, c),
    });
    completePipelineStep(pipeline, 'coder', codeResult, sessionId, onEvent);

    const emittedFiles     = codeResult.output.files ?? [];
    const requestedDeletes = codeResult.output.filesToDelete ?? [];

    // ── 3. Merge the patch onto the previous file tree ─────────────────────
    const mergedFiles = applyCoderPatch(prevFiles, emittedFiles, requestedDeletes);

    // ── 4. Compute the real diff (independent of what the coder claimed) ──
    const diff = diffFiles(prevFiles, mergedFiles, requestedDeletes);
    onEvent('project.diff', {
      projectId,
      sessionId,
      added:    diff.added,
      modified: diff.modified,
      removed:  diff.removed,
    });
    logger.info('Update diff', {
      projectId,
      added: diff.added.length,
      modified: diff.modified.length,
      removed: diff.removed.length,
      unchanged: diff.unchanged.length,
    });

    // ── 5. Review — only look at the files that actually changed ──────────
    startPipelineStep(pipeline, 'reviewer', sessionId, onEvent);
    const filesForReview = mergedFiles.filter((f) =>
      diff.added.includes(f.path) || diff.modified.includes(f.path),
    );
    // If nothing changed (empty-op update), skip the reviewer gracefully.
    let reviewSummary = existingProject.artifacts.reviewNotes ?? '';
    if (filesForReview.length > 0) {
      const reviewResult = await runStep({
        role: 'reviewer',
        input: { files: filesForReview, plan: { summary: plan.summary, goals: plan.goals } },
        ctx,
        run: (input, c) => agents.reviewer.run(input, c),
      });
      completePipelineStep(pipeline, 'reviewer', reviewResult, sessionId, onEvent);
      reviewSummary = reviewResult.output.summary;
    } else {
      completePipelineStep(pipeline, 'reviewer', {
        output: { summary: 'No files changed — review skipped' },
        reasoning: '',
        inputTokens: 0,
        outputTokens: 0,
        costUsd: 0,
        durationMs: 0,
        memoryIds: [],
      } as never, sessionId, onEvent);
    }

    // ── 6. Commit the new state ───────────────────────────────────────────
    project.artifacts = {
      ...existingProject.artifacts,
      files: mergedFiles,
      plan: plan.summary,
      reviewNotes: reviewSummary,
    };
    project.prompt      = newPrompt;
    project.status      = 'completed';
    project.updatedAt   = now();
    project.costUsd     = (existingProject.costUsd    ?? 0) + (pipeline.totalCostUsd ?? 0);
    project.tokensUsed  = (existingProject.tokensUsed ?? 0) + (pipeline.totalTokens  ?? 0);
    project.generationCount = (existingProject.generationCount ?? 0) + 1;

    // ── 7. Attach the real diff to the most-recent prompt history entry ───
    //       (the route handler appended {text, createdAt, sessionId} pre-pipeline).
    if (project.prompts && project.prompts.length > 0) {
      const last = project.prompts[project.prompts.length - 1];
      if (last && last.sessionId === sessionId) {
        last.added             = diff.added;
        last.modified          = diff.modified;
        last.removed           = diff.removed;
        last.changedFiles      = diff.changedPaths;
        last.snapshotVersionId = snapshot.id;
      }
    }

    finalizeState(pipeline, 'completed');
    sessionManager.update(sessionId, { status: 'completed', pipeline });
    onEvent('session.completed', { projectId });

    const postUsage = evaluateUsage(project);
    onEvent('usage.snapshot', { projectId, sessionId, ...postUsage, phase: 'post' });

    if (deps.onProjectSave) await deps.onProjectSave(project);

    logger.info('Update pipeline completed', {
      projectId,
      added:            diff.added.length,
      modified:         diff.modified.length,
      removed:          diff.removed.length,
      runCostUsd:       pipeline.totalCostUsd,
      cumulativeCost:   project.costUsd,
      generationCount:  project.generationCount,
      costPctOfLimit:   Number((postUsage.costPct * 100).toFixed(1)),
      cacheHits:        pipeline.optimization.cacheHits,
      skippedSteps:     pipeline.optimization.skippedSteps,
      apiCallsSaved:    pipeline.optimization.estimatedApiCallsSaved,
    });
    releaseProjectLock(projectId, sessionId);
    return { project, pipeline };
  } catch (error) {
    // ── Failure: preserve existing project state; only mark this run failed ──
    finalizeState(pipeline, 'failed');
    const msg = error instanceof Error ? error.message : String(error);
    const failedProject: Project = {
      ...existingProject,
      // Keep the new prompt visible on the card but DO NOT overwrite artifacts.
      prompt: newPrompt,
      status: 'failed',
      sessionId,
      updatedAt: now(),
      versions: retainedVersions,
      error: msg,
    };
    sessionManager.update(sessionId, { status: 'failed', pipeline });
    onEvent('session.failed', { error: msg });
    logger.error('Update pipeline failed', { sessionId, error: msg, runCostUsd: pipeline.totalCostUsd });
    if (deps.onProjectSave) {
      // Persist the failure state so the UI reflects it; existing files untouched.
      try { await deps.onProjectSave(failedProject); } catch { /* non-fatal */ }
    }
    releaseProjectLock(projectId, sessionId);
    throw error;
  }
}

/**
 * Restore a project to a previously-snapshotted version.
 *
 * Behaviour:
 *   - Snapshots the CURRENT state first (so "undo the restore" is possible).
 *   - Swaps `artifacts.files` to the version's files.
 *   - Appends a prompt-history entry describing the restore for auditability.
 *   - Never reset review notes / plan / deployment config — only files change.
 */
export function restoreVersion(project: Project, versionId: string): Project {
  const version = project.versions?.find((v) => v.id === versionId);
  if (!version) {
    throw new Error(`Version ${versionId} not found for project ${project.id}`);
  }

  const preRestoreSnapshot: ProjectVersion = {
    id: generateId('ver'),
    createdAt: now(),
    promptText: `(auto) pre-restore snapshot before ${versionId}`,
    summary: project.artifacts.plan ?? '',
    files: project.artifacts.files.map((f) => ({ ...f })),
  };

  const diff = diffFiles(project.artifacts.files, version.files);

  const restored: Project = {
    ...project,
    artifacts: {
      ...project.artifacts,
      files: version.files.map((f) => ({ ...f })),
    },
    status: 'completed',
    updatedAt: now(),
    versions: [...(project.versions ?? []), preRestoreSnapshot].slice(-MAX_VERSIONS_RETAINED),
    prompts: [
      ...(project.prompts ?? []),
      {
        text: `(restore) revert to version ${versionId} — "${version.promptText.slice(0, 80)}"`,
        createdAt: now(),
        added:    diff.added,
        modified: diff.modified,
        removed:  diff.removed,
        changedFiles:      diff.changedPaths,
        snapshotVersionId: preRestoreSnapshot.id,
      },
    ],
  };

  return restored;
}
