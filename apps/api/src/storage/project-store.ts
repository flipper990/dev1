// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// File-based storage â€” JSON persistence for projects + sessions
// Works standalone, no DB required to start
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

import { mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { Session, Task, AgentRole } from '../../../../packages/agent-core/src/types.js';

// â”€â”€ Version / Diff Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type FileDiffOp = 'added' | 'modified' | 'deleted' | 'unchanged';

export interface FileDiff {
  path: string;
  op: FileDiffOp;
  /** Lines added (for 'added' and 'modified'). */
  additions: number;
  /** Lines removed (for 'deleted' and 'modified'). */
  deletions: number;
}

/** Lightweight metadata stored inline in ProjectRecord.versionHistory. */
export interface VersionMeta {
  /** 1-based version number. */
  version: number;
  /** The prompts that triggered this version. */
  prompts: string[];
  /** Summary of file changes in this version. */
  diffs: FileDiff[];
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: string;
}

/** Full snapshot stored per-version on disk (not loaded into ProjectRecord). */
export interface ProjectSnapshot {
  version: number;
  prompts: string[];
  files: { path: string; content: string }[];
  diffs: FileDiff[];
  spec?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  totalTokens: number;
  totalCostUsd: number;
  durationMs: number;
  createdAt: string;
}

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
  /** Intent-expansion output: features, UI expectations, quality standards. */
  expandedSpec?: Record<string, unknown>;
  /** Quality-enforcer output: scores, verdict, findings, patches summary. */
  qualityReport?: Record<string, unknown>;
  /** Final QA-gate report: UI, layout, e2e, preview, placeholders — see quality-assurance.ts. */
  qaAssurance?: {
    passed: boolean;
    score: number;
    autoFixCount: number;
    bars: Record<string, { passed: boolean; score: number; notes: string[] }>;
    blockers: { id: string; message: string; bar: string; file?: string }[];
  };
  /** Runtime validation summary from the post-build preview-validator + auto-fix loop. */
  runtimeValidation?: {
    finalVerdict: 'pass' | 'fail';
    iterations: number;
    issues: { category: string; message: string; hint?: string }[];
    totalDurationMs: number;
    completedAt: string;
  };
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
    /** Number of QA→Builder loop iterations executed (1 = no loop). */
    qaIterations?: number;
  };
  durationMs: number;
  createdAt: string;
  completedAt?: string;
  /** ISO timestamp of last update (set on update() calls, not initial generate). */
  updatedAt?: string;
  /** Current version number (1 = initial generation, 2+ = updates). */
  version: number;
  /** Lightweight history of all versions. Oldest first. */
  versionHistory: VersionMeta[];
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

  /**
   * Reap projects left in 'generating' state from a previous process. The API
   * runs all pipelines in-memory, so any 'generating' project on disk at
   * startup is by definition orphaned (its background task died with the
   * previous process). Demote them to 'failed' so the UI doesn't show a
   * permanent spinner. Returns the number of records reaped.
   */
  async reapStaleGenerating(): Promise<number> {
    if (!existsSync(this.baseDir)) return 0;
    const entries = await readdir(this.baseDir, { withFileTypes: true });
    let reaped = 0;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const metaPath = join(this.baseDir, entry.name, 'project.json');
      if (!existsSync(metaPath)) continue;
      try {
        const raw = await readFile(metaPath, 'utf-8');
        const project = JSON.parse(raw) as ProjectRecord;
        if (project.status !== 'generating') continue;
        project.status = 'failed';
        project.completedAt = project.completedAt ?? new Date().toISOString();
        await writeFile(metaPath, JSON.stringify(project, null, 2), 'utf-8');
        reaped++;
      } catch (err) {
        this.logger.warn(`reapStaleGenerating: skipped ${entry.name}: ${(err as Error).message}`);
      }
    }
    if (reaped > 0) this.logger.info(`Reaped ${reaped} orphaned 'generating' project(s) from previous run`);
    return reaped;
  }

  /** Save or update a project record */
  async save(project: ProjectRecord): Promise<void> {
    // Ensure version fields are always present (handles records created before versioning)
    if (!project.version) project.version = 1;
    if (!project.versionHistory) project.versionHistory = [];
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

  /** Save a full version snapshot to disk. */
  async saveSnapshot(projectId: string, snapshot: ProjectSnapshot): Promise<void> {
    const dir = join(this.baseDir, projectId, 'versions');
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, `v${snapshot.version}.json`),
      JSON.stringify(snapshot, null, 2),
      'utf-8',
    );
    this.logger.debug(`Saved snapshot v${snapshot.version} for project ${projectId}`);
  }

  /** Load a specific version snapshot by version number. */
  async getSnapshot(projectId: string, version: number): Promise<ProjectSnapshot | null> {
    const snapshotPath = join(this.baseDir, projectId, 'versions', `v${version}.json`);
    if (!existsSync(snapshotPath)) return null;
    const raw = await readFile(snapshotPath, 'utf-8');
    return JSON.parse(raw) as ProjectSnapshot;
  }

  /** List all version snapshot metadata for a project (without loading file contents). */
  async listSnapshots(projectId: string): Promise<{ version: number; path: string }[]> {
    const dir = join(this.baseDir, projectId, 'versions');
    if (!existsSync(dir)) return [];
    const entries = await readdir(dir);
    return entries
      .filter(f => /^v\d+\.json$/.test(f))
      .map(f => ({ version: parseInt(f.slice(1, -5), 10), path: join(dir, f) }))
      .sort((a, b) => a.version - b.version);
  }

  /** Get the output directory path for archiving */
  getOutputDir(projectId: string): string {
    return join(this.baseDir, projectId, 'output');
  }
}
