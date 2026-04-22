// ─── Docker Service ───────────────────────────────────────────────────────────
// Manages one nginx:alpine container per project.
// Falls back gracefully when Docker is not available.

import { exec, execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { Logger } from '@devteam/core';

interface ContainerInfo {
  port: number;
  url: string;
  status: 'building' | 'running' | 'failed';
}

export class DockerService {
  private readonly containers = new Map<string, ContainerInfo>();
  private available: boolean | null = null;
  private readonly logger = new Logger('docker');

  isAvailable(): boolean {
    if (this.available !== null) return this.available;
    try {
      execSync('docker info', { stdio: 'pipe', timeout: 5000 });
      this.available = true;
      this.logger.info('Docker daemon is available — per-project containers enabled');
    } catch {
      this.available = false;
      this.logger.warn('Docker daemon not available — preview containers disabled');
    }
    return this.available;
  }

  /** Launch an nginx container serving the given HTML. Non-blocking — builds in background. */
  launch(projectId: string, htmlContent: string): void {
    if (!this.isAvailable()) return;

    // Mark as building immediately so the endpoint can return status
    this.containers.set(projectId, { port: 0, url: '', status: 'building' });

    this.doLaunch(projectId, htmlContent).catch((err) => {
      this.logger.error('Container launch failed', { projectId, error: String(err) });
      this.containers.set(projectId, { port: 0, url: '', status: 'failed' });
    });
  }

  private async doLaunch(projectId: string, htmlContent: string): Promise<void> {
    const containerName = `devteam-${projectId}`;

    // Stop + remove any existing container / image for this project
    await this.runCmd(`docker rm -f ${containerName}`).catch(() => {});
    await this.runCmd(`docker rmi -f ${containerName}`).catch(() => {});

    // Write files into a temp build context
    const buildDir = join(tmpdir(), `devteam-build-${projectId}`);
    try {
      mkdirSync(buildDir, { recursive: true });
      writeFileSync(join(buildDir, 'index.html'), htmlContent, 'utf8');
      writeFileSync(
        join(buildDir, 'Dockerfile'),
        'FROM nginx:alpine\nCOPY index.html /usr/share/nginx/html/index.html\n',
        'utf8',
      );

      // Build image (nginx:alpine layer is cached after first use — fast)
      await this.runCmd(`docker build -t ${containerName} "${buildDir}"`);

      // Find a free port in range 3100–4000
      const port = await this.findFreePort(3100, 4000);

      // Run container
      await this.runCmd(`docker run -d --name ${containerName} -p ${port}:80 --restart unless-stopped ${containerName}`);

      const url = `http://localhost:${port}`;
      this.containers.set(projectId, { port, url, status: 'running' });
      this.logger.info('Container running', { projectId, url });
    } finally {
      // Clean up temp build dir
      try { rmSync(buildDir, { recursive: true, force: true }); } catch { /* ignore */ }
    }
  }

  getInfo(projectId: string): ContainerInfo | undefined {
    return this.containers.get(projectId);
  }

  getUrl(projectId: string): string | undefined {
    const info = this.containers.get(projectId);
    return info?.status === 'running' ? info.url : undefined;
  }

  async stop(projectId: string): Promise<void> {
    const name = `devteam-${projectId}`;
    await this.runCmd(`docker rm -f ${name}`).catch(() => {});
    await this.runCmd(`docker rmi -f ${name}`).catch(() => {});
    this.containers.delete(projectId);
  }

  stopAll(): void {
    for (const projectId of this.containers.keys()) {
      const name = `devteam-${projectId}`;
      exec(`docker rm -f ${name}`, () => {});
      exec(`docker rmi -f ${name}`, () => {});
    }
    this.containers.clear();
  }

  private runCmd(cmd: string): Promise<void> {
    return new Promise((resolve, reject) => {
      exec(cmd, { timeout: 90_000 }, (err) => (err ? reject(err) : resolve()));
    });
  }

  private findFreePort(start: number, end: number): Promise<number> {
    return new Promise((resolve, reject) => {
      const tryPort = (port: number) => {
        if (port > end) { reject(new Error('No free port found')); return; }
        const srv = createServer();
        srv.listen(port, '127.0.0.1');
        srv.on('listening', () => srv.close(() => resolve(port)));
        srv.on('error', () => tryPort(port + 1));
      };
      tryPort(start);
    });
  }
}

export const dockerService = new DockerService();
