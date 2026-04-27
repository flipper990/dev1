// ─────────────────────────────────────────────────────────────
// Runnable scaffold injector
//
// LLM agents reliably produce *source* (pages, components, routes) but
// frequently forget the bootstrap files needed to actually run the
// project: package.json, tsconfig.json, next.config / vite.config,
// index.html for plain React. Without these, `npm install` fails and
// the preview runner has nothing to launch.
//
// This module fills those gaps deterministically by inferring the stack
// from emitted source files and writing minimal-but-correct config that
// makes `npm install && npm run dev` succeed.
//
// Heuristics (priority order):
//   • src/app/page.tsx + no vite/next config → Next.js (app router)
//   • next.config.* exists → Next.js
//   • vite.config.* exists → Vite + React
//   • index.html at root  → plain React (Vite-style scaffold for dev)
//   • src/server.ts + express dep → Node API only
//   • Otherwise: assume Next.js if React-like JSX detected, else skip
// ─────────────────────────────────────────────────────────────

import type { ProjectFile } from './generator-types.js';

type ScaffoldStack = 'nextjs' | 'vite-react' | 'plain-react' | 'node-express' | 'fullstack' | 'unknown';

export function ensureRunnableScaffold(fileMap: Map<string, ProjectFile>): void {
  const has = (p: string): boolean => fileMap.has(p);
  const hasAny = (...paths: string[]): boolean => paths.some((p) => fileMap.has(p));
  const hasReactSource = [...fileMap.keys()].some((k) => /\.(tsx|jsx)$/i.test(k));

  // Fullstack detection: any file under apps/web/ AND any file under apps/api/
  // → builder produced (or attempted) a fullstack monorepo. We treat this as
  // its own stack, with separate per-app scaffolding + a root compose file.
  const hasWebDir = [...fileMap.keys()].some((k) => k.startsWith('apps/web/'));
  const hasApiDir = [...fileMap.keys()].some((k) => k.startsWith('apps/api/'));
  const isFullstack = hasWebDir && hasApiDir;

  // Detect existing stack hints (regardless of scaffold presence).
  const stack: ScaffoldStack = isFullstack
    ? 'fullstack'
    : hasAny('next.config.js', 'next.config.mjs', 'next.config.ts') || has('src/app/page.tsx') || has('src/app/layout.tsx')
      ? 'nextjs'
      : hasAny('vite.config.ts', 'vite.config.js', 'vite.config.mjs')
        ? 'vite-react'
        : has('index.html')
          ? 'plain-react'
          : (has('src/server.ts') || has('server.ts') || has('src/server.js') || has('server.js')) && !hasReactSource
            ? 'node-express'
            : hasReactSource
              ? 'nextjs'
              : 'unknown';

  if (stack === 'unknown') return;

  // Always ensure tsconfig.json + .gitignore (skipped for fullstack — each
  // app gets its own tsconfig).
  if (stack !== 'fullstack' && !has('tsconfig.json')) {
    fileMap.set('tsconfig.json', { path: 'tsconfig.json', content: tsconfigFor(stack) });
  }
  if (!has('.gitignore')) {
    fileMap.set('.gitignore', {
      path: '.gitignore',
      content: ['node_modules', '.next', 'dist', '.turbo', '.env.local', '*.log', '.DS_Store'].join('\n') + '\n',
    });
  }
  if (!has('.env.local') && !has('.env')) {
    // Empty .env.local so dotenv loaders don't crash.
    fileMap.set('.env.local', { path: '.env.local', content: '# Local environment overrides\n' });
  }

  switch (stack) {
    case 'fullstack':
      ensureFullstackScaffold(fileMap);
      break;
    case 'nextjs':
      ensureNextScaffold(fileMap);
      break;
    case 'vite-react':
      ensureViteScaffold(fileMap);
      break;
    case 'plain-react':
      ensurePlainReactScaffold(fileMap);
      break;
    case 'node-express':
      ensureExpressScaffold(fileMap);
      break;
  }

  // Final pass: scan source for imports of npm packages that aren't already
  // listed and merge them in. The LLM frequently writes `import x from 'foo'`
  // for some `foo` that nobody put in package.json.
  mergeScannedDependencies(fileMap);

  // Final pass: prepend `"use client"` to App Router files that use React
  // hooks. The LLM forgets this directive ~half the time.
  if (stack === 'nextjs' || stack === 'fullstack') ensureUseClientDirectives(fileMap);
}

/* ── Next.js (app router) ───────────────────────────────────── */

function ensureNextScaffold(fileMap: Map<string, ProjectFile>): void {
  if (!fileMap.has('package.json')) {
    fileMap.set('package.json', {
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-app',
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'next dev',
          build: 'next build',
          start: 'next start',
          lint: 'next lint',
        },
        dependencies: {
          next: '^15.0.0',
          react: '^18.3.1',
          'react-dom': '^18.3.1',
          tailwindcss: '^3.4.0',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.47',
          'tailwindcss-animate': '^1.0.7',
          'class-variance-authority': '^0.7.0',
          clsx: '^2.1.1',
          'tailwind-merge': '^2.5.4',
          'lucide-react': '^0.469.0',
        },
        devDependencies: {
          '@types/node': '^22.10.0',
          '@types/react': '^18.3.0',
          '@types/react-dom': '^18.3.0',
          typescript: '^5.7.0',
          eslint: '^8.57.1',
          'eslint-config-next': '^15.0.0',
        },
      }, null, 2) + '\n',
    });
  }
  if (!fileMap.has('next.config.mjs') && !fileMap.has('next.config.js') && !fileMap.has('next.config.ts')) {
    fileMap.set('next.config.mjs', {
      path: 'next.config.mjs',
      content: [
        '/** @type {import("next").NextConfig} */',
        'const nextConfig = {',
        '  reactStrictMode: true,',
        '  // Allow the preview iframe (any origin) to embed the dev server.',
        '  async headers() {',
        '    return [{',
        '      source: "/:path*",',
        '      headers: [',
        '        { key: "X-Frame-Options",            value: "ALLOWALL" },',
        '        { key: "Content-Security-Policy",    value: "frame-ancestors *" },',
        '      ],',
        '    }];',
        '  },',
        '};',
        'export default nextConfig;',
      ].join('\n') + '\n',
    });
  }
  if (!fileMap.has('postcss.config.js') && !fileMap.has('postcss.config.mjs')) {
    fileMap.set('postcss.config.js', {
      path: 'postcss.config.js',
      content: 'module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n',
    });
  }
  if (!fileMap.has('tailwind.config.ts') && !fileMap.has('tailwind.config.js')) {
    fileMap.set('tailwind.config.ts', {
      path: 'tailwind.config.ts',
      content: [
        'import type { Config } from "tailwindcss";',
        'const config: Config = {',
        '  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}", "./app/**/*.{ts,tsx,js,jsx,mdx}"],',
        '  theme: { extend: {} },',
        '  plugins: [],',
        '};',
        'export default config;',
      ].join('\n') + '\n',
    });
  }
  if (!fileMap.has('next-env.d.ts')) {
    fileMap.set('next-env.d.ts', {
      path: 'next-env.d.ts',
      content: '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
    });
  }
  // Layout fallback so `next dev` doesn't 500 if the LLM forgot it.
  if (!fileMap.has('src/app/layout.tsx') && fileMap.has('src/app/page.tsx')) {
    fileMap.set('src/app/layout.tsx', {
      path: 'src/app/layout.tsx',
      content: [
        'import type { Metadata } from "next";',
        'import "./globals.css";',
        '',
        'export const metadata: Metadata = { title: "Preview", description: "Generated app" };',
        '',
        'export default function RootLayout({ children }: { children: React.ReactNode }) {',
        '  return (',
        '    <html lang="en">',
        '      <body>{children}</body>',
        '    </html>',
        '  );',
        '}',
      ].join('\n') + '\n',
    });
  }
  if (!fileMap.has('src/app/globals.css')) {
    fileMap.set('src/app/globals.css', {
      path: 'src/app/globals.css',
      content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
    });
  }
}

/* ── Vite + React ───────────────────────────────────────────── */

function ensureViteScaffold(fileMap: Map<string, ProjectFile>): void {
  if (!fileMap.has('package.json')) {
    fileMap.set('package.json', {
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-app',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'vite',
          build: 'tsc -b && vite build',
          preview: 'vite preview',
        },
        dependencies: {
          react: '^18.3.1',
          'react-dom': '^18.3.1',
          'lucide-react': '^0.469.0',
          clsx: '^2.1.1',
        },
        devDependencies: {
          '@types/react': '^18.3.0',
          '@types/react-dom': '^18.3.0',
          '@vitejs/plugin-react': '^4.3.0',
          typescript: '^5.7.0',
          vite: '^5.4.0',
          tailwindcss: '^3.4.0',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.47',
        },
      }, null, 2) + '\n',
    });
  }
  if (!fileMap.has('vite.config.ts') && !fileMap.has('vite.config.js') && !fileMap.has('vite.config.mjs')) {
    fileMap.set('vite.config.ts', {
      path: 'vite.config.ts',
      content: [
        'import { defineConfig } from "vite";',
        'import react from "@vitejs/plugin-react";',
        'export default defineConfig({',
        '  plugins: [react()],',
        '  server: { host: true, port: 5173 },',
        '});',
      ].join('\n') + '\n',
    });
  }
  if (!fileMap.has('index.html')) {
    fileMap.set('index.html', {
      path: 'index.html',
      content: [
        '<!doctype html>',
        '<html lang="en"><head>',
        '<meta charset="utf-8" />',
        '<meta name="viewport" content="width=device-width, initial-scale=1" />',
        '<title>Preview</title>',
        '</head><body>',
        '<div id="root"></div>',
        '<script type="module" src="/src/main.tsx"></script>',
        '</body></html>',
      ].join('\n') + '\n',
    });
  }
  if (!fileMap.has('src/main.tsx') && !fileMap.has('src/main.jsx')) {
    fileMap.set('src/main.tsx', {
      path: 'src/main.tsx',
      content: [
        'import { StrictMode } from "react";',
        'import { createRoot } from "react-dom/client";',
        'import App from "./App";',
        'import "./index.css";',
        '',
        'createRoot(document.getElementById("root")!).render(<StrictMode><App /></StrictMode>);',
      ].join('\n') + '\n',
    });
  }
  if (!fileMap.has('src/index.css')) {
    fileMap.set('src/index.css', {
      path: 'src/index.css',
      content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
    });
  }
  if (!fileMap.has('postcss.config.js')) {
    fileMap.set('postcss.config.js', {
      path: 'postcss.config.js',
      content: 'export default { plugins: { tailwindcss: {}, autoprefixer: {} } };\n',
    });
  }
  if (!fileMap.has('tailwind.config.ts') && !fileMap.has('tailwind.config.js')) {
    fileMap.set('tailwind.config.js', {
      path: 'tailwind.config.js',
      content: [
        '/** @type {import("tailwindcss").Config} */',
        'export default {',
        '  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],',
        '  theme: { extend: {} },',
        '  plugins: [],',
        '};',
      ].join('\n') + '\n',
    });
  }
}

/* ── Plain React (static index.html + npm serve) ───────────── */

function ensurePlainReactScaffold(fileMap: Map<string, ProjectFile>): void {
  // For plain React we don't need a build step — preview serves index.html
  // statically. Only ensure package.json so `npm install` succeeds.
  if (!fileMap.has('package.json')) {
    fileMap.set('package.json', {
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-app',
        version: '0.1.0',
        private: true,
        scripts: { start: 'npx serve -s . -l 8080' },
        dependencies: {},
      }, null, 2) + '\n',
    });
  }
}

/* ── Node API ───────────────────────────────────────────────── */

function ensureExpressScaffold(fileMap: Map<string, ProjectFile>): void {
  if (!fileMap.has('package.json')) {
    fileMap.set('package.json', {
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-api',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/server.ts',
          build: 'tsc',
          start: 'node dist/server.js',
        },
        dependencies: {
          express: '^4.21.0',
          cors: '^2.8.5',
          zod: '^3.24.0',
        },
        devDependencies: {
          '@types/express': '^5.0.0',
          '@types/node': '^22.10.0',
          tsx: '^4.19.0',
          typescript: '^5.7.0',
        },
      }, null, 2) + '\n',
    });
  }
}

/* ── Fullstack monorepo (Next.js + Fastify + Postgres + Prisma) ── */

function ensureFullstackScaffold(fileMap: Map<string, ProjectFile>): void {
  ensureFullstackWeb(fileMap);
  ensureFullstackApi(fileMap);
  ensureFullstackPrisma(fileMap);
  ensureFullstackDocker(fileMap);
  ensureFullstackRoot(fileMap);
}

/* apps/web — Next.js 15 (app router), Tailwind, talks to API via NEXT_PUBLIC_API_URL */
function ensureFullstackWeb(fileMap: Map<string, ProjectFile>): void {
  const has = (p: string): boolean => fileMap.has(p);
  const hasReactSource = [...fileMap.keys()].some((k) => k.startsWith('apps/web/') && /\.(tsx|jsx)$/i.test(k));

  if (!has('apps/web/package.json')) {
    fileMap.set('apps/web/package.json', {
      path: 'apps/web/package.json',
      content: JSON.stringify({
        name: 'web',
        version: '0.1.0',
        private: true,
        scripts: {
          dev: 'next dev -p 3000',
          build: 'next build',
          start: 'next start -p 3000',
          lint: 'next lint',
        },
        dependencies: {
          next: '^15.0.0',
          react: '^18.3.1',
          'react-dom': '^18.3.1',
          tailwindcss: '^3.4.0',
          autoprefixer: '^10.4.20',
          postcss: '^8.4.47',
          'tailwindcss-animate': '^1.0.7',
          'class-variance-authority': '^0.7.0',
          clsx: '^2.1.1',
          'tailwind-merge': '^2.5.4',
          'lucide-react': '^0.469.0',
        },
        devDependencies: {
          '@types/node': '^22.10.0',
          '@types/react': '^18.3.0',
          '@types/react-dom': '^18.3.0',
          typescript: '^5.7.0',
          eslint: '^8.57.1',
          'eslint-config-next': '^15.0.0',
        },
      }, null, 2) + '\n',
    });
  }
  if (!has('apps/web/next.config.mjs') && !has('apps/web/next.config.js') && !has('apps/web/next.config.ts')) {
    fileMap.set('apps/web/next.config.mjs', {
      path: 'apps/web/next.config.mjs',
      content: [
        '/** @type {import("next").NextConfig} */',
        'const nextConfig = {',
        '  reactStrictMode: true,',
        '  async headers() {',
        '    return [{',
        '      source: "/:path*",',
        '      headers: [',
        '        { key: "X-Frame-Options",         value: "ALLOWALL" },',
        '        { key: "Content-Security-Policy", value: "frame-ancestors *" },',
        '      ],',
        '    }];',
        '  },',
        '};',
        'export default nextConfig;',
      ].join('\n') + '\n',
    });
  }
  if (!has('apps/web/tsconfig.json')) {
    fileMap.set('apps/web/tsconfig.json', { path: 'apps/web/tsconfig.json', content: tsconfigFor('nextjs') });
  }
  if (!has('apps/web/postcss.config.js') && !has('apps/web/postcss.config.mjs')) {
    fileMap.set('apps/web/postcss.config.js', {
      path: 'apps/web/postcss.config.js',
      content: 'module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } };\n',
    });
  }
  if (!has('apps/web/tailwind.config.ts') && !has('apps/web/tailwind.config.js')) {
    fileMap.set('apps/web/tailwind.config.ts', {
      path: 'apps/web/tailwind.config.ts',
      content: [
        'import type { Config } from "tailwindcss";',
        'const config: Config = {',
        '  content: ["./src/**/*.{ts,tsx,js,jsx,mdx}", "./app/**/*.{ts,tsx,js,jsx,mdx}"],',
        '  theme: { extend: {} },',
        '  plugins: [],',
        '};',
        'export default config;',
      ].join('\n') + '\n',
    });
  }
  if (!has('apps/web/next-env.d.ts')) {
    fileMap.set('apps/web/next-env.d.ts', {
      path: 'apps/web/next-env.d.ts',
      content: '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n',
    });
  }
  // Layout fallback so `next dev` doesn't 500 if the LLM forgot it.
  const hasPage = has('apps/web/src/app/page.tsx') || has('apps/web/app/page.tsx');
  const hasLayout = has('apps/web/src/app/layout.tsx') || has('apps/web/app/layout.tsx');
  if (hasPage && !hasLayout) {
    const layoutPath = has('apps/web/app/page.tsx') ? 'apps/web/app/layout.tsx' : 'apps/web/src/app/layout.tsx';
    const cssImport = layoutPath.includes('/src/app/') ? './globals.css' : './globals.css';
    fileMap.set(layoutPath, {
      path: layoutPath,
      content: [
        'import type { Metadata } from "next";',
        `import "${cssImport}";`,
        '',
        'export const metadata: Metadata = { title: "Preview", description: "Generated app" };',
        '',
        'export default function RootLayout({ children }: { children: React.ReactNode }) {',
        '  return (<html lang="en"><body>{children}</body></html>);',
        '}',
      ].join('\n') + '\n',
    });
  }
  // globals.css fallback in either layout location.
  if (hasPage) {
    const cssPath = has('apps/web/app/page.tsx') ? 'apps/web/app/globals.css' : 'apps/web/src/app/globals.css';
    if (!has(cssPath)) {
      fileMap.set(cssPath, {
        path: cssPath,
        content: '@tailwind base;\n@tailwind components;\n@tailwind utilities;\n',
      });
    }
  }
  // API client — the sole network layer the BUILDER prompt mandates. If
  // missing, write a minimal one so frontend code that imports it doesn't
  // explode at runtime.
  if (hasReactSource && !has('apps/web/lib/api-client.ts') && !has('apps/web/src/lib/api-client.ts')) {
    const target = has('apps/web/src/app/page.tsx') ? 'apps/web/src/lib/api-client.ts' : 'apps/web/lib/api-client.ts';
    fileMap.set(target, {
      path: target,
      content: [
        '// Auto-injected fallback API client. Replace with project-specific',
        '// methods, but keep this file as the single network layer.',
        '',
        'const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";',
        '',
        'export async function apiFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {',
        '  const res = await fetch(`${BASE_URL}${path}`, {',
        '    ...init,',
        '    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },',
        '    cache: "no-store",',
        '  });',
        '  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);',
        '  return res.json() as Promise<T>;',
        '}',
      ].join('\n') + '\n',
    });
  }
  if (!has('apps/web/.env.example')) {
    fileMap.set('apps/web/.env.example', {
      path: 'apps/web/.env.example',
      content: 'NEXT_PUBLIC_API_URL=http://localhost:4000\n',
    });
  }
}

/* apps/api — Fastify + Prisma + zod */
function ensureFullstackApi(fileMap: Map<string, ProjectFile>): void {
  const has = (p: string): boolean => fileMap.has(p);

  if (!has('apps/api/package.json')) {
    fileMap.set('apps/api/package.json', {
      path: 'apps/api/package.json',
      content: JSON.stringify({
        name: 'api',
        version: '0.1.0',
        private: true,
        type: 'module',
        scripts: {
          dev: 'tsx watch src/server.ts',
          build: 'tsc',
          start: 'node dist/server.js',
          'prisma:generate': 'prisma generate',
          'prisma:migrate': 'prisma migrate deploy',
          'prisma:seed': 'tsx prisma/seed.ts',
        },
        prisma: { seed: 'tsx prisma/seed.ts' },
        dependencies: {
          fastify: '^5.1.0',
          '@fastify/cors': '^10.0.1',
          '@fastify/sensible': '^6.0.1',
          '@prisma/client': '^5.22.0',
          zod: '^3.24.0',
          pino: '^9.5.0',
          'pino-pretty': '^11.3.0',
        },
        devDependencies: {
          '@types/node': '^22.10.0',
          tsx: '^4.19.0',
          typescript: '^5.7.0',
          prisma: '^5.22.0',
        },
      }, null, 2) + '\n',
    });
  }
  if (!has('apps/api/tsconfig.json')) {
    fileMap.set('apps/api/tsconfig.json', {
      path: 'apps/api/tsconfig.json',
      content: JSON.stringify({
        compilerOptions: {
          target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
          esModuleInterop: true, strict: true, skipLibCheck: true,
          resolveJsonModule: true, outDir: 'dist', rootDir: 'src',
        },
        include: ['src/**/*'],
        exclude: ['node_modules', 'dist'],
      }, null, 2) + '\n',
    });
  }
  // server.ts fallback — boots Fastify with /health and CORS, mounts any
  // routes the LLM produced if a routes module exists.
  if (!has('apps/api/src/server.ts') && !has('apps/api/src/server.js')) {
    fileMap.set('apps/api/src/server.ts', {
      path: 'apps/api/src/server.ts',
      content: [
        'import Fastify from "fastify";',
        'import cors from "@fastify/cors";',
        'import { PrismaClient } from "@prisma/client";',
        '',
        'const prisma = new PrismaClient();',
        'const app = Fastify({ logger: true });',
        '',
        'await app.register(cors, { origin: true });',
        '',
        'app.get("/health", async () => {',
        '  try { await prisma.$queryRaw`SELECT 1`; return { ok: true, db: "up" }; }',
        '  catch { return { ok: true, db: "down" }; }',
        '});',
        '',
        'const port = Number(process.env.PORT ?? 4000);',
        'await app.listen({ port, host: "0.0.0.0" });',
      ].join('\n') + '\n',
    });
  }
  if (!has('apps/api/.env.example')) {
    fileMap.set('apps/api/.env.example', {
      path: 'apps/api/.env.example',
      content: [
        'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app?schema=public',
        'PORT=4000',
      ].join('\n') + '\n',
    });
  }
}

/* apps/api/prisma — schema + seed */
function ensureFullstackPrisma(fileMap: Map<string, ProjectFile>): void {
  const has = (p: string): boolean => fileMap.has(p);

  if (!has('apps/api/prisma/schema.prisma')) {
    fileMap.set('apps/api/prisma/schema.prisma', {
      path: 'apps/api/prisma/schema.prisma',
      content: [
        'generator client {',
        '  provider = "prisma-client-js"',
        '}',
        '',
        'datasource db {',
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        '}',
        '',
        '// Minimal placeholder model so `prisma migrate` produces a non-empty',
        '// migration. Replace/extend with real models per featureSlices.dbTables.',
        'model HealthCheck {',
        '  id        String   @id @default(cuid())',
        '  ok        Boolean  @default(true)',
        '  createdAt DateTime @default(now())',
        '}',
      ].join('\n') + '\n',
    });
  }
  if (!has('apps/api/prisma/seed.ts')) {
    fileMap.set('apps/api/prisma/seed.ts', {
      path: 'apps/api/prisma/seed.ts',
      content: [
        'import { PrismaClient } from "@prisma/client";',
        '',
        'const prisma = new PrismaClient();',
        '',
        'async function main() {',
        '  // Extend with seed data per featureSlices.',
        '  await prisma.healthCheck.upsert({',
        '    where: { id: "seed" },',
        '    update: {},',
        '    create: { id: "seed", ok: true },',
        '  }).catch(() => { /* model may have been replaced — ignore */ });',
        '}',
        '',
        'main().finally(() => prisma.$disconnect());',
      ].join('\n') + '\n',
    });
  }
}

/* Dockerfiles + docker-compose.yml */
function ensureFullstackDocker(fileMap: Map<string, ProjectFile>): void {
  const has = (p: string): boolean => fileMap.has(p);

  if (!has('apps/web/Dockerfile')) {
    fileMap.set('apps/web/Dockerfile', {
      path: 'apps/web/Dockerfile',
      content: [
        '# syntax=docker/dockerfile:1.6',
        'FROM node:20-alpine',
        'WORKDIR /app',
        'COPY package.json ./',
        'RUN npm install --no-audit --no-fund',
        'COPY . .',
        'EXPOSE 3000',
        'ENV PORT=3000',
        'ENV HOSTNAME=0.0.0.0',
        'CMD ["npm", "run", "dev"]',
      ].join('\n') + '\n',
    });
  }
  if (!has('apps/api/Dockerfile')) {
    fileMap.set('apps/api/Dockerfile', {
      path: 'apps/api/Dockerfile',
      content: [
        '# syntax=docker/dockerfile:1.6',
        'FROM node:20-alpine',
        'WORKDIR /app',
        'RUN apk add --no-cache openssl',
        'COPY package.json ./',
        'RUN npm install --no-audit --no-fund',
        'COPY . .',
        'RUN npx prisma generate',
        'EXPOSE 4000',
        'ENV PORT=4000',
        '# On boot: run pending migrations, then start the server.',
        'CMD sh -c "npx prisma migrate deploy && npm run dev"',
      ].join('\n') + '\n',
    });
  }
  if (!has('apps/web/.dockerignore')) {
    fileMap.set('apps/web/.dockerignore', {
      path: 'apps/web/.dockerignore',
      content: ['node_modules', '.next', 'dist', '.env', '.env.local', '*.log'].join('\n') + '\n',
    });
  }
  if (!has('apps/api/.dockerignore')) {
    fileMap.set('apps/api/.dockerignore', {
      path: 'apps/api/.dockerignore',
      content: ['node_modules', 'dist', '.env', '*.log'].join('\n') + '\n',
    });
  }
  if (!has('docker-compose.yml') && !has('docker-compose.yaml') && !has('compose.yml') && !has('compose.yaml')) {
    fileMap.set('docker-compose.yml', {
      path: 'docker-compose.yml',
      content: [
        'services:',
        '  postgres:',
        '    image: postgres:16-alpine',
        '    restart: unless-stopped',
        '    environment:',
        '      POSTGRES_USER: postgres',
        '      POSTGRES_PASSWORD: postgres',
        '      POSTGRES_DB: app',
        '    ports:',
        '      - "5432:5432"',
        '    healthcheck:',
        '      test: ["CMD-SHELL", "pg_isready -U postgres"]',
        '      interval: 3s',
        '      timeout: 3s',
        '      retries: 20',
        '    volumes:',
        '      - postgres_data:/var/lib/postgresql/data',
        '',
        '  api:',
        '    build: ./apps/api',
        '    restart: unless-stopped',
        '    environment:',
        '      DATABASE_URL: postgresql://postgres:postgres@postgres:5432/app?schema=public',
        '      PORT: "4000"',
        '    depends_on:',
        '      postgres:',
        '        condition: service_healthy',
        '    ports:',
        '      - "4000:4000"',
        '',
        '  web:',
        '    build: ./apps/web',
        '    restart: unless-stopped',
        '    environment:',
        '      NEXT_PUBLIC_API_URL: http://localhost:4000',
        '      PORT: "3000"',
        '    depends_on:',
        '      - api',
        '    ports:',
        '      - "3000:3000"',
        '',
        'volumes:',
        '  postgres_data:',
      ].join('\n') + '\n',
    });
  }
}

/* Root: package.json with concurrently dev script + README */
function ensureFullstackRoot(fileMap: Map<string, ProjectFile>): void {
  const has = (p: string): boolean => fileMap.has(p);

  if (!has('package.json')) {
    fileMap.set('package.json', {
      path: 'package.json',
      content: JSON.stringify({
        name: 'generated-fullstack-app',
        version: '0.1.0',
        private: true,
        workspaces: ['apps/*'],
        scripts: {
          dev: 'concurrently -k -n web,api -c blue,magenta "npm --workspace web run dev" "npm --workspace api run dev"',
          build: 'npm --workspace api run build && npm --workspace web run build',
          'docker:up': 'docker compose up --build',
          'docker:down': 'docker compose down -v',
        },
        devDependencies: {
          concurrently: '^9.1.0',
        },
      }, null, 2) + '\n',
    });
  }
  if (!has('.env.example')) {
    fileMap.set('.env.example', {
      path: '.env.example',
      content: [
        '# Root env example. Copy to .env if you need overrides.',
        'DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app?schema=public',
        'NEXT_PUBLIC_API_URL=http://localhost:4000',
      ].join('\n') + '\n',
    });
  }
  if (!has('README.md')) {
    fileMap.set('README.md', {
      path: 'README.md',
      content: [
        '# Generated Fullstack App',
        '',
        'Next.js (web) + Fastify (api) + PostgreSQL (Prisma).',
        '',
        '## Quickstart — Docker (recommended)',
        '',
        '```bash',
        'docker compose up --build',
        '```',
        '',
        '- Web:  http://localhost:3000',
        '- API:  http://localhost:4000/health',
        '- DB:   postgres://postgres:postgres@localhost:5432/app',
        '',
        'Migrations run automatically on api container start.',
        '',
        '## Quickstart — local dev',
        '',
        '```bash',
        'npm install',
        '# start postgres separately, e.g. via the compose file:',
        'docker compose up -d postgres',
        'npm --workspace api run prisma:migrate',
        'npm run dev   # runs web + api concurrently',
        '```',
        '',
      ].join('\n') + '\n',
    });
  }
}

/* ── tsconfig per stack ─────────────────────────────────────── */

function tsconfigFor(stack: ScaffoldStack): string {
  if (stack === 'nextjs') {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2020', lib: ['dom', 'dom.iterable', 'esnext'],
        allowJs: true, skipLibCheck: true, strict: true, noEmit: true,
        esModuleInterop: true, module: 'esnext', moduleResolution: 'bundler',
        resolveJsonModule: true, isolatedModules: true, jsx: 'preserve',
        incremental: true,
        plugins: [{ name: 'next' }],
        paths: { '@/*': ['./src/*'] },
      },
      include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
      exclude: ['node_modules'],
    }, null, 2) + '\n';
  }
  if (stack === 'vite-react') {
    return JSON.stringify({
      compilerOptions: {
        target: 'ES2020', useDefineForClassFields: true,
        lib: ['ES2020', 'DOM', 'DOM.Iterable'],
        module: 'ESNext', skipLibCheck: true,
        moduleResolution: 'bundler', allowImportingTsExtensions: true,
        isolatedModules: true, moduleDetection: 'force',
        noEmit: true, jsx: 'react-jsx',
        strict: true, noUnusedLocals: false, noUnusedParameters: false,
        noFallthroughCasesInSwitch: true,
        paths: { '@/*': ['./src/*'] },
      },
      include: ['src'],
    }, null, 2) + '\n';
  }
  // node-express / plain-react fallback
  return JSON.stringify({
    compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler',
      esModuleInterop: true, strict: true, skipLibCheck: true,
      resolveJsonModule: true, outDir: 'dist',
    },
    include: ['src/**/*'],
    exclude: ['node_modules', 'dist'],
  }, null, 2) + '\n';
}

/* ── Dependency scanner ─────────────────────────────────────── */

// Curated registry of npm packages the agents commonly emit, pinned to
// versions known to play well with React 18 + Next 15 / Vite 5. Anything
// not in this map is skipped (we never invent a version).
const PACKAGE_VERSIONS: Record<string, string> = {
  // tailwind ecosystem
  'tailwindcss-animate': '^1.0.7',
  '@tailwindcss/forms': '^0.5.9',
  '@tailwindcss/typography': '^0.5.15',
  // radix UI primitives
  '@radix-ui/react-accordion': '^1.2.1',
  '@radix-ui/react-alert-dialog': '^1.1.2',
  '@radix-ui/react-avatar': '^1.1.1',
  '@radix-ui/react-checkbox': '^1.1.2',
  '@radix-ui/react-dialog': '^1.1.2',
  '@radix-ui/react-dropdown-menu': '^2.1.2',
  '@radix-ui/react-label': '^2.1.0',
  '@radix-ui/react-popover': '^1.1.2',
  '@radix-ui/react-progress': '^1.1.0',
  '@radix-ui/react-scroll-area': '^1.2.0',
  '@radix-ui/react-select': '^2.1.2',
  '@radix-ui/react-separator': '^1.1.0',
  '@radix-ui/react-slot': '^1.1.0',
  '@radix-ui/react-switch': '^1.1.1',
  '@radix-ui/react-tabs': '^1.1.1',
  '@radix-ui/react-toast': '^1.2.2',
  '@radix-ui/react-tooltip': '^1.1.3',
  // utility libraries
  zod: '^3.24.0',
  'react-hook-form': '^7.53.0',
  '@hookform/resolvers': '^3.9.0',
  axios: '^1.7.7',
  swr: '^2.2.5',
  '@tanstack/react-query': '^5.59.0',
  date: '^2.0.0',
  'date-fns': '^4.1.0',
  dayjs: '^1.11.13',
  uuid: '^11.0.3',
  nanoid: '^5.0.7',
  'next-themes': '^0.4.3',
  sonner: '^1.7.0',
  'react-icons': '^5.4.0',
  recharts: '^2.13.3',
  framer: '^2.4.1',
  'framer-motion': '^11.11.17',
  // node/server-side
  cors: '^2.8.5',
  morgan: '^1.10.0',
  helmet: '^8.0.0',
  dotenv: '^16.4.5',
  bcryptjs: '^2.4.3',
  jsonwebtoken: '^9.0.2',
};

const TYPES_VERSIONS: Record<string, string> = {
  '@types/uuid': '^10.0.0',
  '@types/jsonwebtoken': '^9.0.7',
  '@types/bcryptjs': '^2.4.6',
  '@types/cors': '^2.8.17',
  '@types/morgan': '^1.9.9',
};

// Built-in / framework-provided modules we should never add to package.json.
const BUILTIN_MODULES = new Set([
  // Node builtins
  'fs', 'path', 'http', 'https', 'crypto', 'os', 'url', 'util', 'stream',
  'events', 'buffer', 'child_process', 'net', 'tls', 'zlib', 'querystring',
  'assert', 'process', 'cluster', 'dns', 'readline', 'worker_threads',
  // Always present after scaffold
  'react', 'react-dom', 'next', 'vite', '@vitejs/plugin-react',
  'tailwindcss', 'autoprefixer', 'postcss', 'typescript',
  'express', 'tsx', 'clsx', 'tailwind-merge', 'class-variance-authority',
  'lucide-react',
]);

function mergeScannedDependencies(fileMap: Map<string, ProjectFile>): void {
  // Find every package.json in the map. For a fullstack monorepo we have
  // multiple (root, apps/web, apps/api). Each is merged using imports from
  // files within its own subtree (root sees all; sub-packages see only their
  // own dir).
  const pkgPaths = [...fileMap.keys()].filter((k) => k === 'package.json' || k.endsWith('/package.json'));
  if (pkgPaths.length === 0) return;

  for (const pkgPath of pkgPaths) {
    const subtree = pkgPath === 'package.json' ? '' : pkgPath.slice(0, -'package.json'.length);
    mergeScannedDependenciesFor(fileMap, pkgPath, subtree);
  }
}

function mergeScannedDependenciesFor(
  fileMap: Map<string, ProjectFile>,
  pkgPath: string,
  subtree: string,
): void {
  const pkgFile = fileMap.get(pkgPath);
  if (!pkgFile) return;

  let pkg: any;
  try { pkg = JSON.parse(pkgFile.content); } catch { return; }
  pkg.dependencies = pkg.dependencies || {};
  pkg.devDependencies = pkg.devDependencies || {};

  // Scan source-like files within this subtree for imports/requires.
  const importRe = /(?:^|[\s;])(?:import\s+(?:[\w*\s{},]+from\s+)?|require\s*\()['"]([^'"]+)['"]/g;
  const referenced = new Set<string>();

  for (const [path, file] of fileMap) {
    if (subtree && !path.startsWith(subtree)) continue;
    if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/i.test(path)) continue;
    if (path.startsWith('node_modules/')) continue;
    // For the root package.json in a monorepo, skip files under apps/* —
    // those belong to per-app package.json files.
    if (!subtree && (path.startsWith('apps/') || path.startsWith('packages/'))) continue;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(file.content)) !== null) {
      const spec = m[1];
      if (!spec || spec.startsWith('.') || spec.startsWith('/')) continue;
      if (spec.startsWith('@/') || spec.startsWith('~/')) continue;
      // Reduce subpath imports to the package name.
      const pkgName = spec.startsWith('@')
        ? spec.split('/').slice(0, 2).join('/')
        : spec.split('/')[0];
      if (!pkgName || BUILTIN_MODULES.has(pkgName)) continue;
      if (pkgName.startsWith('node:')) continue;
      referenced.add(pkgName);
    }
  }

  for (const name of referenced) {
    if (pkg.dependencies[name] || pkg.devDependencies[name]) continue;
    const ver = PACKAGE_VERSIONS[name];
    if (ver) pkg.dependencies[name] = ver;
    // Quietly skip unknown packages — we'd rather have install succeed with
    // a missing dep than fail with a fabricated version. The caller can
    // surface this via build logs if it matters.
  }

  // Add @types/* devDeps when the matching runtime dep is now present.
  for (const [typesPkg, typesVer] of Object.entries(TYPES_VERSIONS)) {
    const runtimeName = typesPkg.replace('@types/', '');
    if (pkg.dependencies[runtimeName] && !pkg.devDependencies[typesPkg]) {
      pkg.devDependencies[typesPkg] = typesVer;
    }
  }

  fileMap.set(pkgPath, { path: pkgPath, content: JSON.stringify(pkg, null, 2) + '\n' });
}

/* ── "use client" auto-fix ──────────────────────────────────── */

const CLIENT_HOOKS_RE = /\b(useState|useEffect|useLayoutEffect|useReducer|useCallback|useMemo|useRef|useContext|useImperativeHandle|useSyncExternalStore|useTransition|useDeferredValue|useId|useOptimistic|useFormState|useFormStatus)\b/;
const EVENT_HANDLER_RE = /\bon(?:Click|Change|Submit|Input|KeyDown|KeyUp|MouseEnter|MouseLeave|Focus|Blur)\s*=/;
const HAS_USE_CLIENT_RE = /^\s*(?:["']use client["'];?\s*\n)/;

function ensureUseClientDirectives(fileMap: Map<string, ProjectFile>): void {
  for (const [path, file] of fileMap) {
    if (!/\.(tsx|jsx)$/i.test(path)) continue;
    // Layout components must remain server components by default.
    if (/(?:^|\/)layout\.(tsx|jsx)$/i.test(path)) continue;
    // API routes / server actions stay server-side.
    if (/(?:^|\/)route\.(ts|tsx|js|jsx)$/i.test(path)) continue;
    if (HAS_USE_CLIENT_RE.test(file.content)) continue;

    const needsClient = CLIENT_HOOKS_RE.test(file.content) || EVENT_HANDLER_RE.test(file.content);
    if (!needsClient) continue;

    fileMap.set(path, { path, content: `'use client';\n\n${file.content}` });
  }
}
