// ─────────────────────────────────────────────────────────────
// Project Generator — End-to-end pipeline execution
//
// Flow: validate → session → orchestrator(7 steps) → assemble → save
//
// Responsibilities:
//   - Validate user prompts
//   - Create session + initial ProjectRecord
//   - Run 7-step pipeline via PipelineOrchestrator
//   - Assemble final project from agent artifacts
//     (collect files, apply patches, merge outputs)
//   - Save completed project to ProjectStore
// ─────────────────────────────────────────────────────────────

import { nanoid } from 'nanoid';
import { createHash } from 'node:crypto';
import type { AgentRole } from '../../../packages/agent-core/src/types.js';
import type { BaseAgent, Logger } from '../../../packages/agent-core/src/base-agent.js';
import {
  PipelineOrchestrator,
  type PipelineState,
  type PipelineEvent,
} from '../../../packages/agent-core/src/orchestrator.js';
import { InMemoryMessageBus } from '../../../packages/agent-core/src/message-bus.js';
import { SessionManager } from './session-manager.js';
import { ProjectStore, type ProjectRecord, type TaskSummary } from '../storage/project-store.js';
import { FileMemoryStore } from '../storage/memory-store.js';

// ── Public API Types ────────────────────────────────────────

export interface GenerateRequest {
  prompts: string[];
  userId?: string;
  preferences?: Record<string, unknown>;
}

export interface GenerateResult {
  projectId: string;
  sessionId: string;
  success: boolean;
  cached?: boolean;
  project?: ProjectRecord;
  /** Per-step summary visible to the caller. */
  steps?: StepSummary[];
  optimization?: {
    requestCacheHit: boolean;
    pipelineCacheHits: number;
    pipelineCacheMisses: number;
    skippedSteps: number;
    estimatedApiCallsSaved: number;
  };
  error?: string;
}

export interface StepSummary {
  stepId: string;
  name: string;
  agent: AgentRole;
  status: string;
  durationMs: number;
  error?: string;
}

// ── Internal File Types ─────────────────────────────────────

interface ProjectFile {
  path: string;
  content: string;
  language?: string;
}

interface Patch {
  file: string;
  oldContent: string;
  newContent: string;
}

interface EnvVarSpec {
  name: string;
  description?: string;
  required?: boolean;
  example?: string;
}

// ── Generator ───────────────────────────────────────────────

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
  }

  // ══════════════════════════════════════════════════════════
  // Main Entry — validate → execute → assemble → save
  // ══════════════════════════════════════════════════════════

  async generate(request: GenerateRequest): Promise<GenerateResult> {
    const projectId = nanoid(12);
    const sessionId = nanoid(16);
    const cacheKey = this.getRequestCacheKey(request);

    // ── 1. Validate ─────────────────────────────────────
    const validationError = this.validateRequest(request);
    if (validationError) {
      return { projectId, sessionId, success: false, error: validationError };
    }

    // ── Concurrency gate ─────────────────────────────────
    if (this.activeGenerations >= this.maxConcurrentSessions) {
      return {
        projectId,
        sessionId,
        success: false,
        error: `Server is at capacity (${this.maxConcurrentSessions} concurrent generations). Try again shortly.`,
      };
    }

    const cached = await this.readResultCache(cacheKey);
    if (cached) {
      this.logger.info('Returning cached generation result', {
        cacheKey,
        projectId: cached.id,
      });

      return {
        projectId: cached.id,
        sessionId,
        success: true,
        cached: true,
        project: cached,
        steps: [],
        optimization: {
          requestCacheHit: true,
          pipelineCacheHits: 0,
          pipelineCacheMisses: 0,
          skippedSteps: 0,
          estimatedApiCallsSaved: 1,
        },
      };
    }

    // ── 2. Create session ───────────────────────────────
    const session = this.sessionManager.create(
      sessionId,
      request.userId ?? 'anonymous',
      request.prompts,
    );
    if (request.preferences) {
      session.artifacts.set('userPreferences', request.preferences);
    }

    // Reuse historical global memory for repeated or similar requests.
    const reusable = await this.memoryStore.getGlobal({
      queryText: request.prompts.join('\n'),
      limit: 5,
      includeGlobal: true,
    });
    if (reusable.length > 0) {
      session.artifacts.set('globalMemoryHints', reusable.map(m => m.content));
    }

    // ── 3. Initialize project record ────────────────────
    const project: ProjectRecord = {
      id: projectId,
      sessionId,
      name: 'Untitled Project',
      prompts: request.prompts,
      status: 'generating',
      files: [],
      tasks: [],
      totalTokens: 0,
      totalCostUsd: 0,
      durationMs: 0,
      createdAt: new Date().toISOString(),
    };
    await this.projectStore.save(project);

    // ── 4. Create orchestrator & wire events ────────────
    const bus = new InMemoryMessageBus();
    const orchestrator = new PipelineOrchestrator(this.agents, bus, this.logger);

    orchestrator.onEvent((event: PipelineEvent) => {
      this.sessionManager.handleEvent(event);
    });

    this.logger.info(`Starting generation for project ${projectId}`, {
      sessionId,
      promptCount: request.prompts.length,
    });

    this.activeGenerations++;
    try {
      // ── 5. Execute 7-step pipeline ──────────────────
      const pipelineState = await orchestrator.execute(session);

      // ── 6. Assemble project output ──────────────────
      const files = this.assembleProject(pipelineState.artifacts);
      const taskSummaries = this.buildTaskSummaries(pipelineState);
      const stepSummaries = this.buildStepSummaries(pipelineState);

      // Derive project name from planner
      const planOutput = pipelineState.artifacts.get('planner') as { projectName?: string } | undefined;
      const projectName = planOutput?.projectName ?? 'Generated Project';

      // ── 7. Finalize and save ────────────────────────
      project.name = projectName;
      project.status = pipelineState.status === 'completed' ? 'completed' : 'failed';
      project.files = files;
      project.spec = pipelineState.artifacts.get('architect') as Record<string, unknown> | undefined;
      project.plan = pipelineState.artifacts.get('planner') as Record<string, unknown> | undefined;
      project.qaReport = pipelineState.artifacts.get('reviewer') as Record<string, unknown> | undefined;
      project.tasks = taskSummaries;
      project.totalTokens = taskSummaries.reduce((sum, t) => sum + t.tokensUsed, 0);
      project.totalCostUsd = taskSummaries.reduce((sum, t) => sum + t.costUsd, 0);
      project.optimization = {
        cacheHit: false,
        cacheKey,
        pipelineCacheHits: pipelineState.optimization.cacheHits,
        pipelineCacheMisses: pipelineState.optimization.cacheMisses,
        skippedSteps: pipelineState.optimization.skippedSteps,
        estimatedApiCallsSaved: pipelineState.optimization.estimatedApiCallsSaved,
      };
      project.durationMs = pipelineState.durationMs;
      project.completedAt = new Date().toISOString();

      await this.projectStore.save(project);
      this.writeResultCache(cacheKey, project.id);

      // Persist lightweight global memory for future prompt reuse.
      await this.memoryStore.saveGlobal({
        agentRole: 'global',
        type: 'pattern',
        content: `Request hash ${cacheKey.slice(0, 12)} -> project ${project.id} (${project.name})`,
        relevanceScore: 0.55,
        tags: ['best-practice', 'prompt-engineering'],
        metadata: {
          projectId: project.id,
          promptCount: request.prompts.length,
          totalTokens: project.totalTokens,
          totalCostUsd: project.totalCostUsd,
        },
      });

      this.logger.info(`Project ${projectId} ${project.status}`, {
        files: files.length,
        durationMs: pipelineState.durationMs,
        totalTokens: project.totalTokens,
        costUsd: project.totalCostUsd.toFixed(4),
        stepsCompleted: stepSummaries.filter(s => s.status === 'completed').length,
        stepsFailed: stepSummaries.filter(s => s.status === 'failed').length,
        stepsSkipped: stepSummaries.filter(s => s.status === 'skipped').length,
      });

      return {
        projectId,
        sessionId,
        success: pipelineState.status === 'completed',
        cached: false,
        project,
        steps: stepSummaries,
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

  // ══════════════════════════════════════════════════════════
  // Project Assembly — Merge all agent outputs into files
  // ══════════════════════════════════════════════════════════

  private assembleProject(
    artifacts: Map<AgentRole, Record<string, unknown>>,
  ): ProjectFile[] {
    // Build file map (path → file) for dedup and patch application
    const fileMap = new Map<string, ProjectFile>();

    // 1. Collect developer-generated source files
    const devOutput = artifacts.get('developer') as { files?: ProjectFile[] } | undefined;
    if (devOutput?.files) {
      for (const file of devOutput.files) {
        fileMap.set(file.path, { ...file });
      }
    }

    // 2. Collect DevOps config files (Dockerfile, CI/CD, etc.)
    const devopsOutput = artifacts.get('devops') as { files?: ProjectFile[] } | undefined;
    if (devopsOutput?.files) {
      for (const file of devopsOutput.files) {
        fileMap.set(file.path, { ...file });
      }
    }

    // 3. Collect test files
    const testerOutput = artifacts.get('tester') as { testFiles?: ProjectFile[] } | undefined;
    if (testerOutput?.testFiles) {
      for (const file of testerOutput.testFiles) {
        fileMap.set(file.path, { ...file });
      }
    }

    // 4. Apply debugger patches (fixes identified issues in-place)
    const debugOutput = artifacts.get('debugger') as { patches?: Patch[] } | undefined;
    if (debugOutput?.patches) {
      this.applyPatches(fileMap, debugOutput.patches, 'debugger');
    }

    // 5. Apply reviewer suggested fixes (if any)
    const reviewerOutput = artifacts.get('reviewer') as { patches?: Patch[] } | undefined;
    if (reviewerOutput?.patches) {
      this.applyPatches(fileMap, reviewerOutput.patches, 'reviewer');
    }

    // 6. Ensure deployment-ready baseline artifacts always exist.
    this.ensureDeploymentReadiness(fileMap, artifacts);

    return Array.from(fileMap.values());
  }

  private ensureDeploymentReadiness(
    fileMap: Map<string, ProjectFile>,
    artifacts: Map<AgentRole, Record<string, unknown>>,
  ): void {
    const spec = artifacts.get('architect') as { envVars?: EnvVarSpec[] } | undefined;
    const envVars = Array.isArray(spec?.envVars) ? spec.envVars : [];

    if (!fileMap.has('.env.example')) {
      const envContent = envVars.length > 0
        ? envVars.map(v => {
            const comment = v.description ? `# ${v.description}` : '# Environment variable';
            const value = v.example ?? '';
            return `${comment}\n${v.name}=${value}`;
          }).join('\n\n')
        : '# Environment variables\nNODE_ENV=production\nPORT=3000';
      fileMap.set('.env.example', { path: '.env.example', content: `${envContent}\n` });
    }

    if (!fileMap.has('.dockerignore')) {
      fileMap.set('.dockerignore', {
        path: '.dockerignore',
        content: [
          'node_modules',
          '.next',
          'dist',
          '.git',
          '.env',
          '.env.*',
          '*.log',
          'coverage',
          'tmp',
        ].join('\n') + '\n',
      });
    }

    if (!fileMap.has('Dockerfile')) {
      fileMap.set('Dockerfile', {
        path: 'Dockerfile',
        content: [
          'FROM node:22-alpine AS builder',
          'WORKDIR /app',
          'COPY package*.json ./',
          'RUN npm ci',
          'COPY . .',
          'RUN npm run build',
          '',
          'FROM node:22-alpine AS runner',
          'WORKDIR /app',
          'ENV NODE_ENV=production',
          'COPY --from=builder /app/package*.json ./',
          'RUN npm ci --omit=dev',
          'COPY --from=builder /app/dist ./dist',
          'EXPOSE 3000',
          'CMD ["node", "dist/server.js"]',
        ].join('\n') + '\n',
      });
    }

    if (!fileMap.has('docker-compose.yml')) {
      fileMap.set('docker-compose.yml', {
        path: 'docker-compose.yml',
        content: [
          'services:',
          '  app:',
          '    build: .',
          '    ports:',
          '      - "3000:3000"',
          '    env_file:',
          '      - .env',
          '    restart: unless-stopped',
          '    healthcheck:',
          '      test: ["CMD", "wget", "--spider", "-q", "http://localhost:3000/health"]',
          '      interval: 15s',
          '      timeout: 5s',
          '      retries: 5',
          '      start_period: 20s',
        ].join('\n') + '\n',
      });
    }

    if (!fileMap.has('scripts/deploy.sh')) {
      fileMap.set('scripts/deploy.sh', {
        path: 'scripts/deploy.sh',
        content: [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          '',
          'if [[ ! -f .env ]]; then',
          '  echo "Missing .env file. Copy .env.example to .env and configure values."',
          '  exit 1',
          'fi',
          '',
          'docker compose pull || true',
          'docker compose build --pull',
          'docker compose up -d --remove-orphans',
          'docker compose ps',
          'echo "Deployment complete."',
        ].join('\n') + '\n',
      });
    }

    if (!fileMap.has('scripts/deploy.ps1')) {
      fileMap.set('scripts/deploy.ps1', {
        path: 'scripts/deploy.ps1',
        content: [
          '$ErrorActionPreference = "Stop"',
          '',
          'if (-not (Test-Path .env)) {',
          '  Write-Error "Missing .env file. Copy .env.example to .env and configure values."',
          '}',
          '',
          'docker compose pull',
          'docker compose build --pull',
          'docker compose up -d --remove-orphans',
          'docker compose ps',
          'Write-Host "Deployment complete."',
        ].join('\n') + '\n',
      });
    }

    if (!fileMap.has('scripts/validate-env.sh')) {
      const requiredNames = envVars
        .filter(v => v.required !== false)
        .map(v => v.name)
        .filter(Boolean);

      const requiredLiteral = requiredNames.length > 0
        ? requiredNames.map(name => `"${name}"`).join(' ')
        : '"NODE_ENV" "PORT"';

      fileMap.set('scripts/validate-env.sh', {
        path: 'scripts/validate-env.sh',
        content: [
          '#!/usr/bin/env bash',
          'set -euo pipefail',
          '',
          `required=(${requiredLiteral})`,
          'missing=0',
          'for name in "${required[@]}"; do',
          '  if [[ -z "${!name:-}" ]]; then',
          '    echo "Missing required env var: ${name}"',
          '    missing=1',
          '  fi',
          'done',
          '',
          'if [[ ${missing} -ne 0 ]]; then',
          '  exit 1',
          'fi',
          'echo "Environment validation passed."',
        ].join('\n') + '\n',
      });
    }

    if (!fileMap.has('scripts/validate-env.ps1')) {
      const requiredNames = envVars
        .filter(v => v.required !== false)
        .map(v => v.name)
        .filter(Boolean);

      const list = requiredNames.length > 0
        ? requiredNames.map(v => `'${v}'`).join(', ')
        : `'NODE_ENV', 'PORT'`;

      fileMap.set('scripts/validate-env.ps1', {
        path: 'scripts/validate-env.ps1',
        content: [
          '$ErrorActionPreference = "Stop"',
          `$required = @(${list})`,
          '$missing = @()',
          'foreach ($name in $required) {',
          '  if ([string]::IsNullOrWhiteSpace([Environment]::GetEnvironmentVariable($name))) {',
          '    $missing += $name',
          '  }',
          '}',
          '',
          'if ($missing.Count -gt 0) {',
          '  Write-Error ("Missing required env vars: " + ($missing -join ", "))',
          '}',
          'Write-Host "Environment validation passed."',
        ].join('\n') + '\n',
      });
    }

    if (!fileMap.has('.github/workflows/deploy.yml')) {
      fileMap.set('.github/workflows/deploy.yml', {
        path: '.github/workflows/deploy.yml',
        content: [
          'name: Deploy',
          '',
          'on:',
          '  workflow_dispatch:',
          '  push:',
          '    branches: ["main"]',
          '',
          'jobs:',
          '  build-and-publish:',
          '    runs-on: ubuntu-latest',
          '    steps:',
          '      - name: Checkout',
          '        uses: actions/checkout@v4',
          '      - name: Set up Docker Buildx',
          '        uses: docker/setup-buildx-action@v3',
          '      - name: Login to GHCR',
          '        uses: docker/login-action@v3',
          '        with:',
          '          registry: ghcr.io',
          '          username: ${{ github.actor }}',
          '          password: ${{ secrets.GITHUB_TOKEN }}',
          '      - name: Build and push',
          '        uses: docker/build-push-action@v6',
          '        with:',
          '          context: .',
          '          push: true',
          '          tags: ghcr.io/${{ github.repository }}:latest',
          '      - name: Deployment note',
          '        run: echo "Image published. Add environment-specific deploy step (Kubernetes, ECS, or VM)."',
        ].join('\n') + '\n',
      });
    }

    // Optional deployment targets: scaffold templates if no provider-specific config exists.
    if (!fileMap.has('vercel.json') && !fileMap.has('infra/aws/cloudformation.yaml') && !fileMap.has('infra/aws/terraform/main.tf')) {
      fileMap.set('vercel.json', {
        path: 'vercel.json',
        content: [
          '{',
          '  "$schema": "https://openapi.vercel.sh/vercel.json",',
          '  "version": 2,',
          '  "buildCommand": "npm run build",',
          '  "devCommand": "npm run dev"',
          '}',
        ].join('\n') + '\n',
      });

      fileMap.set('infra/aws/cloudformation.yaml', {
        path: 'infra/aws/cloudformation.yaml',
        content: [
          'AWSTemplateFormatVersion: "2010-09-09"',
          'Description: Basic ECS Fargate scaffold for generated project',
          'Resources:',
          '  Cluster:',
          '    Type: AWS::ECS::Cluster',
          '    Properties:',
          '      ClusterName: generated-project-cluster',
          'Outputs:',
          '  ClusterName:',
          '    Value: !Ref Cluster',
        ].join('\n') + '\n',
      });
    }
  }

  private applyPatches(
    fileMap: Map<string, ProjectFile>,
    patches: Patch[],
    source: string,
  ): void {
    for (const patch of patches) {
      const file = fileMap.get(patch.file);
      if (!file) {
        this.logger.warn(`${source} patch target not found: ${patch.file}`);
        continue;
      }
      if (!patch.oldContent || !patch.newContent) continue;

      if (file.content.includes(patch.oldContent)) {
        file.content = file.content.replace(patch.oldContent, patch.newContent);
      } else {
        this.logger.warn(`${source} patch content mismatch in ${patch.file}`);
      }
    }
  }

  // ══════════════════════════════════════════════════════════
  // Summary Builders
  // ══════════════════════════════════════════════════════════

  private buildTaskSummaries(state: PipelineState): TaskSummary[] {
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

  private buildStepSummaries(state: PipelineState): StepSummary[] {
    return state.steps.map(s => ({
      stepId: s.stepId,
      name: s.stepId,
      agent: s.agent,
      status: s.status,
      durationMs: s.durationMs,
      error: s.error,
    }));
  }

  // ══════════════════════════════════════════════════════════
  // Validation
  // ══════════════════════════════════════════════════════════

  private validateRequest(request: GenerateRequest): string | null {
    if (!request.prompts || request.prompts.length === 0 || request.prompts.length > 3) {
      return 'Provide 1–3 prompts';
    }

    for (const prompt of request.prompts) {
      if (typeof prompt !== 'string' || prompt.trim().length < 10) {
        return 'Each prompt must be at least 10 characters';
      }
      if (prompt.length > 5000) {
        return 'Each prompt must be under 5000 characters';
      }
    }

    return null;
  }

  private getRequestCacheKey(request: GenerateRequest): string {
    const normalized = {
      prompts: request.prompts.map(p => p.trim()),
      preferences: request.preferences ?? {},
    };
    return createHash('sha256').update(JSON.stringify(normalized)).digest('hex');
  }

  private async readResultCache(cacheKey: string): Promise<ProjectRecord | null> {
    const item = ProjectGenerator.resultCache.get(cacheKey);
    if (!item) return null;
    if (Date.now() - item.cachedAt > ProjectGenerator.RESULT_CACHE_TTL_MS) {
      ProjectGenerator.resultCache.delete(cacheKey);
      return null;
    }
    return this.projectStore.get(item.projectId);
  }

  private writeResultCache(cacheKey: string, projectId: string): void {
    ProjectGenerator.resultCache.set(cacheKey, { projectId, cachedAt: Date.now() });
  }
}
