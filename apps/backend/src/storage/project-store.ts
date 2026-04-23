import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  unlinkSync,
  renameSync,
} from 'node:fs';
import { dirname, extname, join } from 'node:path';
import { config, Logger, generateId, now, NotFoundError, ValidationError } from '@devteam/core';
import type { Project } from '@devteam/core';

// ─── Project Store ────────────────────────────────────────────────────────────

export class ProjectStore {
  private readonly dir: string;
  private readonly logger = new Logger('project-store');

  constructor() {
    this.dir = join(config.storage.path, 'projects');
    mkdirSync(this.dir, { recursive: true });
  }

  async save(project: Project): Promise<Project> {
    const path = this.projectPath(project.id);
    // Atomic write: write to temp file then rename to avoid partial/corrupt
    // state if a concurrent save or process crash happens mid-write.
    const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, JSON.stringify(project, null, 2));
    try {
      // fs.renameSync is atomic on the same filesystem on all major platforms.
      renameSync(tmp, path);
    } catch (err) {
      // Fallback: direct write, then clean up temp.
      try { writeFileSync(path, JSON.stringify(project, null, 2)); } finally {
        try { unlinkSync(tmp); } catch { /* ignore */ }
      }
      this.logger.warn('Atomic rename failed, fell back to direct write', { projectId: project.id, error: (err as Error).message });
    }
    this.exportProjectFiles(project);
    return project;
  }

  async get(id: string): Promise<Project> {
    const path = this.projectPath(id);
    if (!existsSync(path)) throw new NotFoundError('Project', id);
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as Project;
    } catch (err) {
      // Corrupted JSON — treat as missing rather than crashing the whole endpoint.
      this.logger.error('Failed to parse project file', { projectId: id, error: (err as Error).message });
      throw new NotFoundError('Project', id);
    }
  }

  async list(limit = 20, offset = 0): Promise<{ projects: Project[]; total: number }> {
    const files = readdirSync(this.dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse();

    const total = files.length;
    const page = files.slice(offset, offset + limit);

    const projects = page.map((f) => {
      try {
        return JSON.parse(readFileSync(join(this.dir, f), 'utf8')) as Project;
      } catch {
        this.logger.warn('Failed to parse project file', { file: f });
        return null;
      }
    }).filter((p): p is Project => p !== null);

    return { projects, total };
  }

  async delete(id: string): Promise<void> {
    const path = this.projectPath(id);
    if (!existsSync(path)) throw new NotFoundError('Project', id);
    unlinkSync(path);
  }

  private projectPath(id: string): string {
    // Prevent path traversal. Use a proper 400-level error so Fastify's error
    // handler returns a ValidationError instead of a generic 500.
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new ValidationError(`Invalid project ID: ${id}`);
    return join(this.dir, `${id}.json`);
  }

  private exportProjectFiles(project: Project): void {
    const outDir = join(config.storage.path, 'generated', project.id);
    mkdirSync(outDir, { recursive: true });

    const duplicateCount = new Map<string, number>();
    const bundleParts: string[] = [
      `# Project: ${project.name}`,
      `# Project ID: ${project.id}`,
      `# Generated At: ${new Date().toISOString()}`,
      '',
      `# Prompt`,
      project.prompt,
      '',
      '# Files',
      '',
    ];

    for (const file of project.artifacts.files ?? []) {
      const safeRelativePath = this.sanitizeArtifactPath(file.path);
      if (!safeRelativePath) {
        this.logger.warn('Skipped unsafe generated file path', { projectId: project.id, path: file.path });
        continue;
      }

      const count = duplicateCount.get(safeRelativePath) ?? 0;
      duplicateCount.set(safeRelativePath, count + 1);
      const finalRelativePath = count === 0 ? safeRelativePath : this.withDuplicateSuffix(safeRelativePath, count + 1);

      const targetPath = join(outDir, finalRelativePath);
      mkdirSync(dirname(targetPath), { recursive: true });
      writeFileSync(targetPath, file.content, 'utf8');

      bundleParts.push(`===== FILE: ${finalRelativePath} =====`);
      bundleParts.push(file.content);
      bundleParts.push('');
    }

    writeFileSync(join(outDir, 'FULL_CODE_BUNDLE.txt'), bundleParts.join('\n'), 'utf8');
    this.logger.info('Exported generated project files', { projectId: project.id, outputDir: outDir });
  }

  private sanitizeArtifactPath(inputPath: string): string | null {
    const normalized = inputPath.replace(/\\/g, '/').trim().replace(/^\/+/, '');
    if (!normalized) return null;

    const segments = normalized.split('/').filter(Boolean);
    if (segments.length === 0) return null;
    if (segments.some((segment) => segment === '.' || segment === '..')) return null;

    return segments.join('/');
  }

  private withDuplicateSuffix(filePath: string, ordinal: number): string {
    const extension = extname(filePath);
    if (!extension) return `${filePath}__dup${ordinal}`;
    const base = filePath.slice(0, -extension.length);
    return `${base}__dup${ordinal}${extension}`;
  }
}

export const projectStore = new ProjectStore();
