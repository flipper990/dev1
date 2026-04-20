// ─────────────────────────────────────────────────────────────
// File-based storage — JSON persistence for projects + sessions
// Works standalone, no DB required to start
// ─────────────────────────────────────────────────────────────

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { Logger } from '../../../packages/agent-core/src/base-agent.js';
import type { Session, Task, AgentRole } from '../../../packages/agent-core/src/types.js';

export interface ProjectRecord {
  id: string;
  sessionId: string;
  name: string;
  prompts: string[];
  status: 'generating' | 'completed' | 'failed';
  files: { path: string; content: string }[];
  spec?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  qaReport?: Record<string, unknown>;
  tasks: TaskSummary[];
  totalTokens: number;
  totalCostUsd: number;
  optimization?: {
    cacheHit: boolean;
    cacheKey: string;
    pipelineCacheHits: number;
    pipelineCacheMisses: number;
    skippedSteps: number;
    estimatedApiCallsSaved: number;
  };
  durationMs: number;
  createdAt: string;
  completedAt?: string;
}

export interface TaskSummary {
  id: string;
  agentRole: AgentRole;
  status: string;
  durationMs: number;
  tokensUsed: number;
  costUsd: number;
  error?: string;
}

export class ProjectStore {
  private baseDir: string;
  private logger: Logger;

  constructor(baseDir: string, logger: Logger) {
    this.baseDir = baseDir;
    this.logger = logger;
  }

  async init(): Promise<void> {
    await mkdir(this.baseDir, { recursive: true });
  }

  /** Save or update a project record */
  async save(project: ProjectRecord): Promise<void> {
    const dir = join(this.baseDir, project.id);
    await mkdir(dir, { recursive: true });

    // Save project metadata
    await writeFile(
      join(dir, 'project.json'),
      JSON.stringify(project, null, 2),
      'utf-8',
    );

    // Save generated files to disk
    if (project.files.length > 0) {
      const outputDir = join(dir, 'output');
      await mkdir(outputDir, { recursive: true });

      for (const file of project.files) {
        const filePath = join(outputDir, file.path);
        await mkdir(dirname(filePath), { recursive: true });
        await writeFile(filePath, file.content, 'utf-8');
      }
    }

    this.logger.debug(`Saved project ${project.id}`);
  }

  /** Load a project by ID */
  async get(projectId: string): Promise<ProjectRecord | null> {
    const metaPath = join(this.baseDir, projectId, 'project.json');
    if (!existsSync(metaPath)) return null;

    const raw = await readFile(metaPath, 'utf-8');
    return JSON.parse(raw) as ProjectRecord;
  }

  /** List all projects (metadata only, no file contents) */
  async list(): Promise<Omit<ProjectRecord, 'files'>[]> {
    if (!existsSync(this.baseDir)) return [];

    const entries = await readdir(this.baseDir, { withFileTypes: true });
    const projects: Omit<ProjectRecord, 'files'>[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(this.baseDir, entry.name, 'project.json');
      if (!existsSync(metaPath)) continue;

      try {
        const raw = await readFile(metaPath, 'utf-8');
        const project = JSON.parse(raw) as ProjectRecord;
        const { files: _, ...meta } = project;
        projects.push(meta);
      } catch {
        this.logger.warn(`Failed to read project ${entry.name}`);
      }
    }

    return projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /** Delete a project */
  async delete(projectId: string): Promise<boolean> {
    const dir = join(this.baseDir, projectId);
    if (!existsSync(dir)) return false;
    await rm(dir, { recursive: true, force: true });
    return true;
  }

  /** Get the output directory path for archiving */
  getOutputDir(projectId: string): string {
    return join(this.baseDir, projectId, 'output');
  }
}
