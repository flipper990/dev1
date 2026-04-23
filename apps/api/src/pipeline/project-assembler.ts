import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { PipelineState } from '../../../../packages/agent-core/src/orchestrator.js';
import type { TaskSummary } from '../storage/project-store.js';
import type { ProjectFile, Patch, StepSummary } from './generator-types.js';
import { ensureDeploymentReadiness } from './deployment-templates.js';
import { injectUIFoundation } from './ui-foundation.js';

export function assembleProject(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  logger: Logger,
): ProjectFile[] {
  const fileMap = new Map<string, ProjectFile>();

  const devOutput = artifacts.get('developer') as { files?: ProjectFile[] } | undefined;
  if (devOutput?.files) {
    for (const file of devOutput.files) fileMap.set(file.path, { ...file });
  }

  const devopsOutput = artifacts.get('devops') as { files?: ProjectFile[] } | undefined;
  if (devopsOutput?.files) {
    for (const file of devopsOutput.files) fileMap.set(file.path, { ...file });
  }

  const testerOutput = artifacts.get('tester') as { testFiles?: ProjectFile[] } | undefined;
  if (testerOutput?.testFiles) {
    for (const file of testerOutput.testFiles) fileMap.set(file.path, { ...file });
  }

  const debugOutput = artifacts.get('debugger') as { patches?: Patch[] } | undefined;
  if (debugOutput?.patches) applyPatches(fileMap, debugOutput.patches, 'debugger', logger);

  const reviewerOutput = artifacts.get('reviewer') as { patches?: Patch[] } | undefined;
  if (reviewerOutput?.patches) applyPatches(fileMap, reviewerOutput.patches, 'reviewer', logger);

  // Quality enforcer may emit both patches (improve existing files) and newFiles
  // (e.g. previously-missing EmptyState component). Apply both.
  const qualityOutput = artifacts.get('quality_enforcer') as
    { patches?: Patch[]; newFiles?: ProjectFile[] } | undefined;
  if (qualityOutput?.newFiles) {
    for (const file of qualityOutput.newFiles) {
      if (!fileMap.has(file.path)) fileMap.set(file.path, { ...file });
    }
  }
  if (qualityOutput?.patches) applyPatches(fileMap, qualityOutput.patches, 'quality_enforcer', logger);

  const optimizerOutput = artifacts.get('optimizer') as { patches?: Patch[] } | undefined;
  if (optimizerOutput?.patches) applyPatches(fileMap, optimizerOutput.patches, 'optimizer', logger);

  ensureDeploymentReadiness(fileMap, artifacts);
  injectUIFoundation(fileMap, artifacts);

  return Array.from(fileMap.values());
}

export function applyPatches(
  fileMap: Map<string, ProjectFile>,
  patches: Patch[],
  source: string,
  logger: Logger,
): void {
  for (const patch of patches) {
    const file = fileMap.get(patch.file);
    if (!file) {
      logger.warn(`${source} patch target not found: ${patch.file}`);
      continue;
    }
    if (!patch.oldContent || !patch.newContent) continue;
    if (file.content.includes(patch.oldContent)) {
      file.content = file.content.replace(patch.oldContent, patch.newContent);
    } else {
      logger.warn(`${source} patch content mismatch in ${patch.file}`);
    }
  }
}

export function buildTaskSummaries(state: PipelineState): TaskSummary[] {
  return state.tasks.map(t => ({
    id: t.id,
    agentRole: t.agentRole,
    status: t.status,
    durationMs: t.metadata?.latencyMs ?? 0,
    tokensUsed: (t.metadata?.tokensIn ?? 0) + (t.metadata?.tokensOut ?? 0),
    costUsd: t.metadata?.costUsd ?? 0,
    error: t.error?.message,
  }));
}

export function buildStepSummaries(state: PipelineState): StepSummary[] {
  return state.steps.map(s => ({
    stepId: s.stepId,
    name: s.stepId,
    agent: s.agent,
    status: s.status,
    durationMs: s.durationMs,
    error: s.error,
  }));
}
