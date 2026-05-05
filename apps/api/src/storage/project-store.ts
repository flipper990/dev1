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
  /**
   * Stack selection mode chosen for this project.
   *   - 'auto'   (default): the spec agent picked the stack from the prompt.
   *   - 'manual': the user explicitly chose technologies in the UI.
   * Missing / undefined is treated as 'auto' for backward compatibility.
   */
  stackSelectionMode?: 'auto' | 'manual';
  /**
   * Final technology stack the pipeline committed to (mirror of
   * `spec.techStack`). Materialised on the record so UI/validators don't have
   * to dive into the spec object.
   */
  techStack?: Record<string, string>;
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
  /** Real-environment execution-runner verdict (npm install + build + dev). */
  executionValidation?: {
    finalVerdict: 'pass' | 'fail';
    iterations: number;
    buildErrors: string[];
    runtimeErrors: string[];
    httpProbes?: Array<{
      path: string;
      ok: boolean;
      status: number | null;
      bodyBytes: number;
      durationMs: number;
      error?: string;
    }>;
    totalDurationMs: number;
    completedAt: string;
    reason?: string;
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
  /** Failure message when status === 'failed'. */
  error?: string;
  /** ISO timestamp of last update (set on update() calls, not initial generate). */
  updatedAt?: string;
  /** Current version number (1 = initial generation, 2+ = updates). */
  version: number;
  /** Lightweight history of all versions. Oldest first. */
  versionHistory: VersionMeta[];
  /** Non-fatal warnings produced during the pipeline (e.g. partial output
   *  from a soft-deadline break). The project still finishes as 'completed'
   *  but consumers can surface these. */
  warnings?: Array<{ code: string; message: string; details?: Record<string, unknown> }>;
  /**
   * Live heartbeat used by external watchdogs to distinguish a *stuck*
   * pipeline from one that is genuinely making early-startup progress.
   * Updated at every meaningful transition (entering spec, before/after the
   * first LLM call, after slices planned, after each persistence write,
   * after each QA iteration). Never persisted by the updater — belongs to
   * the active generation only.
   */
  progress?: {
    /** High-level phase tag: 'init' | 'spec' | 'slice-N/M' | 'final-assembly' | 'qa-gate' | 'execution-validation'. */
    phase: string;
    /** ISO timestamp of the last meaningful update. */
    lastProgressAt: string;
    /** ISO timestamp when the background runner first started. */
    startedAt: string;
    /** Free-form label for the most recent meaningful step ("orchestrator:execute:start", "slice-2:files-persisted", etc.). */
    lastMeaningfulStep: string;
    /** Count of orchestrator step:started events observed so far (≈ LLM agent invocations). */
    llmCallCount: number;
    /** Cumulative count of files persisted to the project record. */
    filesWrittenCount: number;
    /** Number of slices planned by the spec phase (0 until spec returns). */
    slicesPlannedCount: number;
    /**
     * ISO timestamp at which `lastMeaningfulStep` started. Stamped by
     * `markProgress` whenever the caller passes `stepStartedAt`. Used
     * by polling clients to compute "time spent in current step".
     */
    stepStartedAt?: string;
    /**
     * ISO timestamp at which `lastMeaningfulStep` finished. Set by the
     * paired `completeFinalizeStep` / `runFinalizeStep` helpers. When
     * present alongside a still-current `lastMeaningfulStep` it means
     * the step is done but the next step has not yet started.
     */
    stepCompletedAt?: string;
    /** Wall-clock duration (ms) of the most recently completed step. */
    stepDurationMs?: number;
    /** The previous step label, before the current `lastMeaningfulStep`. */
    previousStep?: string;
  };
  /**
   * Preview-runtime lifecycle state. **Decoupled from `status`** — `status`
   * tracks generation only ('generating' | 'completed' | 'failed'); this
   * block tracks the post-generation Docker/local preview server. Mirrored
   * from PreviewManager state on every transition so polling clients can
   * show "Preview starting…" without conflating with generation progress.
   */
  preview?: {
    /** Public preview state vocabulary (decoupled from internal docker states). */
    previewStatus: 'idle' | 'preparing' | 'installing' | 'building' | 'starting' | 'ready' | 'failed';
    /** Convenience flag — true iff previewStatus === 'ready'. */
    previewReady: boolean;
    /** Preview iframe URL (relative). Populated as soon as a host port is allocated. */
    previewUrl?: string | null;
    /** ISO timestamp when start() was first invoked. */
    previewStartedAt?: string | null;
    /** ISO timestamp the moment previewStatus first hit 'ready'. */
    previewReadyAt?: string | null;
    /** Failure message when previewStatus === 'failed'. */
    previewError?: string | null;
    /** Discrete lifecycle events with durations + stdout/stderr tails.
     *  Drives the dashboard “why is the preview taking so long?” view. */
    timeline?: Array<{
      event:
        | 'runner-start' | 'install-start' | 'install-end'
        | 'build-start' | 'build-end' | 'devserver-start'
        | 'port-assigned' | 'http-probe-ok' | 'url-published'
        | 'iframe-ready' | 'failed';
      at: string;
      projectId: string;
      previewStatus:
        | 'idle' | 'preparing' | 'installing' | 'building'
        | 'starting' | 'ready' | 'failed';
      durationMs?: number;
      details?: Record<string, unknown>;
      stdoutTail?: string;
      stderrTail?: string;
    }>;
  };
  /** Detailed crash record (set alongside `error` when status === 'failed'). */
  failure?: {
    failedPhase: string;
    errorName: string;
    errorMessage: string;
    stack?: string;
    failedAt: string;
    /** Most recently completed phase before the crash. Helps post-mortem
     *  pinpoint how far the pipeline got. */
    lastSuccessfulPhase?: string;
    /** Number of LLM calls observed (via orchestrator step:started events)
     *  before the crash. 0 means the failure happened before any LLM
     *  invocation \u2014 typically a setup/config problem. */
    llmCallCount?: number;
    /** Granular step within `failedPhase` where the throw happened (e.g.
     *  'final-assembly:assembleProject', 'qa-gate:runQualityAssurance',
     *  'finalize:projectStore.save'). */
    failedStep?: string;
    /** Most recently completed step before the crash. */
    lastSuccessfulStep?: string;
    /** Alias for `stack` \u2014 some consumers expect the conventional name. */
    errorStack?: string;
  };
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

    // Save generated files to disk. Wipe the previous output/ tree first
    // so files removed since the last save (e.g. by layout consolidation
    // that strips apps/web/* duplicates) don't linger on disk and confuse
    // downstream tooling like the runtime validator or the live preview.
    if (project.files.length > 0) {
      const outputDir = join(dir, 'output');
      if (existsSync(outputDir)) {
        await rm(outputDir, { recursive: true, force: true });
      }
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

  /**
   * Lightweight metadata-only update: rewrites project.json without
   * touching files on disk. Used by the PreviewManager to mirror its
   * state machine onto ProjectRecord.preview without paying the cost of
   * re-emitting the entire output/ tree.
   *
   * Best-effort: silently no-ops if the project.json is missing (e.g.
   * the project was deleted mid-flight).
   */
  async updatePreview(
    projectId: string,
    patch: NonNullable<ProjectRecord['preview']>,
  ): Promise<void> {
    const metaPath = join(this.baseDir, projectId, 'project.json');
    if (!existsSync(metaPath)) return;
    try {
      const raw = await readFile(metaPath, 'utf-8');
      const project = JSON.parse(raw) as ProjectRecord;
      project.preview = { ...(project.preview ?? {}), ...patch };
      await writeFile(metaPath, JSON.stringify(project, null, 2), 'utf-8');
    } catch (err) {
      this.logger.warn(`updatePreview(${projectId}) failed: ${(err as Error).message}`);
    }
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
