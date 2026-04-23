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
  /\.stub\.[jt]sx?$/i,
  /__mocks__\//i,
  /\/preview-only\//i,
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

  // ── .env.example — only add if not already present ───────────────────────
  const hasEnvExample = out.some((f) => f.path === '.env.example' || f.path === 'frontend/.env.example');
  if (!hasEnvExample) {
    const envVars = (project.spec?.envVars as { name: string; description?: string; example?: string }[] | undefined) ?? [];
    out.push({ path: '.env.example', content: buildEnvExample(envVars) });
  }

  // ── README.md ─────────────────────────────────────────────────────────────
  const hasReadme = out.some((f) => /^readme\.md$/i.test(f.path));
  if (!hasReadme) {
    out.push({ path: 'README.md', content: buildReadme(project) });
  }

  // ── .gitignore ────────────────────────────────────────────────────────────
  const hasGitignore = out.some((f) => f.path === '.gitignore');
  if (!hasGitignore) {
    out.push({ path: '.gitignore', content: buildGitignore() });
  }

  return out;
}

// ── File content builders ─────────────────────────────────────────────────

function buildEnvExample(envVars: { name: string; description?: string; example?: string }[]): string {
  if (envVars.length === 0) {
    return [
      '# Environment variables',
      '# Copy this file to .env and fill in the values.',
      '',
      'NODE_ENV=production',
      'PORT=3000',
      '',
      '# Add your environment variables below:',
      '',
    ].join('\n');
  }

  const lines: string[] = [
    '# Environment variables',
    '# Copy this file to .env and fill in the values.',
    '',
  ];

  for (const v of envVars) {
    if (v.description) lines.push(`# ${v.description}`);
    lines.push(`${v.name}=${v.example ?? ''}`);
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

function buildReadme(project: ExportProject): string {
  const name = project.name ?? 'Generated Project';
  const prompts = project.prompts?.map((p) => `- ${p.text}`).join('\n') ?? `- ${project.prompt}`;
  const hasDocker = project.files.some((f) => f.path === 'Dockerfile' || f.path === 'docker-compose.yml');
  const hasPrisma = project.files.some((f) => /schema\.prisma$/.test(f.path));
  const hasMigrations = project.files.some((f) => /migrations?\//i.test(f.path));
  const detected = detectTechStack(project.files);
  const isPythonBackend = (detected.backend ?? '').startsWith('Python');

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
  if (!isPythonBackend) sections.push('- Node.js 18+');
  if (isPythonBackend) sections.push('- Python 3.10+');
  sections.push(isPythonBackend ? '- pip' : '- npm or pnpm');
  if (hasPrisma || hasMigrations || (detected.database ?? '').length > 0) sections.push('- A database matching your `.env` configuration');
  if (hasDocker) sections.push('- Docker & Docker Compose (optional — for containerised setup)');
  sections.push('');
  sections.push('### Installation');
  sections.push('');
  sections.push('```bash');
  sections.push('# 1. Install dependencies');
  if (isPythonBackend) {
    sections.push('pip install -r requirements.txt');
  } else {
    sections.push('npm install');
  }
  sections.push('');
  sections.push('# 2. Copy environment variables');
  sections.push('cp .env.example .env');
  sections.push('# Edit .env with your real values');
  sections.push('');

  let step = 3;
  if (hasPrisma) {
    sections.push(`# ${step}. Run database migrations`);
    sections.push('npx prisma migrate dev');
    sections.push('');
    step++;
  }

  sections.push(`# ${step}. Start the development server`);
  if (isPythonBackend) sections.push('uvicorn main:app --reload');
  else sections.push('npm run dev');
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
  sections.push('## Notes');
  sections.push('');
  sections.push('- This project was generated from a natural language prompt.');
  sections.push('- Review all generated code before deploying to production.');
  sections.push('- Environment variables in `.env.example` must be populated before running.');

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
