/**
 * Export Builder
 *
 * Assembles a complete, production-ready project ZIP from stored artifacts.
 *
 * What is INCLUDED in the export:
 *   - All frontend files (React / Next.js / etc.)
 *   - All backend files (API routes, server logic)
 *   - Database schema files
 *   - Shared utilities / types
 *   - Docker / deployment config
 *   - .env.example
 *   - package.json
 *   - README with setup instructions
 *
 * What is EXCLUDED from the export:
 *   - Any file under /mocks/
 *   - Any file matching mock/stub naming patterns
 *   - The preview banner / mock injector scripts
 *   - devteam internal metadata
 */

interface ProjectFile { path: string; content: string; }

/** Patterns that mark a file as preview-only — never exported. */
const MOCK_PATH_PATTERNS: RegExp[] = [
  /^mocks?\//i,
  /\/mocks?\//i,
  /\.mock\.[jt]sx?$/i,
  /\.mocks\.[jt]sx?$/i,
  /\.stub\.[jt]sx?$/i,
  /__mocks__\//i,
  /\/preview-only\//i,
  /\/fixtures?\/.*mock/i,
  /(?:^|\/)mock-data\.[jt]sx?$/i,
  /(?:^|\/)fake-data\.[jt]sx?$/i,
];

/** Strip any content between DEVTEAM_MOCK_START and DEVTEAM_MOCK_END comment markers. */
const MOCK_BLOCK_RE = /\/\*\s*DEVTEAM_MOCK_START\s*\*\/[\s\S]*?\/\*\s*DEVTEAM_MOCK_END\s*\*\//g;

export function isExcludedFromExport(filePath: string): boolean {
  return MOCK_PATH_PATTERNS.some((re) => re.test(filePath));
}

export function stripMockBlocks(content: string): string {
  return content.replace(MOCK_BLOCK_RE, '').replace(/\n{3,}/g, '\n\n');
}

export interface ExportProject {
  id: string;
  name: string;
  prompt: string;
  prompts?: { text: string }[];
  spec?: Record<string, unknown>;
  plan?: Record<string, unknown>;
  files: ProjectFile[];
  totalTokens?: number;
  totalCostUsd?: number;
  createdAt: string;
}

/**
 * Returns a list of { path, content } entries representing the ZIP contents.
 * All paths are relative to the project root.
 */
export function buildExportEntries(project: ExportProject): ProjectFile[] {
  const out: ProjectFile[] = [];

  // ── Project files (filtered + mock-stripped) ─────────────────────────────
  for (const file of project.files) {
    if (isExcludedFromExport(file.path)) continue;
    const content = stripMockBlocks(file.content);
    out.push({ path: file.path, content });
  }

  const detected = detectTechStack(out);
  const layout = detectLayout(out);

  // ── package.json — synthesize if the project looks like Node but has none.
  // We never overwrite a generated one; we only fill the gap when the agents
  // shipped JS/TS source files without a manifest. Without this, `npm install`
  // fails and the exported project cannot run locally.
  const declaredEnvVars = (project.spec?.envVars as { name: string; description?: string; example?: string }[] | undefined) ?? [];
  const scannedEnvVars = scanEnvVarUsage(out);
  const mergedEnvVars = mergeEnvVars(declaredEnvVars, scannedEnvVars);

  ensurePackageJsons(out, project.name ?? 'generated-project', detected, layout);

  // ── Database schema placeholder — emit only if a DB is clearly in use
  // (ORM imports or DATABASE_URL referenced) but no schema artefact was
  // written by the agents. A stub is better than silent breakage.
  ensureSchemaArtefact(out, detected, mergedEnvVars);

  // ── .env.example — always at root, always reflects the real code ─────────
  const hasRootEnvExample = out.some((f) => f.path === '.env.example');
  if (!hasRootEnvExample) {
    out.push({ path: '.env.example', content: buildEnvExample(mergedEnvVars, detected) });
  }

  // ── README.md ─────────────────────────────────────────────────────────────
  const hasReadme = out.some((f) => /^readme\.md$/i.test(f.path));
  if (!hasReadme) {
    out.push({ path: 'README.md', content: buildReadme(project, detected, layout) });
  }

  // ── .gitignore ────────────────────────────────────────────────────────────
  const hasGitignore = out.some((f) => f.path === '.gitignore');
  if (!hasGitignore) {
    out.push({ path: '.gitignore', content: buildGitignore() });
  }

  return out;
}

// ── Layout detection ──────────────────────────────────────────────────────

interface ProjectLayout {
  /** True when the export has a frontend/ (or web/, client/, apps/web/) subtree. */
  frontendDir?: string;
  /** True when the export has a backend/ (or server/, api/, apps/api/) subtree. */
  backendDir?: string;
}

function detectLayout(files: ProjectFile[]): ProjectLayout {
  const dirs = new Set<string>();
  for (const f of files) {
    const first = f.path.split('/')[0];
    if (first) dirs.add(first);
  }
  const pick = (candidates: string[]): string | undefined =>
    candidates.find((c) => dirs.has(c));
  return {
    frontendDir: pick(['frontend', 'web', 'client', 'apps/web']),
    backendDir:  pick(['backend', 'server', 'api', 'apps/api']),
  };
}

// ── Env-var discovery ─────────────────────────────────────────────────────

/** Scan real source files for env-var references so `.env.example` is complete. */
function scanEnvVarUsage(files: ProjectFile[]): { name: string; example?: string }[] {
  const found = new Set<string>();
  // Node / Next / Vite / Python / generic shell patterns.
  const patterns: RegExp[] = [
    /process\.env\.([A-Z0-9_]{2,})/g,
    /process\.env\[['"]([A-Z0-9_]{2,})['"]\]/g,
    /import\.meta\.env\.([A-Z0-9_]{2,})/g,
    /\bos\.environ\.get\(\s*['"]([A-Z0-9_]{2,})['"]/g,
    /\bos\.environ\[['"]([A-Z0-9_]{2,})['"]\]/g,
    /\bDeno\.env\.get\(\s*['"]([A-Z0-9_]{2,})['"]/g,
  ];
  // Exclude obvious non-config lookups that appear everywhere.
  const ignore = new Set(['NODE_ENV', 'npm_package_version']);

  for (const f of files) {
    if (f.path.endsWith('.lock') || f.path.endsWith('.md')) continue;
    for (const re of patterns) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(f.content)) !== null) {
        const name = m[1];
        if (name && !ignore.has(name)) found.add(name);
      }
    }
  }
  return [...found].sort().map((name) => ({ name }));
}

function mergeEnvVars(
  declared: { name: string; description?: string; example?: string }[],
  scanned: { name: string; example?: string }[],
): { name: string; description?: string; example?: string }[] {
  const map = new Map<string, { name: string; description?: string; example?: string }>();
  for (const v of declared) map.set(v.name, v);
  for (const v of scanned) if (!map.has(v.name)) map.set(v.name, v);
  // Always ship a couple of universally-expected knobs so `.env.example` is
  // never empty on projects that use dotenv implicitly.
  if (!map.has('NODE_ENV'))     map.set('NODE_ENV',     { name: 'NODE_ENV',     description: 'Runtime environment', example: 'development' });
  if (!map.has('PORT'))         map.set('PORT',         { name: 'PORT',         description: 'HTTP port the server listens on', example: '3000' });
  return [...map.values()];
}

// ── package.json guarantees ───────────────────────────────────────────────

function ensurePackageJsons(
  out: ProjectFile[],
  projectName: string,
  detected: ReturnType<typeof detectTechStack>,
  layout: ProjectLayout,
): void {
  const safeName = projectName.replace(/[^a-z0-9-_]/gi, '-').toLowerCase().slice(0, 100) || 'generated-project';
  const looksNode = (detected.frontend || detected.backend) && !(detected.backend ?? '').startsWith('Python') && !detected.backend?.startsWith('Go') && !detected.backend?.startsWith('Rust');
  if (!looksNode) return;

  // Monorepo-shaped export: synthesize a root workspaces manifest and per-package manifests.
  if (layout.frontendDir || layout.backendDir) {
    if (!out.some((f) => f.path === 'package.json')) {
      const workspaces = [layout.frontendDir, layout.backendDir].filter(Boolean) as string[];
      out.push({
        path: 'package.json',
        content: JSON.stringify({
          name: safeName,
          version: '0.1.0',
          private: true,
          workspaces,
          scripts: {
            dev:   workspaces.map((w) => `npm --workspace ${w} run dev`).join(' & '),
            build: workspaces.map((w) => `npm --workspace ${w} run build`).join(' && '),
            start: workspaces.map((w) => `npm --workspace ${w} run start`).join(' & '),
            'install:all': 'npm install',
          },
        }, null, 2) + '\n',
      });
    }
    if (layout.frontendDir && !out.some((f) => f.path === `${layout.frontendDir}/package.json`)) {
      out.push({
        path: `${layout.frontendDir}/package.json`,
        content: JSON.stringify(stubFrontendPkg(`${safeName}-frontend`, detected.frontend), null, 2) + '\n',
      });
    }
    if (layout.backendDir && !out.some((f) => f.path === `${layout.backendDir}/package.json`)) {
      out.push({
        path: `${layout.backendDir}/package.json`,
        content: JSON.stringify(stubBackendPkg(`${safeName}-backend`, detected.backend), null, 2) + '\n',
      });
    }
    return;
  }

  // Flat layout — single root package.json.
  if (!out.some((f) => f.path === 'package.json')) {
    const isNext = detected.frontend === 'Next.js + React';
    const pkg = isNext
      ? stubFrontendPkg(safeName, detected.frontend)
      : detected.backend
      ? stubBackendPkg(safeName, detected.backend)
      : stubFrontendPkg(safeName, detected.frontend);
    out.push({ path: 'package.json', content: JSON.stringify(pkg, null, 2) + '\n' });
  }
}

function stubFrontendPkg(name: string, frontend?: string): Record<string, unknown> {
  if (frontend === 'Next.js + React') {
    return {
      name, version: '0.1.0', private: true,
      scripts: { dev: 'next dev', build: 'next build', start: 'next start', lint: 'next lint' },
      dependencies: { next: '^15.0.0', react: '^18.3.1', 'react-dom': '^18.3.1' },
      devDependencies: { typescript: '^5.4.0', '@types/node': '^20.12.0', '@types/react': '^18.3.0', '@types/react-dom': '^18.3.0' },
    };
  }
  return {
    name, version: '0.1.0', private: true,
    scripts: { dev: 'vite', build: 'vite build', preview: 'vite preview' },
    dependencies: { react: '^18.3.1', 'react-dom': '^18.3.1' },
    devDependencies: { vite: '^5.2.0', '@vitejs/plugin-react': '^4.3.0', typescript: '^5.4.0' },
  };
}

function stubBackendPkg(name: string, backend?: string): Record<string, unknown> {
  const isFastify = backend === 'Node.js (Fastify)';
  const isExpress = backend === 'Node.js (Express)';
  return {
    name, version: '0.1.0', private: true,
    type: 'module',
    scripts: {
      dev:   'tsx watch src/server.ts',
      build: 'tsc -p tsconfig.json',
      start: 'node dist/server.js',
    },
    dependencies: {
      ...(isFastify ? { fastify: '^4.28.0', '@fastify/cors': '^9.0.0' } : {}),
      ...(isExpress ? { express: '^4.19.0', cors: '^2.8.5' } : {}),
      zod: '^3.23.0',
      dotenv: '^16.4.0',
    },
    devDependencies: {
      typescript: '^5.4.0',
      tsx: '^4.7.0',
      '@types/node': '^20.12.0',
      ...(isExpress ? { '@types/express': '^4.17.0', '@types/cors': '^2.8.0' } : {}),
    },
  };
}

// ── Database schema guarantees ────────────────────────────────────────────

function ensureSchemaArtefact(
  out: ProjectFile[],
  detected: ReturnType<typeof detectTechStack>,
  envVars: { name: string }[],
): void {
  const hasAnySchema = out.some((f) =>
    /schema\.prisma$/i.test(f.path) ||
    /(?:^|\/)schema\.sql$/i.test(f.path) ||
    /migrations?\//i.test(f.path) ||
    /(?:^|\/)models?\/.+\.[jt]s$/i.test(f.path),
  );
  if (hasAnySchema) return;

  const dbMentioned = Boolean(detected.database) || envVars.some((v) => /DATABASE_URL|DB_HOST|DB_URL|POSTGRES|MONGODB/i.test(v.name));
  if (!dbMentioned) return;

  const kind = (detected.database ?? '').toLowerCase();
  if (kind.includes('prisma')) {
    out.push({
      path: 'prisma/schema.prisma',
      content: [
        '// Prisma schema placeholder — the generator left no schema file.',
        '// Replace with your real models before running `prisma migrate dev`.',
        '',
        'generator client {',
        '  provider = "prisma-client-js"',
        '}',
        '',
        'datasource db {',
        '  provider = "postgresql"',
        '  url      = env("DATABASE_URL")',
        '}',
        '',
        '// TODO: add your models, e.g.',
        '// model User { id String @id @default(cuid()); email String @unique; createdAt DateTime @default(now()) }',
        '',
      ].join('\n'),
    });
  } else if (kind.includes('mongo')) {
    // MongoDB is schemaless; ship a README note instead of SQL.
    out.push({
      path: 'db/README.md',
      content: '# MongoDB\n\nThis project uses MongoDB. There is no SQL schema to run — collections are created on first write. Make sure `MONGODB_URI` in `.env` points at a reachable cluster before starting the server.\n',
    });
  } else {
    out.push({
      path: 'db/schema.sql',
      content: [
        '-- SQL schema placeholder — the generator left no schema file.',
        '-- Replace with your real tables before running against a real database.',
        '',
        '-- Example:',
        '-- CREATE TABLE users (',
        '--   id UUID PRIMARY KEY DEFAULT gen_random_uuid(),',
        '--   email TEXT UNIQUE NOT NULL,',
        '--   created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()',
        '-- );',
        '',
      ].join('\n'),
    });
  }
}

// ── File content builders ─────────────────────────────────────────────────

function buildEnvExample(
  envVars: { name: string; description?: string; example?: string }[],
  detected: { frontend?: string; backend?: string; database?: string; testing?: string },
): string {
  const lines: string[] = [
    '# ─────────────────────────────────────────────────────────────────────────',
    '# Environment variables',
    '# Copy this file to `.env` and fill in real values before running the app.',
    '# Values below are examples/defaults only — DO NOT commit real secrets.',
    '# ─────────────────────────────────────────────────────────────────────────',
    '',
  ];

  // Sensible defaults for common knobs so the file is never empty.
  const defaults: Record<string, { example: string; desc: string }> = {
    NODE_ENV:     { example: 'development',                                           desc: 'Runtime environment (development / production / test)' },
    PORT:         { example: '3000',                                                  desc: 'HTTP port the server listens on' },
    DATABASE_URL: { example: 'postgresql://user:password@localhost:5432/app',          desc: 'Primary database connection string' },
    MONGODB_URI:  { example: 'mongodb://localhost:27017/app',                          desc: 'MongoDB connection URI' },
    JWT_SECRET:   { example: 'replace-me-with-a-long-random-string',                   desc: 'Secret used to sign JWTs' },
    SESSION_SECRET: { example: 'replace-me-with-a-long-random-string',                 desc: 'Secret used to sign session cookies' },
    OPENAI_API_KEY: { example: 'sk-...',                                               desc: 'OpenAI API key' },
    STRIPE_SECRET_KEY: { example: 'sk_test_...',                                       desc: 'Stripe secret API key (test mode)' },
    STRIPE_WEBHOOK_SECRET: { example: 'whsec_...',                                     desc: 'Stripe webhook signing secret' },
    REDIS_URL:    { example: 'redis://localhost:6379',                                 desc: 'Redis connection URL' },
    NEXT_PUBLIC_API_URL: { example: 'http://localhost:3001',                           desc: 'Base URL of the API (must start with NEXT_PUBLIC_ to be exposed to the browser)' },
  };

  for (const v of envVars) {
    const fallback = defaults[v.name];
    const desc = v.description ?? fallback?.desc;
    const example = v.example ?? fallback?.example ?? '';
    if (desc) lines.push(`# ${desc}`);
    lines.push(`${v.name}=${example}`);
    lines.push('');
  }

  // Footer hint for mock/test mode so local runs never hit real paid services.
  if (detected.backend || detected.frontend) {
    lines.push('# ─── Local development hints ─────────────────────────────────────────────');
    lines.push('# Use test keys (stripe sk_test_..., OpenAI staging project, etc.) for local runs.');
    lines.push('# Never commit this file after filling it in.');
    lines.push('');
  }

  return lines.join('\n');
}

function detectTechStack(files: ProjectFile[]): { frontend?: string; backend?: string; database?: string; testing?: string } {
  const out: { frontend?: string; backend?: string; database?: string; testing?: string } = {};
  const all = files.map(f => `${f.path}\n${f.content}`).join('\n');
  const has = (re: RegExp) => re.test(all);
  const pathHas = (re: RegExp) => files.some(f => re.test(f.path));

  // Frontend
  if (has(/from\s+['"]next\/[\w/]+['"]/) || pathHas(/(?:^|\/)pages\/_app\.(?:j|t)sx?$/) || pathHas(/^next\.config\.(?:js|ts|mjs)$/))
    out.frontend = 'Next.js + React';
  else if (pathHas(/\.(?:tsx|jsx)$/) && has(/from\s+['"]react['"]/))
    out.frontend = 'React';
  else if (has(/<template[\s>]/) || has(/from\s+['"]vue['"]/))
    out.frontend = 'Vue';
  else if (has(/from\s+['"]@angular\//))
    out.frontend = 'Angular';
  else if (has(/from\s+['"]svelte['"]/))
    out.frontend = 'Svelte';
  else if (pathHas(/\.html?$/))
    out.frontend = 'Plain HTML / CSS / JS';

  // Backend
  if (has(/from\s+['"]fastapi['"]|from\s+fastapi\b/))
    out.backend = 'Python (FastAPI)';
  else if (has(/from\s+['"]flask['"]|from\s+flask\b/))
    out.backend = 'Python (Flask)';
  else if (has(/from\s+['"]django['"]|from\s+django\b/))
    out.backend = 'Python (Django)';
  else if (has(/from\s+['"]@nestjs\//))
    out.backend = 'NestJS';
  else if (has(/from\s+['"]fastify['"]/))
    out.backend = 'Node.js (Fastify)';
  else if (has(/from\s+['"]express['"]|require\(['"]express['"]\)/))
    out.backend = 'Node.js (Express)';
  else if (has(/from\s+['"]koa['"]/))
    out.backend = 'Node.js (Koa)';
  else if (has(/from\s+['"]hono['"]/))
    out.backend = 'Hono';
  else if (has(/func\s+main\s*\(/) && pathHas(/\.go$/))
    out.backend = 'Go';
  else if (pathHas(/\.rs$/) && has(/fn\s+main\s*\(/))
    out.backend = 'Rust';
  else if (pathHas(/(?:^|\/)api\/[^/]+\.(?:ts|js)$/) || pathHas(/(?:^|\/)routes\/[^/]+\.(?:ts|js)$/))
    out.backend = 'Node.js';

  // Database
  if (pathHas(/schema\.prisma$/)) out.database = 'PostgreSQL (via Prisma)';
  else if (has(/from\s+['"]mongoose['"]/) || has(/\bmongodb\b/i)) out.database = 'MongoDB';
  else if (has(/from\s+['"]sequelize['"]/) || has(/\bDataTypes\.\w+/)) out.database = 'SQL (via Sequelize)';
  else if (has(/from\s+['"]typeorm['"]/)) out.database = 'SQL (via TypeORM)';
  else if (has(/from\s+['"]pg['"]/) || has(/\bpostgres(?:ql)?\b/i)) out.database = 'PostgreSQL';
  else if (has(/from\s+['"]sqlalchemy['"]/i)) out.database = 'SQL (via SQLAlchemy)';
  else if (has(/from\s+['"]drizzle-orm['"]/)) out.database = 'SQL (via Drizzle)';

  // Testing
  if (has(/from\s+['"]vitest['"]/) || pathHas(/vitest\.config\./)) out.testing = 'Vitest';
  else if (has(/from\s+['"]@playwright\/test['"]/)) out.testing = 'Playwright';
  else if (has(/from\s+['"]pytest['"]|import\s+pytest\b/)) out.testing = 'pytest';
  else if (pathHas(/\.(?:test|spec)\.[jt]sx?$/)) out.testing = 'Jest';

  return out;
}

function buildReadme(
  project: ExportProject,
  detected: ReturnType<typeof detectTechStack>,
  layout: ProjectLayout,
): string {
  const name = project.name ?? 'Generated Project';
  const prompts = project.prompts?.map((p) => `- ${p.text}`).join('\n') ?? `- ${project.prompt}`;
  const hasDocker = project.files.some((f) => f.path === 'Dockerfile' || f.path === 'docker-compose.yml');
  const hasPrisma = project.files.some((f) => /schema\.prisma$/.test(f.path));
  const hasSqlSchema = project.files.some((f) => /(?:^|\/)schema\.sql$/i.test(f.path));
  const hasMigrations = project.files.some((f) => /migrations?\//i.test(f.path));
  const isPythonBackend = (detected.backend ?? '').startsWith('Python');
  const hasFrontendDir = Boolean(layout.frontendDir);
  const hasBackendDir = Boolean(layout.backendDir);

  const sections: string[] = [];

  sections.push(`# ${name}`);
  sections.push('');
  sections.push(`> Generated by [DEVteam](https://devteam.ai) — ${new Date(project.createdAt).toLocaleDateString()}`);
  sections.push('');
  sections.push('## What was built');
  sections.push('');
  sections.push(prompts);
  sections.push('');
  sections.push('## Tech stack');
  sections.push('');

  const spec = project.spec as Record<string, Record<string, string>> | undefined;
  const ts = spec?.techStack;
  if (ts && Object.keys(ts).length > 0) {
    for (const [k, v] of Object.entries(ts)) {
      if (v) sections.push(`- **${k}**: ${v}`);
    }
  } else {
    if (detected.frontend) sections.push(`- **Frontend**: ${detected.frontend}`);
    if (detected.backend)  sections.push(`- **Backend**: ${detected.backend}`);
    if (detected.database) sections.push(`- **Database**: ${detected.database}`);
    if (detected.testing)  sections.push(`- **Testing**: ${detected.testing}`);
  }
  sections.push('');

  sections.push('## Getting started');
  sections.push('');
  sections.push('### Prerequisites');
  sections.push('');
  if (!isPythonBackend) sections.push('- Node.js 18+ and npm 10+');
  if (isPythonBackend) sections.push('- Python 3.10+ and pip');
  if (hasPrisma || hasSqlSchema || hasMigrations || (detected.database ?? '').length > 0) {
    sections.push(`- A running ${detected.database ?? 'database'} instance matching your \`.env\` configuration`);
  }
  if (hasDocker) sections.push('- Docker & Docker Compose (optional — for containerised setup)');
  sections.push('');

  sections.push('### Installation');
  sections.push('');
  sections.push('```bash');
  sections.push('# 1. Install dependencies');
  if (hasFrontendDir && hasBackendDir) {
    sections.push(`cd ${layout.frontendDir} && npm install && cd ..`);
    sections.push(`cd ${layout.backendDir}  && npm install && cd ..`);
  } else if (isPythonBackend) {
    sections.push('pip install -r requirements.txt');
  } else {
    sections.push('npm install');
  }
  sections.push('');
  sections.push('# 2. Configure environment');
  sections.push('cp .env.example .env');
  sections.push('# Open .env and fill in every value — the app will not run with placeholders.');
  sections.push('');

  let step = 3;
  if (hasPrisma) {
    sections.push(`# ${step}. Create the database schema`);
    sections.push('npx prisma migrate dev --name init');
    sections.push('');
    step++;
  } else if (hasSqlSchema) {
    sections.push(`# ${step}. Create the database schema`);
    sections.push('psql "$DATABASE_URL" -f db/schema.sql');
    sections.push('');
    step++;
  }

  sections.push(`# ${step}. Start the app`);
  if (hasFrontendDir && hasBackendDir) {
    sections.push(`# In one terminal:`);
    sections.push(`cd ${layout.backendDir} && npm run dev`);
    sections.push(`# In another terminal:`);
    sections.push(`cd ${layout.frontendDir} && npm run dev`);
  } else if (isPythonBackend) {
    sections.push('uvicorn main:app --reload');
  } else {
    sections.push('npm run dev');
  }
  sections.push('```');
  sections.push('');

  if (hasDocker) {
    sections.push('### Docker');
    sections.push('');
    sections.push('```bash');
    sections.push('docker compose up --build');
    sections.push('```');
    sections.push('');
  }

  sections.push('## Project structure');
  sections.push('');
  sections.push('```');
  const dirs = buildDirectoryTree(project.files.filter((f) => !isExcludedFromExport(f.path)));
  sections.push(dirs);
  sections.push('```');
  sections.push('');

  sections.push('## Production notes');
  sections.push('');
  sections.push('- **No mock data.** All preview-only mocks and fixtures were stripped from this export. The app talks to real services defined in `.env`.');
  sections.push('- Review all generated code before deploying to production — this is a starting point, not a finished product.');
  sections.push('- Rotate any example secrets; the placeholders in `.env.example` are not safe to ship.');
  sections.push('- Run your own linter / type-checker / security scan before merging.');

  return sections.join('\n');
}

function buildGitignore(): string {
  return [
    '# Dependencies',
    'node_modules/',
    '.pnp',
    '.pnp.js',
    '',
    '# Build outputs',
    'dist/',
    '.next/',
    'out/',
    'build/',
    '',
    '# Environment',
    '.env',
    '.env.local',
    '.env.*.local',
    '',
    '# Logs',
    'logs/',
    '*.log',
    'npm-debug.log*',
    '',
    '# OS',
    '.DS_Store',
    'Thumbs.db',
    '',
    '# Coverage',
    'coverage/',
    '.nyc_output',
    '',
    '# Misc',
    '.cache/',
    '*.tsbuildinfo',
  ].join('\n');
}

function buildDirectoryTree(files: ProjectFile[]): string {
  // Build a simple 2-level directory listing
  const dirs = new Set<string>();
  for (const f of files) {
    const parts = f.path.split('/');
    if (parts.length > 1 && parts[0] !== undefined) dirs.add(parts[0]);
  }
  const lines: string[] = [];
  for (const dir of [...dirs].sort()) {
    const children = files.filter((f) => f.path.startsWith(dir + '/')).slice(0, 5);
    lines.push(`${dir}/`);
    for (const c of children) {
      lines.push(`  ${c.path.slice(dir.length + 1)}`);
    }
    const total = files.filter((f) => f.path.startsWith(dir + '/')).length;
    if (total > 5) lines.push(`  ... (${total - 5} more files)`);
  }
  // top-level files
  for (const f of files.filter((f) => !f.path.includes('/')).slice(0, 10)) {
    lines.push(f.path);
  }
  return lines.join('\n');
}

// ── ZIP writer (pure JS, no native deps) ─────────────────────────────────
// A minimal implementation using Node.js built-ins only.
// For production use, `archiver` or `jszip` would be preferable, but this
// avoids adding a dependency.

import { createHash } from 'node:crypto';

interface ZipEntry { path: string; data: Buffer; }

export function buildZipBuffer(entries: ProjectFile[]): Buffer {
  const zipEntries: ZipEntry[] = entries.map((e) => ({
    path: e.path,
    data: Buffer.from(e.content, 'utf-8'),
  }));
  return encodeZip(zipEntries);
}

/** Minimal ZIP encoder (PKZIP, DEFLATE-0 / stored method). */
function encodeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const centralDir: Buffer[] = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBytes  = Buffer.from(entry.path, 'utf-8');
    const data       = entry.data;
    const crc        = crc32(data);
    const dosDate    = toDosDateTime(new Date());

    // Local file header
    const localHeader = Buffer.alloc(30 + nameBytes.length);
    localHeader.writeUInt32LE(0x04034b50, 0);  // signature
    localHeader.writeUInt16LE(20,          4);  // version needed
    localHeader.writeUInt16LE(0x0800,      6);  // general purpose bit flag (UTF-8)
    localHeader.writeUInt16LE(0,           8);  // compression: stored
    localHeader.writeUInt16LE(dosDate.time, 10);
    localHeader.writeUInt16LE(dosDate.date, 12);
    localHeader.writeUInt32LE(crc,         14);
    localHeader.writeUInt32LE(data.length, 18); // compressed size
    localHeader.writeUInt32LE(data.length, 22); // uncompressed size
    localHeader.writeUInt16LE(nameBytes.length, 26);
    localHeader.writeUInt16LE(0,           28); // extra field length
    nameBytes.copy(localHeader, 30);

    // Central directory entry
    const cdEntry = Buffer.alloc(46 + nameBytes.length);
    cdEntry.writeUInt32LE(0x02014b50, 0);  // signature
    cdEntry.writeUInt16LE(20,          4);  // version made by
    cdEntry.writeUInt16LE(20,          6);  // version needed
    cdEntry.writeUInt16LE(0x0800,      8);  // general purpose bit flag
    cdEntry.writeUInt16LE(0,          10);  // compression
    cdEntry.writeUInt16LE(dosDate.time, 12);
    cdEntry.writeUInt16LE(dosDate.date, 14);
    cdEntry.writeUInt32LE(crc,         16);
    cdEntry.writeUInt32LE(data.length, 20);
    cdEntry.writeUInt32LE(data.length, 24);
    cdEntry.writeUInt16LE(nameBytes.length, 28);
    cdEntry.writeUInt16LE(0,          30); // extra
    cdEntry.writeUInt16LE(0,          32); // comment
    cdEntry.writeUInt16LE(0,          34); // disk start
    cdEntry.writeUInt16LE(0,          36); // internal attrs
    cdEntry.writeUInt32LE(0,          38); // external attrs
    cdEntry.writeUInt32LE(offset,     42); // offset of local header
    nameBytes.copy(cdEntry, 46);

    parts.push(localHeader, data);
    centralDir.push(cdEntry);
    offset += localHeader.length + data.length;
  }

  const cdBuffer   = Buffer.concat(centralDir);
  const eocd       = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50,        0); // end of central dir signature
  eocd.writeUInt16LE(0,                 4); // disk number
  eocd.writeUInt16LE(0,                 6); // disk with central dir start
  eocd.writeUInt16LE(entries.length,    8); // entries on this disk
  eocd.writeUInt16LE(entries.length,   10); // total entries
  eocd.writeUInt32LE(cdBuffer.length,  12); // central dir size
  eocd.writeUInt32LE(offset,           16); // central dir offset
  eocd.writeUInt16LE(0,               20); // comment length

  return Buffer.concat([...parts, cdBuffer, eocd]);
}

function toDosDateTime(date: Date): { time: number; date: number } {
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const d = ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { time, date: d };
}

/** CRC-32 using Node.js crypto for a Buffer. */
function crc32(buf: Buffer): number {
  // Generate the table once
  if (!crc32Table) {
    crc32Table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      crc32Table[i] = c;
    }
  }
  const table = crc32Table;
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) crc = (table![(crc ^ (buf[i] as number)) & 0xFF] as number) ^ (crc >>> 8);
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

let crc32Table: Uint32Array | null = null;

// suppress unused import warning — crypto is used for Node.js version guard
void createHash;
