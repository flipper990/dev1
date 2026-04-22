import { nanoid } from 'nanoid';
import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { BaseAgent, Logger } from '../../../../packages/agent-core/src/base-agent.js';
import {
  PipelineOrchestrator,
  type PipelineEvent,
} from '../../../../packages/agent-core/src/orchestrator.js';
import { InMemoryMessageBus } from '../../../../packages/agent-core/src/message-bus.js';
import { SessionManager } from './session-manager.js';
import { ProjectStore, type ProjectSnapshot, type VersionMeta } from '../storage/project-store.js';
import { FileMemoryStore } from '../storage/memory-store.js';
import { computeFileDiffs } from './diff-utils.js';
import { assembleProject, buildTaskSummaries, buildStepSummaries } from './project-assembler.js';
import type { UpdateRequest, UpdateResult } from './generator-types.js';

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

  async update(request: UpdateRequest): Promise<UpdateResult> {
    const { projectId, prompts, userId, preferences, scope = 'code' } = request;
    const sessionId = nanoid(16);

    const existing = await this.projectStore.get(projectId);
    if (!existing) {
      return { projectId, sessionId, success: false, error: `Project ${projectId} not found` };
    }
    if (existing.status === 'generating') {
      return { projectId, sessionId, success: false, error: 'Project is still generating; wait for it to complete before updating' };
    }

    const allPrompts = [...(existing.prompts ?? []), ...prompts];
    const session = this.sessionManager.createSession(allPrompts, userId ?? 'system');
    if (preferences) session.artifacts.set('userPreferences', preferences);

    const reusable = await this.memoryStore.getGlobal({ queryText: allPrompts.join('\n'), limit: 5, includeGlobal: true });
    if (reusable.length > 0) session.artifacts.set('globalMemoryHints', reusable.map(m => m.content));

    const seedArtifacts = new Map<AgentRole, Record<string, unknown>>();
    if (scope !== 'full' && existing.plan) seedArtifacts.set('planner', existing.plan as Record<string, unknown>);
    if (scope === 'code' && existing.spec) seedArtifacts.set('architect', existing.spec as Record<string, unknown>);
    if (existing.files?.length) session.artifacts.set('existingFiles', existing.files);

    existing.status = 'generating';
    await this.projectStore.save(existing);

    const bus = new InMemoryMessageBus();
    const orchestrator = new PipelineOrchestrator(this.agents, bus, this.logger);
    orchestrator.onEvent((event: PipelineEvent) => this.sessionManager.handleEvent(event));

    this.logger.info(`Starting update for project ${projectId}`, {
      sessionId, scope, newPrompts: prompts.length, seededRoles: [...seedArtifacts.keys()],
    });

    this.activeGenerations++;
    try {
      const pipelineState = await orchestrator.execute(session, seedArtifacts);

      const newFiles = assembleProject(pipelineState.artifacts, this.logger);
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
      const planOutput = pipelineState.artifacts.get('planner') as { projectName?: string } | undefined;

      const versionMeta: VersionMeta = {
        version: newVersion,
        createdAt: new Date().toISOString(),
        prompts,
        diffs,
        totalTokens: taskSummaries.reduce((s, t) => s + t.tokensUsed, 0),
        totalCostUsd: taskSummaries.reduce((s, t) => s + t.costUsd, 0),
        durationMs: pipelineState.durationMs,
      };

      existing.name = planOutput?.projectName ?? existing.name;
      existing.status = pipelineState.status === 'completed' ? 'completed' : 'failed';
      existing.prompts = allPrompts;
      existing.files = newFiles;
      existing.spec = pipelineState.artifacts.get('architect') as Record<string, unknown> | undefined ?? existing.spec;
      existing.plan = pipelineState.artifacts.get('planner') as Record<string, unknown> | undefined ?? existing.plan;
      existing.qaReport = pipelineState.artifacts.get('reviewer') as Record<string, unknown> | undefined;
      existing.tasks = taskSummaries;
      existing.totalTokens = (existing.totalTokens ?? 0) + versionMeta.totalTokens;
      existing.totalCostUsd = (existing.totalCostUsd ?? 0) + versionMeta.totalCostUsd;
      existing.durationMs = (existing.durationMs ?? 0) + pipelineState.durationMs;
      existing.version = newVersion;
      existing.versionHistory = [...(existing.versionHistory ?? []), versionMeta];
      existing.updatedAt = new Date().toISOString();
      await this.projectStore.save(existing);

      this.logger.info(`Project ${projectId} updated to v${newVersion}`, {
        files: newFiles.length,
        filesAdded: diffs.filter(d => d.op === 'added').length,
        filesModified: diffs.filter(d => d.op === 'modified').length,
        filesDeleted: diffs.filter(d => d.op === 'deleted').length,
        durationMs: pipelineState.durationMs,
      });

      return {
        projectId, sessionId,
        success: pipelineState.status === 'completed',
        project: existing, version: newVersion, diffs, steps: stepSummaries,
        error: pipelineState.error,
      };

    } catch (err) {
      const error = (err as Error).message;
      existing.status = 'failed';
      existing.updatedAt = new Date().toISOString();
      await this.projectStore.save(existing);
      this.logger.error(`Project ${projectId} update crashed`, { error });
      return { projectId, sessionId, success: false, error };
    } finally {
      this.activeGenerations--;
    }
  }
}
