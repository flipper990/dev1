// Project Generator — orchestrates the 7-step pipeline and assembles the final project.
// The update flow lives in ProjectUpdater; this class handles generate() only.

import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { BaseAgent, Logger } from '../../../../packages/agent-core/src/base-agent.js';
import {
  PipelineOrchestrator,
  type PipelineEvent,
} from '../../../../packages/agent-core/src/orchestrator.js';
import { InMemoryMessageBus } from '../../../../packages/agent-core/src/message-bus.js';
import { SessionManager } from './session-manager.js';
import { ProjectStore, type ProjectRecord } from '../storage/project-store.js';
import { FileMemoryStore } from '../storage/memory-store.js';
import { assembleProject, buildTaskSummaries, buildStepSummaries } from './project-assembler.js';
import { ProjectUpdater } from './project-updater.js';

// Re-export all public types from generator-types for backward compatibility
export type {
  GenerateRequest,
  UpdateRequest,
  GenerateResult,
  UpdateResult,
  StepSummary,
} from './generator-types.js';

import type { GenerateRequest, GenerateResult, UpdateRequest, UpdateResult } from './generator-types.js';

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
  private updater: ProjectUpdater;

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

  // ── Main Entry — validate → execute → assemble → save ──────────

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const projectId = nanoid(12);
    const sessionId = nanoid(16);
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

    const cached = await this.readResultCache(cacheKey);
    if (cached) {
      this.logger.info('Returning cached generation result', { cacheKey, projectId: cached.id });
      return {
        projectId: cached.id, sessionId, success: true, cached: true, project: cached, steps: [],
        optimization: { requestCacheHit: true, pipelineCacheHits: 0, pipelineCacheMisses: 0, skippedSteps: 0, estimatedApiCallsSaved: 1 },
      };
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
      createdAt: new Date().toISOString(),
    };
    await this.projectStore.save(project);

    const bus = new InMemoryMessageBus();
    const orchestrator = new PipelineOrchestrator(this.agents, bus, this.logger);
    orchestrator.onEvent((event: PipelineEvent) => this.sessionManager.handleEvent(event));

    this.logger.info(`Starting generation for project ${projectId}`, { sessionId, promptCount: request.prompts.length });

    this.activeGenerations++;
    try {
      const pipelineState = await orchestrator.execute(session);

      const files = assembleProject(pipelineState.artifacts, this.logger);
      const taskSummaries = buildTaskSummaries(pipelineState);
      const stepSummaries = buildStepSummaries(pipelineState);

      const planOutput = pipelineState.artifacts.get('planner') as { projectName?: string } | undefined;

      project.name = planOutput?.projectName ?? 'Generated Project';
      project.status = pipelineState.status === 'completed' ? 'completed' : 'failed';
      project.files = files;
      project.spec = pipelineState.artifacts.get('architect') as Record<string, unknown> | undefined;
      project.plan = pipelineState.artifacts.get('planner') as Record<string, unknown> | undefined;
      project.qaReport = pipelineState.artifacts.get('reviewer') as Record<string, unknown> | undefined;
      project.tasks = taskSummaries;
      project.totalTokens = taskSummaries.reduce((sum, t) => sum + t.tokensUsed, 0);
      project.totalCostUsd = taskSummaries.reduce((sum, t) => sum + t.costUsd, 0);
      project.optimization = {
        cacheHit: false, cacheKey,
        pipelineCacheHits: pipelineState.optimization.cacheHits,
        pipelineCacheMisses: pipelineState.optimization.cacheMisses,
        skippedSteps: pipelineState.optimization.skippedSteps,
        estimatedApiCallsSaved: pipelineState.optimization.estimatedApiCallsSaved,
      };
      project.durationMs = pipelineState.durationMs;
      project.completedAt = new Date().toISOString();

      await this.projectStore.save(project);
      this.writeResultCache(cacheKey, project.id);

      await this.memoryStore.saveGlobal({
        agentRole: 'global', type: 'pattern',
        content: `Request hash ${cacheKey.slice(0, 12)} -> project ${project.id} (${project.name})`,
        relevanceScore: 0.55, tags: ['best-practice', 'prompt-engineering'],
        metadata: { projectId: project.id, promptCount: request.prompts.length, totalTokens: project.totalTokens, totalCostUsd: project.totalCostUsd },
      });

      this.logger.info(`Project ${projectId} ${project.status}`, {
        files: files.length, durationMs: pipelineState.durationMs, totalTokens: project.totalTokens,
        costUsd: project.totalCostUsd.toFixed(4),
        stepsCompleted: stepSummaries.filter(s => s.status === 'completed').length,
        stepsFailed: stepSummaries.filter(s => s.status === 'failed').length,
        stepsSkipped: stepSummaries.filter(s => s.status === 'skipped').length,
      });

      return {
        projectId, sessionId, success: pipelineState.status === 'completed',
        cached: false, project, steps: stepSummaries,
        optimization: {
          requestCacheHit: false,
          pipelineCacheHits: pipelineState.optimization.cacheHits,
          pipelineCacheMisses: pipelineState.optimization.cacheMisses,
          skippedSteps: pipelineState.optimization.skippedSteps,
          estimatedApiCallsSaved: pipelineState.optimization.estimatedApiCallsSaved,
        },
        error: pipelineState.error,
      };

    } catch (err) {
      const error = (err as Error).message;
      project.status = 'failed';
      project.completedAt = new Date().toISOString();
      await this.projectStore.save(project);
      this.logger.error(`Project ${projectId} crashed`, { error });
      return { projectId, sessionId, success: false, error };
    } finally {
      this.activeGenerations--;
    }
  }

  async update(request: UpdateRequest): Promise<UpdateResult> {
    return this.updater.update(request);
  }

  // ── Private helpers ─────────────────────────────────────────

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
}
