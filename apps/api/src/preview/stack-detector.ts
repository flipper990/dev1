// ─────────────────────────────────────────────────────────────
// Stack detector — figures out what kind of app the LLM produced
// so the preview runner can pick the right Dockerfile + dev cmd.
// ─────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { StackInfo, StackKind } from './types.js';

interface PkgJson {
  name?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** Read and parse package.json at outputDir root, or return null. */
function readPkg(outputDir: string): PkgJson | null {
  const p = join(outputDir, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8')) as PkgJson;
  } catch {
    return null;
  }
}

function hasDep(pkg: PkgJson | null, name: string): boolean {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[name] ?? pkg.devDependencies?.[name]);
}

/**
 * Inspect the project directory and decide which stack it is.
 * Heuristic order: fullstack monorepo → Next.js → Vite → plain React → Express → unknown.
 */
export function detectStack(outputDir: string): StackInfo {
  // Fullstack monorepo: apps/web + apps/api + docker-compose.yml
  const hasComposeFile =
    existsSync(join(outputDir, 'docker-compose.yml')) ||
    existsSync(join(outputDir, 'docker-compose.yaml')) ||
    existsSync(join(outputDir, 'compose.yml')) ||
    existsSync(join(outputDir, 'compose.yaml'));
  const hasWebApp = existsSync(join(outputDir, 'apps', 'web', 'package.json'));
  const hasApiApp = existsSync(join(outputDir, 'apps', 'api', 'package.json'));
  if (hasComposeFile && hasWebApp && hasApiApp) {
    return {
      kind: 'fullstack',
      port: 3000,           // web service exposes 3000
      healthPath: '/',
      detectionNote: 'Detected fullstack monorepo (apps/web + apps/api + docker-compose.yml)',
      hasDevScript: true,
    };
  }

  const pkg = readPkg(outputDir);
  const hasDevScript = Boolean(pkg?.scripts?.dev);

  // Next.js: package depends on next OR has next.config.*
  const hasNextConfig =
    existsSync(join(outputDir, 'next.config.js')) ||
    existsSync(join(outputDir, 'next.config.mjs')) ||
    existsSync(join(outputDir, 'next.config.ts'));
  if (hasDep(pkg, 'next') || hasNextConfig) {
    return {
      kind: 'nextjs',
      port: 3000,
      healthPath: '/',
      detectionNote: 'Detected Next.js (next dependency or next.config)',
      hasDevScript,
    };
  }

  // Vite: vite dep + (likely) react dep
  const hasViteConfig =
    existsSync(join(outputDir, 'vite.config.ts')) ||
    existsSync(join(outputDir, 'vite.config.js')) ||
    existsSync(join(outputDir, 'vite.config.mjs'));
  if (hasDep(pkg, 'vite') || hasViteConfig) {
    return {
      kind: 'vite-react',
      port: 5173,
      healthPath: '/',
      detectionNote: 'Detected Vite (vite dependency or vite.config)',
      hasDevScript,
    };
  }

  // Express / Fastify / generic Node API: an Express or Fastify dep AND a
  // server.{ts,js} or src/server.{ts,js} entry.
  const hasServerEntry =
    existsSync(join(outputDir, 'server.ts')) ||
    existsSync(join(outputDir, 'server.js')) ||
    existsSync(join(outputDir, 'src/server.ts')) ||
    existsSync(join(outputDir, 'src/server.js')) ||
    existsSync(join(outputDir, 'src/index.ts')) ||
    existsSync(join(outputDir, 'src/index.js'));
  if (hasServerEntry && (hasDep(pkg, 'express') || hasDep(pkg, 'fastify') || hasDep(pkg, 'koa') || hasDep(pkg, 'hono'))) {
    return {
      kind: 'node-express',
      port: 3000,
      healthPath: '/',
      detectionNote: 'Detected Node API server (express/fastify/koa/hono + server entry)',
      hasDevScript,
    };
  }

  // Plain React (CRA-ish or hand-rolled): react dep + index.html
  const hasIndexHtml =
    existsSync(join(outputDir, 'index.html')) ||
    existsSync(join(outputDir, 'public/index.html'));
  if (hasDep(pkg, 'react') && hasIndexHtml) {
    return {
      kind: 'plain-react',
      port: 8080,
      healthPath: '/',
      detectionNote: 'Detected plain React app (react dep + index.html, no Next/Vite)',
      hasDevScript,
    };
  }

  // Last resort: react dep alone — assume Vite-style (most likely intent)
  if (hasDep(pkg, 'react')) {
    return {
      kind: 'vite-react',
      port: 5173,
      healthPath: '/',
      detectionNote: 'Inferred Vite + React (react dep only, no config)',
      hasDevScript,
    };
  }

  const note = pkg
    ? 'package.json present but no recognised framework dep (next/vite/react/express/fastify)'
    : 'no package.json at project root';
  return {
    kind: 'unknown',
    port: 3000,
    healthPath: '/',
    detectionNote: note,
    hasDevScript,
  };
}

export function isRunnableStack(kind: StackKind): boolean {
  return kind !== 'unknown';
}
