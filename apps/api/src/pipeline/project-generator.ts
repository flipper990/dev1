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
import { ProjectStore, type ProjectRecord, type TaskSummary, type FileDiff, type VersionMeta, type ProjectSnapshot } from '../storage/project-store.js';
import { FileMemoryStore } from '../storage/memory-store.js';
import { computeFileDiffs } from './diff-utils.js';

// ── Public API Types ────────────────────────────────────────

export interface GenerateRequest {
  prompts: string[];
  userId?: string;
  preferences?: Record<string, unknown>;
}

export interface UpdateRequest {
  /** Existing project to update. */
  projectId: string;
  /** New prompts describing the desired changes. */
  prompts: string[];
  userId?: string;
  preferences?: Record<string, unknown>;
  /**
   * Scope hint for how much of the pipeline to re-run.
   * - 'code'   — Only code/test/review/debug/optimize steps (reuse planner + architect).
   * - 'design' — Re-run from architect onward (reuse planner only).
   * - 'full'   — Re-run the complete pipeline (same as a fresh generate).
   *
   * When omitted, defaults to 'code' (most common case: add a feature or fix a bug).
   */
  scope?: 'code' | 'design' | 'full';
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

export interface UpdateResult {
  projectId: string;
  sessionId: string;
  success: boolean;
  project?: ProjectRecord;
  /** New version number after the update. */
  version?: number;
  /** File-level diff between previous and new version. */
  diffs?: FileDiff[];
  steps?: StepSummary[];
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

    // 6. Apply optimizer patches (performance/quality improvements applied after bug fixes)
    const optimizerOutput = artifacts.get('optimizer') as { patches?: Patch[] } | undefined;
    if (optimizerOutput?.patches) {
      this.applyPatches(fileMap, optimizerOutput.patches, 'optimizer');
    }

    // 7. Ensure deployment-ready baseline artifacts always exist.
    this.ensureDeploymentReadiness(fileMap, artifacts);

    // 8. Guarantee UI foundation files exist for frontend projects.
    this.injectUIFoundation(fileMap, artifacts);

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

  // ══════════════════════════════════════════════════════════
  // UI Foundation Injection
  // Guarantees essential primitive files exist so the generated
  // frontend can always compile. Only injects when missing.
  // ══════════════════════════════════════════════════════════

  private injectUIFoundation(
    fileMap: Map<string, ProjectFile>,
    artifacts: Map<AgentRole, Record<string, unknown>>,
  ): void {
    // Only run for projects that have frontend files.
    const hasFrontend = [...fileMap.keys()].some(
      p => /\.(tsx|jsx|vue|svelte)$/.test(p) || /(\/app\/|\/pages\/|\/components\/)/.test(p),
    );
    if (!hasFrontend) return;

    const spec = artifacts.get('architect') as {
      designSystem?: {
        colorPalette?: Record<string, string>;
        typography?: { fontFamily?: string; fontFamilyMono?: string };
        borderRadius?: Record<string, string>;
        shadows?: Record<string, string>;
      };
    } | undefined;

    const colors = spec?.designSystem?.colorPalette ?? {};
    const fontFamily = spec?.designSystem?.typography?.fontFamily ?? 'Inter, system-ui, sans-serif';
    const fontFamilyMono = spec?.designSystem?.typography?.fontFamilyMono ?? 'ui-monospace, monospace';
    const radii = spec?.designSystem?.borderRadius ?? {};
    const shadows = spec?.designSystem?.shadows ?? {};

    // ── cn() utility ─────────────────────────────────────────

    if (!fileMap.has('src/lib/cn.ts')) {
      fileMap.set('src/lib/cn.ts', {
        path: 'src/lib/cn.ts',
        content: [
          "import { clsx, type ClassValue } from 'clsx';",
          "import { twMerge } from 'tailwind-merge';",
          '',
          'export function cn(...inputs: ClassValue[]) {',
          '  return twMerge(clsx(inputs));',
          '}',
          '',
        ].join('\n'),
        language: 'typescript',
      });
    }

    // ── tailwind.config.ts ────────────────────────────────────

    if (!fileMap.has('tailwind.config.ts')) {
      const colorEntries = Object.entries(colors)
        .map(([k, v]) => `      '${k}': '${v}',`)
        .join('\n');

      const radiusEntries = Object.entries(radii)
        .map(([k, v]) => `      '${k}': '${v}',`)
        .join('\n');

      const shadowEntries = Object.entries(shadows)
        .map(([k, v]) => `      '${k}': '${v}',`)
        .join('\n');

      fileMap.set('tailwind.config.ts', {
        path: 'tailwind.config.ts',
        content: [
          "import type { Config } from 'tailwindcss';",
          '',
          'const config: Config = {',
          "  content: ['./src/**/*.{ts,tsx}', './app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],",
          "  darkMode: 'class',",
          '  theme: {',
          '    extend: {',
          '      colors: {',
          colorEntries,
          '      },',
          '      fontFamily: {',
          `        sans: ['${fontFamily}'],`,
          `        mono: ['${fontFamilyMono}'],`,
          '      },',
          '      borderRadius: {',
          radiusEntries,
          '      },',
          '      boxShadow: {',
          shadowEntries,
          '      },',
          '    },',
          '  },',
          "  plugins: [require('tailwindcss-animate')],",
          '};',
          '',
          'export default config;',
          '',
        ].join('\n'),
        language: 'typescript',
      });
    }

    // ── Button ────────────────────────────────────────────────

    if (!fileMap.has('src/components/ui/Button.tsx')) {
      fileMap.set('src/components/ui/Button.tsx', {
        path: 'src/components/ui/Button.tsx',
        content: [
          "import * as React from 'react';",
          "import { cva, type VariantProps } from 'class-variance-authority';",
          "import { cn } from '@/lib/cn';",
          "import { Spinner } from './Spinner';",
          '',
          'const buttonVariants = cva(',
          "  'inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors",
          "   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          "   disabled:pointer-events-none disabled:opacity-50',",
          '  {',
          '    variants: {',
          '      variant: {',
          "        primary:     'bg-primary text-primary-foreground hover:bg-primary/90',",
          "        secondary:   'bg-secondary text-secondary-foreground hover:bg-secondary/80',",
          "        outline:     'border border-border bg-background hover:bg-muted hover:text-foreground',",
          "        ghost:       'hover:bg-muted hover:text-foreground',",
          "        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',",
          "        link:        'text-primary underline-offset-4 hover:underline',",
          '      },',
          '      size: {',
          "        sm: 'h-8  px-3 text-xs',",
          "        md: 'h-10 px-4 py-2',",
          "        lg: 'h-11 px-6 text-base',",
          "        icon: 'h-10 w-10',",
          '      },',
          '    },',
          "    defaultVariants: { variant: 'primary', size: 'md' },",
          '  },',
          ');',
          '',
          'export interface ButtonProps',
          '  extends React.ButtonHTMLAttributes<HTMLButtonElement>,',
          '    VariantProps<typeof buttonVariants> {',
          '  loading?: boolean;',
          '  leftIcon?: React.ReactNode;',
          '  rightIcon?: React.ReactNode;',
          '}',
          '',
          'export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(',
          '  ({ className, variant, size, loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => (',
          '    <button',
          '      ref={ref}',
          '      className={cn(buttonVariants({ variant, size }), className)}',
          '      disabled={disabled || loading}',
          '      {...props}',
          '    >',
          '      {loading ? <Spinner size="sm" /> : leftIcon}',
          '      {children}',
          '      {!loading && rightIcon}',
          '    </button>',
          '  ),',
          ');',
          "Button.displayName = 'Button';",
          '',
        ].join('\n'),
        language: 'typescriptreact',
      });
    }

    // ── Input ─────────────────────────────────────────────────

    if (!fileMap.has('src/components/ui/Input.tsx')) {
      fileMap.set('src/components/ui/Input.tsx', {
        path: 'src/components/ui/Input.tsx',
        content: [
          "import * as React from 'react';",
          "import { cn } from '@/lib/cn';",
          '',
          'export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {',
          '  label?: string;',
          '  error?: string;',
          '  helperText?: string;',
          '  leftElement?: React.ReactNode;',
          '  rightElement?: React.ReactNode;',
          '}',
          '',
          'export const Input = React.forwardRef<HTMLInputElement, InputProps>(',
          '  ({ className, label, error, helperText, leftElement, rightElement, id, ...props }, ref) => {',
          '    const inputId = id ?? React.useId();',
          '    return (',
          '      <div className="flex flex-col gap-1.5">',
          '        {label && (',
          '          <label htmlFor={inputId} className="text-sm font-medium text-foreground">',
          '            {label}',
          '            {props.required && <span className="text-destructive ml-0.5">*</span>}',
          '          </label>',
          '        )}',
          '        <div className="relative flex items-center">',
          '          {leftElement && (',
          '            <div className="absolute left-3 text-muted-foreground">{leftElement}</div>',
          '          )}',
          '          <input',
          '            ref={ref}',
          '            id={inputId}',
          '            className={cn(',
          "              'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm",
          "               ring-offset-background placeholder:text-muted-foreground",
          "               focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
          "               disabled:cursor-not-allowed disabled:opacity-50',",
          "              error && 'border-destructive focus-visible:ring-destructive/20',",
          '              leftElement && "pl-9",',
          '              rightElement && "pr-9",',
          '              className,',
          '            )}',
          '            aria-invalid={!!error}',
          '            aria-describedby={error ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}',
          '            {...props}',
          '          />',
          '          {rightElement && (',
          '            <div className="absolute right-3 text-muted-foreground">{rightElement}</div>',
          '          )}',
          '        </div>',
          '        {error && (',
          '          <p id={`${inputId}-error`} role="alert" className="text-xs text-destructive">',
          '            {error}',
          '          </p>',
          '        )}',
          '        {!error && helperText && (',
          '          <p id={`${inputId}-helper`} className="text-xs text-muted-foreground">',
          '            {helperText}',
          '          </p>',
          '        )}',
          '      </div>',
          '    );',
          '  },',
          ');',
          "Input.displayName = 'Input';",
          '',
        ].join('\n'),
        language: 'typescriptreact',
      });
    }

    // ── Badge ─────────────────────────────────────────────────

    if (!fileMap.has('src/components/ui/Badge.tsx')) {
      fileMap.set('src/components/ui/Badge.tsx', {
        path: 'src/components/ui/Badge.tsx',
        content: [
          "import * as React from 'react';",
          "import { cva, type VariantProps } from 'class-variance-authority';",
          "import { cn } from '@/lib/cn';",
          '',
          'const badgeVariants = cva(',
          "  'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium transition-colors',",
          '  {',
          '    variants: {',
          '      variant: {',
          "        default:     'bg-primary/10 text-primary',",
          "        secondary:   'bg-secondary text-secondary-foreground',",
          "        success:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',",
          "        warning:     'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400',",
          "        destructive: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',",
          "        outline:     'border border-border text-foreground',",
          '      },',
          '    },',
          "    defaultVariants: { variant: 'default' },",
          '  },',
          ');',
          '',
          'export interface BadgeProps',
          '  extends React.HTMLAttributes<HTMLSpanElement>,',
          '    VariantProps<typeof badgeVariants> {}',
          '',
          'export function Badge({ className, variant, ...props }: BadgeProps) {',
          '  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;',
          '}',
          '',
        ].join('\n'),
        language: 'typescriptreact',
      });
    }

    // ── Card ──────────────────────────────────────────────────

    if (!fileMap.has('src/components/ui/Card.tsx')) {
      fileMap.set('src/components/ui/Card.tsx', {
        path: 'src/components/ui/Card.tsx',
        content: [
          "import * as React from 'react';",
          "import { cn } from '@/lib/cn';",
          '',
          'export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {',
          '  hoverable?: boolean;',
          '}',
          '',
          'export function Card({ className, hoverable, ...props }: CardProps) {',
          '  return (',
          '    <div',
          '      className={cn(',
          "        'rounded-lg border border-border bg-card text-card-foreground shadow-sm',",
          "        hoverable && 'transition-shadow hover:shadow-md cursor-pointer',",
          '        className,',
          '      )}',
          '      {...props}',
          '    />',
          '  );',
          '}',
          '',
          'export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
          '  return <div className={cn("flex flex-col space-y-1.5 p-6", className)} {...props} />;',
          '}',
          '',
          'export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {',
          '  return <h3 className={cn("text-lg font-semibold leading-none tracking-tight", className)} {...props} />;',
          '}',
          '',
          'export function CardDescription({ className, ...props }: React.HTMLAttributes<HTMLParagraphElement>) {',
          '  return <p className={cn("text-sm text-muted-foreground", className)} {...props} />;',
          '}',
          '',
          'export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
          '  return <div className={cn("p-6 pt-0", className)} {...props} />;',
          '}',
          '',
          'export function CardFooter({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
          '  return <div className={cn("flex items-center p-6 pt-0", className)} {...props} />;',
          '}',
          '',
        ].join('\n'),
        language: 'typescriptreact',
      });
    }

    // ── Spinner ───────────────────────────────────────────────

    if (!fileMap.has('src/components/ui/Spinner.tsx')) {
      fileMap.set('src/components/ui/Spinner.tsx', {
        path: 'src/components/ui/Spinner.tsx',
        content: [
          "import * as React from 'react';",
          "import { cn } from '@/lib/cn';",
          '',
          'export interface SpinnerProps extends React.SVGAttributes<SVGElement> {',
          "  size?: 'sm' | 'md' | 'lg';",
          '}',
          '',
          "const sizeMap = { sm: 'w-4 h-4', md: 'w-6 h-6', lg: 'w-8 h-8' };",
          '',
          'export function Spinner({ size = "md", className, ...props }: SpinnerProps) {',
          '  return (',
          '    <svg',
          '      className={cn("animate-spin text-current", sizeMap[size], className)}',
          '      xmlns="http://www.w3.org/2000/svg"',
          '      fill="none"',
          '      viewBox="0 0 24 24"',
          '      aria-hidden="true"',
          '      {...props}',
          '    >',
          '      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />',
          '      <path',
          '        className="opacity-75"',
          '        fill="currentColor"',
          '        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"',
          '      />',
          '    </svg>',
          '  );',
          '}',
          '',
        ].join('\n'),
        language: 'typescriptreact',
      });
    }

    // ── Skeleton ──────────────────────────────────────────────

    if (!fileMap.has('src/components/ui/Skeleton.tsx')) {
      fileMap.set('src/components/ui/Skeleton.tsx', {
        path: 'src/components/ui/Skeleton.tsx',
        content: [
          "import * as React from 'react';",
          "import { cn } from '@/lib/cn';",
          '',
          'export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {',
          '  return <div className={cn("animate-pulse rounded-md bg-muted", className)} {...props} />;',
          '}',
          '',
        ].join('\n'),
        language: 'typescriptreact',
      });
    }

    // ── EmptyState ────────────────────────────────────────────

    if (!fileMap.has('src/components/ui/EmptyState.tsx')) {
      fileMap.set('src/components/ui/EmptyState.tsx', {
        path: 'src/components/ui/EmptyState.tsx',
        content: [
          "import * as React from 'react';",
          "import { cn } from '@/lib/cn';",
          '',
          'export interface EmptyStateProps {',
          '  icon?: React.ReactNode;',
          '  title: string;',
          '  description?: string;',
          '  action?: React.ReactNode;',
          '  className?: string;',
          '}',
          '',
          'export function EmptyState({ icon, title, description, action, className }: EmptyStateProps) {',
          '  return (',
          '    <div className={cn("flex flex-col items-center justify-center gap-3 py-12 text-center", className)}>',
          '      {icon && <div className="text-muted-foreground/50">{icon}</div>}',
          '      <div className="space-y-1">',
          '        <h3 className="text-sm font-semibold text-foreground">{title}</h3>',
          '        {description && (',
          '          <p className="text-sm text-muted-foreground max-w-xs mx-auto">{description}</p>',
          '        )}',
          '      </div>',
          '      {action && <div className="mt-2">{action}</div>}',
          '    </div>',
          '  );',
          '}',
          '',
        ].join('\n'),
        language: 'typescriptreact',
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

  // ══════════════════════════════════════════════════════════
  // Update — Re-run pipeline on an existing project
  // ══════════════════════════════════════════════════════════

  async update(request: UpdateRequest): Promise<UpdateResult> {
    const { projectId, prompts, userId, preferences, scope = 'code' } = request;
    const sessionId = nanoid(16);

    // ── 1. Load & validate existing project ─────────────
    const existing = await this.projectStore.get(projectId);
    if (!existing) {
      return { projectId, sessionId, success: false, error: `Project ${projectId} not found` };
    }
    if (existing.status === 'generating') {
      return { projectId, sessionId, success: false, error: 'Project is still generating; wait for it to complete before updating' };
    }

    // ── 2. Create session with merged prompts ────────────
    // Include original prompts so agents understand the full product context.
    const allPrompts = [...(existing.prompts ?? []), ...prompts];
    const session = this.sessionManager.createSession(allPrompts, userId ?? 'system');
    if (preferences) {
      session.artifacts.set('userPreferences', preferences);
    }

    // ── 3. Seed global memory hints ──────────────────────
    const reusable = await this.memoryStore.getGlobal({
      queryText: allPrompts.join('\n'),
      limit: 5,
      includeGlobal: true,
    });
    if (reusable.length > 0) {
      session.artifacts.set('globalMemoryHints', reusable.map(m => m.content));
    }

    // ── 4. Build seedArtifacts based on scope ────────────
    //
    // 'code'   → planner + architect outputs reused; developer/reviewer/etc re-run
    // 'design' → planner output reused; architect + downstream re-run
    // 'full'   → nothing seeded; full pipeline re-runs
    const seedArtifacts = new Map<AgentRole, Record<string, unknown>>();

    if (scope !== 'full') {
      if (existing.plan) {
        seedArtifacts.set('planner', existing.plan as Record<string, unknown>);
      }
    }
    if (scope === 'code') {
      if (existing.spec) {
        seedArtifacts.set('architect', existing.spec as Record<string, unknown>);
      }
    }

    // Always expose existing files to the developer agent as context so it
    // can perform surgical updates rather than generating from scratch.
    if (existing.files && existing.files.length > 0) {
      session.artifacts.set('existingFiles', existing.files);
    }

    // ── 5. Mark project as updating ─────────────────────
    existing.status = 'generating';
    await this.projectStore.save(existing);

    // ── 6. Run orchestrator ──────────────────────────────
    const bus = new InMemoryMessageBus();
    const orchestrator = new PipelineOrchestrator(this.agents, bus, this.logger);
    orchestrator.onEvent((event: PipelineEvent) => {
      this.sessionManager.handleEvent(event);
    });

    this.logger.info(`Starting update for project ${projectId}`, {
      sessionId,
      scope,
      newPrompts: prompts.length,
      seededRoles: [...seedArtifacts.keys()],
    });

    this.activeGenerations++;
    try {
      const pipelineState = await orchestrator.execute(session, seedArtifacts);

      // ── 7. Assemble new files ────────────────────────
      const newFiles = this.assembleProject(pipelineState.artifacts);

      // ── 8. Compute diffs ─────────────────────────────
      const diffs = computeFileDiffs(existing.files ?? [], newFiles);

      // ── 9. Save previous version snapshot ───────────
      const previousVersion = existing.version ?? 1;
      const snapshot: ProjectSnapshot = {
        version: previousVersion,
        projectId,
        savedAt: new Date().toISOString(),
        files: existing.files ?? [],
        spec: existing.spec as Record<string, unknown> | undefined,
        plan: existing.plan as Record<string, unknown> | undefined,
        diffs,
        prompts: existing.prompts ?? [],
        stats: {
          totalTokens: existing.totalTokens ?? 0,
          totalCostUsd: existing.totalCostUsd ?? 0,
          durationMs: existing.durationMs ?? 0,
          filesCount: (existing.files ?? []).length,
        },
      };
      await this.projectStore.saveSnapshot(projectId, snapshot);

      // ── 10. Build updated version metadata ───────────
      const newVersion = previousVersion + 1;
      const taskSummaries = this.buildTaskSummaries(pipelineState);
      const stepSummaries = this.buildStepSummaries(pipelineState);
      const planOutput = pipelineState.artifacts.get('planner') as { projectName?: string } | undefined;

      const versionMeta: VersionMeta = {
        version: newVersion,
        savedAt: new Date().toISOString(),
        prompts,
        diffs,
        stats: {
          totalTokens: taskSummaries.reduce((s, t) => s + t.tokensUsed, 0),
          totalCostUsd: taskSummaries.reduce((s, t) => s + t.costUsd, 0),
          durationMs: pipelineState.durationMs,
          filesCount: newFiles.length,
        },
      };

      // ── 11. Update and save the project record ───────
      existing.name = planOutput?.projectName ?? existing.name;
      existing.status = pipelineState.status === 'completed' ? 'completed' : 'failed';
      existing.prompts = allPrompts;
      existing.files = newFiles;
      existing.spec = pipelineState.artifacts.get('architect') as Record<string, unknown> | undefined ?? existing.spec;
      existing.plan = pipelineState.artifacts.get('planner') as Record<string, unknown> | undefined ?? existing.plan;
      existing.qaReport = pipelineState.artifacts.get('reviewer') as Record<string, unknown> | undefined;
      existing.tasks = taskSummaries;
      existing.totalTokens = (existing.totalTokens ?? 0) + versionMeta.stats.totalTokens;
      existing.totalCostUsd = (existing.totalCostUsd ?? 0) + versionMeta.stats.totalCostUsd;
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
        projectId,
        sessionId,
        success: pipelineState.status === 'completed',
        project: existing,
        version: newVersion,
        diffs,
        steps: stepSummaries,
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
