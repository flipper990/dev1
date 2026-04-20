import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  unlinkSync,
} from 'node:fs';
import { join } from 'node:path';
import { config, Logger, generateId, now, NotFoundError } from '@devteam/core';
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
    writeFileSync(path, JSON.stringify(project, null, 2));
    return project;
  }

  async get(id: string): Promise<Project> {
    const path = this.projectPath(id);
    if (!existsSync(path)) throw new NotFoundError('Project', id);
    return JSON.parse(readFileSync(path, 'utf8')) as Project;
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
    // Prevent path traversal
    if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`Invalid project ID: ${id}`);
    return join(this.dir, `${id}.json`);
  }
}

export const projectStore = new ProjectStore();
