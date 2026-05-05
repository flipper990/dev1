// ─────────────────────────────────────────────────────────────
// Tech-stack contract — derives the concrete file layout, package
// requirements, and code patterns from spec.techStack so the builder
// emits code that matches the user's chosen stack instead of the
// system-prompt defaults.
//
// Three exports:
//   1. normalizeTechStack(raw) — coerce arbitrary spec.techStack values
//      into a canonical { backend, frontend, orm, database, validator,
//      styling } shape.
//   2. buildStackContract(stack) — markdown prompt fragment listing the
//      exact file paths, packages, and patterns the builder MUST use.
//      Injected into every builder + polish prompt.
//   3. validateStackCompliance(files, stack) + stackViolationsAsIssues —
//      static check that flips QA to needs-improvement when generated
//      files use the wrong ORM / backend framework / frontend framework.
// ─────────────────────────────────────────────────────────────

import type { FileLike } from './agent-input-builder.js';

// ── Canonical shape ──────────────────────────────────────────────

export type BackendStack  = 'fastify' | 'express' | 'hono' | 'none';
export type FrontendStack = 'next' | 'vite' | 'remix' | 'none';
export type OrmStack      = 'prisma' | 'drizzle' | 'none';
export type DbStack       = 'postgres' | 'sqlite' | 'mysql' | 'mongo' | 'none';
export type ValidatorStack = 'zod' | 'yup' | 'valibot' | 'none';
export type StylingStack  = 'tailwind' | 'css-modules' | 'styled-components' | 'none';

export interface CanonicalStack {
  backend: BackendStack;
  frontend: FrontendStack;
  orm: OrmStack;
  database: DbStack;
  validator: ValidatorStack;
  styling: StylingStack;
  /** Original raw value preserved for diagnostics. */
  raw: Record<string, string>;
}

const BACKEND_ALIASES: Record<string, BackendStack> = {
  'fastify': 'fastify',
  'express': 'express', 'expressjs': 'express', 'express.js': 'express',
  'hono': 'hono',
  'none': 'none', '': 'none', 'static': 'none',
};
const FRONTEND_ALIASES: Record<string, FrontendStack> = {
  'next': 'next', 'nextjs': 'next', 'next.js': 'next',
  'vite': 'vite', 'vite-react': 'vite', 'react+vite': 'vite', 'react-vite': 'vite',
  'remix': 'remix',
  'none': 'none', '': 'none',
};
const ORM_ALIASES: Record<string, OrmStack> = {
  'prisma': 'prisma',
  'drizzle': 'drizzle', 'drizzle-orm': 'drizzle',
  'none': 'none', '': 'none', 'raw-sql': 'none',
};
const DB_ALIASES: Record<string, DbStack> = {
  'postgres': 'postgres', 'postgresql': 'postgres', 'pg': 'postgres',
  'sqlite': 'sqlite',
  'mysql': 'mysql', 'mariadb': 'mysql',
  'mongo': 'mongo', 'mongodb': 'mongo',
  'none': 'none', '': 'none',
};
const VALIDATOR_ALIASES: Record<string, ValidatorStack> = {
  'zod': 'zod', 'yup': 'yup', 'valibot': 'valibot',
  'none': 'none', '': 'none',
};
const STYLING_ALIASES: Record<string, StylingStack> = {
  'tailwind': 'tailwind', 'tailwindcss': 'tailwind',
  'css-modules': 'css-modules', 'cssmodules': 'css-modules',
  'styled-components': 'styled-components', 'styled': 'styled-components',
  'none': 'none', '': 'none',
};

function pick<T extends string>(
  raw: Record<string, string>,
  keys: string[],
  aliases: Record<string, T>,
  defaultValue: T,
): T {
  for (const k of keys) {
    const v = raw[k];
    if (typeof v === 'string') {
      const norm = v.trim().toLowerCase();
      const hit = aliases[norm];
      if (hit) return hit;
      // Fuzzy: does the lowercased value contain any alias key?
      for (const aliasKey of Object.keys(aliases)) {
        if (aliasKey && norm.includes(aliasKey)) return aliases[aliasKey];
      }
    }
  }
  return defaultValue;
}

/**
 * Coerce spec.techStack (free-form string map from the LLM) into a
 * canonical shape. Defaults reflect the system-prompt baseline so apps
 * that don't explicitly opt out get the proven stack.
 */
export function normalizeTechStack(raw: unknown): CanonicalStack {
  const rec: Record<string, string> = {};
  if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
      if (typeof v === 'string') rec[k.toLowerCase()] = v;
    }
  }
  const backend = pick(rec, ['backend', 'server', 'api'], BACKEND_ALIASES, 'fastify');
  const frontend = pick(rec, ['frontend', 'web', 'ui', 'client'], FRONTEND_ALIASES, 'next');
  const orm = pick(rec, ['orm', 'db', 'database-orm'], ORM_ALIASES, backend === 'none' ? 'none' : 'prisma');
  const database = pick(rec, ['database', 'db', 'datastore'], DB_ALIASES, backend === 'none' ? 'none' : 'postgres');
  const validator = pick(rec, ['validator', 'validation', 'schema'], VALIDATOR_ALIASES, 'zod');
  const styling = pick(rec, ['styling', 'css', 'style'], STYLING_ALIASES, 'tailwind');

  return { backend, frontend, orm, database, validator, styling, raw: rec };
}

// ── Prompt fragment ──────────────────────────────────────────────

const BACKEND_LAYOUT: Record<BackendStack, string> = {
  fastify: `
**Backend = Fastify**
  - File layout: \`apps/api/src/server.ts\`, \`apps/api/src/routes/<slice>.ts\`, \`apps/api/src/plugins/\`, \`apps/api/src/lib/db.ts\`
  - Required deps: \`fastify\`, \`@fastify/cors\`, \`@fastify/helmet\`, \`pino\`
  - Server bootstrap: \`Fastify({ logger: true })\`, register cors + helmet, expose port via \`process.env.PORT ?? 4000\`.
  - Routes register via \`fastify.register(<sliceRoutes>, { prefix: '/api/<slice>' })\`.
  - Validate input with \`fastify.withTypeProvider<ZodTypeProvider>()\` (or whichever validator was chosen).
  - DOCKER: \`apps/api/Dockerfile\` multi-stage, exposes 4000, runs DB migrations on start.
`,
  express: `
**Backend = Express**
  - File layout: \`apps/api/src/server.ts\`, \`apps/api/src/routes/<slice>.ts\`, \`apps/api/src/middleware/\`, \`apps/api/src/lib/db.ts\`
  - Required deps: \`express\`, \`cors\`, \`helmet\`, \`morgan\` (or \`pino-http\`)
  - Server bootstrap: \`const app = express(); app.use(express.json()); app.use(cors()); app.use(helmet());\`. Listen on \`process.env.PORT ?? 4000\`.
  - Routes register via \`app.use('/api/<slice>', sliceRouter)\` where \`sliceRouter = express.Router()\`.
  - Validate input by parsing the chosen validator schema in a middleware before the handler.
  - DOCKER: \`apps/api/Dockerfile\` multi-stage, exposes 4000, runs DB migrations on start.
  ❌ Do NOT import from \`fastify\`, do NOT use \`@fastify/*\` plugins, do NOT use \`reply.send()\` — use \`res.json()\`.
`,
  hono: `
**Backend = Hono**
  - File layout: \`apps/api/src/server.ts\`, \`apps/api/src/routes/<slice>.ts\`, \`apps/api/src/lib/db.ts\`
  - Required deps: \`hono\`, \`@hono/node-server\`, \`@hono/zod-validator\` (when validator=zod)
  - Server bootstrap: \`const app = new Hono(); serve({ fetch: app.fetch, port: Number(process.env.PORT ?? 4000) })\`.
  - Routes register via \`app.route('/api/<slice>', sliceRouter)\` where \`sliceRouter = new Hono()\`.
  ❌ Do NOT import from \`fastify\` or \`express\`.
`,
  none: `
**Backend = none** (frontend-only project)
  - DO NOT emit \`apps/api/\`, \`prisma/\`, server code, or DB-related files.
  - \`docker-compose.yml\` (if any) only runs the frontend.
`,
};

const FRONTEND_LAYOUT: Record<FrontendStack, string> = {
  next: `
**Frontend = Next.js (App Router)**
  - File layout: \`apps/web/app/layout.tsx\`, \`apps/web/app/<route>/page.tsx\`, \`apps/web/components/\`, \`apps/web/lib/api-client.ts\`
  - Required deps: \`next\` (^15), \`react\` (^18), \`react-dom\`
  - Config: \`apps/web/next.config.ts\` (or .mjs). Must NOT contain \`vite\` references.
  - Routing: filesystem under \`app/\`. Use \`<Link href="/...">\` from \`next/link\`. Server vs Client components per spec.
  - DOCKER: \`apps/web/Dockerfile\` multi-stage, runs \`next build\` → \`next start\`, exposes 3000.
  ❌ Do NOT emit \`vite.config.ts\`, \`index.html\` at project root, or \`react-router-dom\` imports.
`,
  vite: `
**Frontend = Vite + React**
  - File layout: \`apps/web/index.html\`, \`apps/web/src/main.tsx\`, \`apps/web/src/App.tsx\`, \`apps/web/src/routes/\`, \`apps/web/src/components/\`, \`apps/web/src/lib/api-client.ts\`
  - Required deps: \`vite\`, \`@vitejs/plugin-react\`, \`react\`, \`react-dom\`, \`react-router-dom\`
  - Config: \`apps/web/vite.config.ts\` exporting \`defineConfig({ plugins: [react()] })\`.
  - Routing: \`react-router-dom\` v6 — \`<BrowserRouter><Routes><Route .../></Routes></BrowserRouter>\` in \`main.tsx\` or \`App.tsx\`.
  - DOCKER: \`apps/web/Dockerfile\` multi-stage, runs \`vite build\` → serves \`dist/\` via nginx (or \`vite preview\`), exposes 3000.
  ❌ Do NOT emit \`apps/web/app/\` (that is Next.js App Router). Do NOT import from \`next/*\` (\`next/link\`, \`next/navigation\`, \`next/image\`).
`,
  remix: `
**Frontend = Remix**
  - File layout: \`apps/web/app/root.tsx\`, \`apps/web/app/routes/<route>.tsx\`, \`apps/web/app/components/\`
  - Required deps: \`@remix-run/node\`, \`@remix-run/react\`, \`@remix-run/serve\`, \`react\`, \`react-dom\`
  - Routing: filesystem under \`app/routes/\`. Loaders / actions for data + mutations.
  - DOCKER: \`apps/web/Dockerfile\` multi-stage, runs \`remix build\` → \`remix-serve\`, exposes 3000.
  ❌ Do NOT import from \`next/*\` or \`vite\`.
`,
  none: `
**Frontend = none** (backend-only project)
  - DO NOT emit \`apps/web/\` or any frontend files.
`,
};

const ORM_LAYOUT: Record<OrmStack, string> = {
  prisma: `
**ORM = Prisma**
  - Required files: \`apps/api/prisma/schema.prisma\` (datasource + generator + one model per spec.dbSchema.tables[]), \`apps/api/prisma/seed.ts\`
  - Required deps: \`prisma\` (devDep), \`@prisma/client\`
  - Client instantiation: \`apps/api/src/lib/db.ts\` exports a singleton \`prisma\` instance.
  - Migrations: \`prisma migrate deploy\` runs on container start; \`prisma generate\` runs in build stage.
  - Models include relations, indexes, \`createdAt\` / \`updatedAt\`, \`@id @default(cuid())\` ids.
  ❌ Do NOT emit Drizzle schema files (\`drizzle.config.ts\`, \`schema.ts\` with \`pgTable\`).
`,
  drizzle: `
**ORM = Drizzle**
  - Required files: \`apps/api/src/db/schema.ts\` (one \`pgTable\` / \`mysqlTable\` / \`sqliteTable\` per dbSchema entry), \`apps/api/drizzle.config.ts\`, \`apps/api/src/db/migrate.ts\` (or use \`drizzle-kit migrate\`)
  - Required deps: \`drizzle-orm\`, \`drizzle-kit\` (devDep), plus the matching driver: \`postgres\` (postgres-js) / \`better-sqlite3\` / \`mysql2\`.
  - Client instantiation: \`apps/api/src/db/index.ts\` exports a \`db\` instance using the chosen driver.
  - Migrations: generated via \`drizzle-kit generate\`, applied on container start.
  - Models include relations (\`relations()\` helper), \`createdAt\` / \`updatedAt\` columns, primary keys.
  ❌ Do NOT emit \`prisma/schema.prisma\`, do NOT import \`@prisma/client\`, do NOT depend on \`prisma\`.
`,
  none: `
**ORM = none** (no database layer)
  - DO NOT emit Prisma or Drizzle schema files.
  - In-memory or file-backed store only — pick the simplest option that satisfies the spec.
`,
};

const VALIDATOR_NOTE: Record<ValidatorStack, string> = {
  zod: `Validator = **zod** — every API request body validated with a zod schema, errors map to the spec's error envelope.`,
  yup: `Validator = **yup** — every API request body validated with a yup schema, errors map to the spec's error envelope.`,
  valibot: `Validator = **valibot** — every API request body validated with a valibot schema.`,
  none: `Validator = none — request shape enforced manually with TypeScript types only (avoid this if possible).`,
};

const DB_NOTE: Record<DbStack, string> = {
  postgres: `Database = **PostgreSQL**. docker-compose.yml runs a \`postgres:16\` service. Connection via \`DATABASE_URL\`.`,
  sqlite:   `Database = **SQLite**. No DB service in docker-compose. Connection via local file (\`./data/app.db\`).`,
  mysql:    `Database = **MySQL**. docker-compose.yml runs a \`mysql:8\` service. Connection via \`DATABASE_URL\`.`,
  mongo:    `Database = **MongoDB**. docker-compose.yml runs a \`mongo:7\` service. ORM must be compatible (Prisma supports Mongo).`,
  none:     `Database = none.`,
};

/**
 * Build the markdown prompt fragment that tells the builder exactly which
 * stack to emit. Injected into every builder + polish prompt.
 */
export function buildStackContract(stack: CanonicalStack): string {
  const lines: string[] = [];
  lines.push(`## 🧱 TECH-STACK CONTRACT (HARD — overrides any system-prompt default)\n`);
  lines.push(`This is the stack committed for this project (chosen by the user in the UI`);
  lines.push(`OR by the spec agent based on the prompt — either way, it is now final).`);
  lines.push(`Generated code MUST match it byte-for-byte. Stack-mismatched output`);
  lines.push(`(e.g. emitting \`prisma/schema.prisma\` when ORM=drizzle) will be rejected.\n`);
  lines.push('```json');
  lines.push(JSON.stringify({
    backend: stack.backend, frontend: stack.frontend, orm: stack.orm,
    database: stack.database, validator: stack.validator, styling: stack.styling,
  }, null, 2));
  lines.push('```\n');
  lines.push(BACKEND_LAYOUT[stack.backend]);
  lines.push(FRONTEND_LAYOUT[stack.frontend]);
  if (stack.backend !== 'none') {
    lines.push(ORM_LAYOUT[stack.orm]);
    lines.push(`${DB_NOTE[stack.database]}\n`);
    lines.push(`${VALIDATOR_NOTE[stack.validator]}\n`);
  }
  return lines.join('\n');
}

// ── Compliance scanner ───────────────────────────────────────────

export type StackViolationRule =
  | 'wrong-backend-import'
  | 'wrong-backend-file'
  | 'wrong-frontend-import'
  | 'wrong-frontend-file'
  | 'wrong-orm-file'
  | 'wrong-orm-import'
  | 'missing-backend-entry'
  | 'missing-frontend-entry'
  | 'missing-orm-schema';

export interface StackViolation {
  file: string;
  rule: StackViolationRule;
  message: string;
  samples?: string[];
}

export interface StackComplianceReport {
  violations: StackViolation[];
  failed: boolean;
  inspected: number;
}

/** Stack-mismatched imports we explicitly forbid per chosen backend. */
const BACKEND_FORBIDDEN_IMPORT: Record<BackendStack, RegExp[]> = {
  fastify: [/from\s+['"]express['"]/, /from\s+['"]hono['"]/],
  express: [/from\s+['"]fastify['"]/, /from\s+['"]@fastify\//, /from\s+['"]hono['"]/],
  hono:    [/from\s+['"]fastify['"]/, /from\s+['"]@fastify\//, /from\s+['"]express['"]/],
  none:    [],
};
const FRONTEND_FORBIDDEN_IMPORT: Record<FrontendStack, RegExp[]> = {
  next:  [/from\s+['"]vite['"]/, /from\s+['"]@vitejs\//, /from\s+['"]react-router-dom['"]/, /from\s+['"]@remix-run\//],
  vite:  [/from\s+['"]next\//, /from\s+['"]next['"]/, /from\s+['"]@remix-run\//],
  remix: [/from\s+['"]next\//, /from\s+['"]next['"]/, /from\s+['"]vite['"]/, /from\s+['"]react-router-dom['"]/],
  none:  [],
};
const ORM_FORBIDDEN_IMPORT: Record<OrmStack, RegExp[]> = {
  prisma:  [/from\s+['"]drizzle-orm/, /from\s+['"]drizzle-kit/],
  drizzle: [/from\s+['"]@prisma\/client['"]/, /from\s+['"]prisma['"]/],
  none:    [/from\s+['"]@prisma\/client['"]/, /from\s+['"]drizzle-orm/],
};

/**
 * Validate that generated source files match the chosen stack.
 * Skips package.json (the dependency-validator handles missing deps);
 * focuses on imports + file paths that are unambiguously stack-mismatched.
 */
export function validateStackCompliance(files: FileLike[], stack: CanonicalStack): StackComplianceReport {
  const out: StackComplianceReport = { violations: [], failed: false, inspected: 0 };

  let hasFastifyEntry = false, hasExpressEntry = false, hasHonoEntry = false;
  let hasNextEntry = false, hasViteEntry = false, hasRemixEntry = false;
  let hasPrismaSchema = false, hasDrizzleSchema = false;

  const backendForbid  = BACKEND_FORBIDDEN_IMPORT[stack.backend];
  const frontendForbid = FRONTEND_FORBIDDEN_IMPORT[stack.frontend];
  const ormForbid      = ORM_FORBIDDEN_IMPORT[stack.orm];

  for (const f of files) {
    const path = f.path.replace(/\\/g, '/');
    const isCode = /\.(tsx?|jsx?|mjs|cjs|mts|cts)$/.test(path);
    const isPkgJson = path.endsWith('package.json');
    const isProse = path.endsWith('.md') || path.endsWith('.txt');
    if (isProse) continue;

    // ── Structural detection ──
    if (/(^|\/)apps\/api\/.*server\.(t|j)sx?$/.test(path) || /(^|\/)server\.(t|j)sx?$/.test(path)) {
      const c = f.content;
      if (/from\s+['"]fastify['"]/.test(c)) hasFastifyEntry = true;
      if (/from\s+['"]express['"]/.test(c)) hasExpressEntry = true;
      if (/from\s+['"]hono['"]/.test(c)) hasHonoEntry = true;
    }
    if (/(^|\/)next\.config\.(ts|js|mjs|cjs)$/.test(path)) hasNextEntry = true;
    if (/(^|\/)vite\.config\.(ts|js|mjs|cjs)$/.test(path)) hasViteEntry = true;
    if (/(^|\/)remix\.config\.(ts|js|mjs|cjs)$/.test(path) || /(^|\/)apps\/web\/app\/root\.tsx$/.test(path)) hasRemixEntry = true;
    if (/(^|\/)prisma\/schema\.prisma$/.test(path)) hasPrismaSchema = true;
    if (/(^|\/)drizzle\.config\.(ts|js)$/.test(path) || /(^|\/)db\/schema\.(ts|js)$/.test(path)) {
      // Only count drizzle if file uses pgTable/mysqlTable/sqliteTable.
      if (/\b(pgTable|mysqlTable|sqliteTable)\s*\(/.test(f.content) || path.endsWith('drizzle.config.ts') || path.endsWith('drizzle.config.js')) {
        hasDrizzleSchema = true;
      }
    }

    // ── Wrong-stack file paths ──
    // Prisma schema present but stack says drizzle/none.
    if (/(^|\/)prisma\/schema\.prisma$/.test(path) && stack.orm !== 'prisma') {
      out.violations.push({ file: path, rule: 'wrong-orm-file',
        message: `Prisma schema emitted but spec.techStack.orm=${stack.orm}. Remove and use ${stack.orm} instead.` });
    }
    // Drizzle config present but stack says prisma/none.
    if (/(^|\/)drizzle\.config\.(ts|js)$/.test(path) && stack.orm !== 'drizzle') {
      out.violations.push({ file: path, rule: 'wrong-orm-file',
        message: `Drizzle config emitted but spec.techStack.orm=${stack.orm}. Remove and use ${stack.orm} instead.` });
    }
    // next.config present but stack says vite/remix.
    if (/(^|\/)next\.config\.(ts|js|mjs|cjs)$/.test(path) && stack.frontend !== 'next' && stack.frontend !== 'none') {
      out.violations.push({ file: path, rule: 'wrong-frontend-file',
        message: `next.config.* emitted but spec.techStack.frontend=${stack.frontend}.` });
    }
    // vite.config present but stack says next/remix.
    if (/(^|\/)vite\.config\.(ts|js|mjs|cjs)$/.test(path) && stack.frontend !== 'vite' && stack.frontend !== 'none') {
      out.violations.push({ file: path, rule: 'wrong-frontend-file',
        message: `vite.config.* emitted but spec.techStack.frontend=${stack.frontend}.` });
    }
    // App Router present but stack says vite (Next.js exclusive layout).
    if (/(^|\/)apps\/web\/app\/(layout|page)\.(t|j)sx?$/.test(path) && stack.frontend === 'vite') {
      out.violations.push({ file: path, rule: 'wrong-frontend-file',
        message: `Next.js App Router file but spec.techStack.frontend=vite. Use src/main.tsx + react-router-dom instead.` });
    }
    // Vite index.html at apps/web root but stack says next.
    if (/(^|\/)apps\/web\/index\.html$/.test(path) && stack.frontend === 'next') {
      out.violations.push({ file: path, rule: 'wrong-frontend-file',
        message: `Vite-style index.html at project root but spec.techStack.frontend=next. Remove — Next.js manages HTML via app/layout.tsx.` });
    }

    // ── Forbidden imports ──
    if (isCode) {
      out.inspected++;
      const c = f.content;
      // Skip primitive UI library files & test files for these checks.
      for (const rx of backendForbid) {
        if (rx.test(c)) {
          out.violations.push({ file: path, rule: 'wrong-backend-import',
            message: `Imports a backend framework that doesn't match spec.techStack.backend=${stack.backend}.`,
            samples: [String(rx).slice(1, -1)] });
          break;
        }
      }
      // Frontend forbidden imports only flagged inside likely frontend trees
      // to avoid false positives (e.g. an api file referencing 'next' in a
      // comment/string).
      const isFrontendPath = /(^|\/)apps\/web\//.test(path) || /(^|\/)src\//.test(path) || /\.(t|j)sx$/.test(path);
      if (isFrontendPath) {
        for (const rx of frontendForbid) {
          if (rx.test(c)) {
            out.violations.push({ file: path, rule: 'wrong-frontend-import',
              message: `Imports from a frontend framework that doesn't match spec.techStack.frontend=${stack.frontend}.`,
              samples: [String(rx).slice(1, -1)] });
            break;
          }
        }
      }
      const isApiPath = /(^|\/)apps\/api\//.test(path);
      if (isApiPath || stack.backend === 'none') {
        for (const rx of ormForbid) {
          if (rx.test(c)) {
            out.violations.push({ file: path, rule: 'wrong-orm-import',
              message: `Imports an ORM that doesn't match spec.techStack.orm=${stack.orm}.`,
              samples: [String(rx).slice(1, -1)] });
            break;
          }
        }
      }
    }
    // Note: we don't flag package.json contents — that's the dep-validator's
    // job. Mismatched deps will surface there as added entries we want to
    // not have, but harm is limited.
    void isPkgJson;
  }

  // ── Missing-required-entry checks ──
  if (stack.backend === 'fastify' && !hasFastifyEntry && filesContainBackend(files)) {
    out.violations.push({ file: 'apps/api/src/server.ts', rule: 'missing-backend-entry',
      message: 'Spec requires Fastify backend but no `import … from "fastify"` server entry was found.' });
  }
  if (stack.backend === 'express' && !hasExpressEntry && filesContainBackend(files)) {
    out.violations.push({ file: 'apps/api/src/server.ts', rule: 'missing-backend-entry',
      message: 'Spec requires Express backend but no `import … from "express"` server entry was found.' });
  }
  if (stack.backend === 'hono' && !hasHonoEntry && filesContainBackend(files)) {
    out.violations.push({ file: 'apps/api/src/server.ts', rule: 'missing-backend-entry',
      message: 'Spec requires Hono backend but no `import … from "hono"` server entry was found.' });
  }

  if (stack.frontend === 'next' && !hasNextEntry && filesContainFrontend(files)) {
    out.violations.push({ file: 'apps/web/next.config.ts', rule: 'missing-frontend-entry',
      message: 'Spec requires Next.js but no next.config.* was emitted.' });
  }
  if (stack.frontend === 'vite' && !hasViteEntry && filesContainFrontend(files)) {
    out.violations.push({ file: 'apps/web/vite.config.ts', rule: 'missing-frontend-entry',
      message: 'Spec requires Vite but no vite.config.* was emitted.' });
  }
  if (stack.frontend === 'remix' && !hasRemixEntry && filesContainFrontend(files)) {
    out.violations.push({ file: 'apps/web/app/root.tsx', rule: 'missing-frontend-entry',
      message: 'Spec requires Remix but no remix entry (root.tsx / remix.config.*) was emitted.' });
  }

  if (stack.orm === 'prisma' && !hasPrismaSchema && filesContainBackend(files)) {
    out.violations.push({ file: 'apps/api/prisma/schema.prisma', rule: 'missing-orm-schema',
      message: 'Spec requires Prisma but no prisma/schema.prisma was emitted.' });
  }
  if (stack.orm === 'drizzle' && !hasDrizzleSchema && filesContainBackend(files)) {
    out.violations.push({ file: 'apps/api/src/db/schema.ts', rule: 'missing-orm-schema',
      message: 'Spec requires Drizzle but no drizzle schema (src/db/schema.ts or drizzle.config.ts) was emitted.' });
  }

  out.failed = out.violations.length > 0;
  return out;
}

function filesContainBackend(files: FileLike[]): boolean {
  return files.some((f) => /(^|\/)apps\/api\//.test(f.path.replace(/\\/g, '/')));
}
function filesContainFrontend(files: FileLike[]): boolean {
  return files.some((f) => /(^|\/)apps\/web\//.test(f.path.replace(/\\/g, '/')));
}

/** Convert violations to QA-issue rows the rebuild loop already understands. */
export function stackViolationsAsIssues(
  report: StackComplianceReport,
  cap = 20,
): Array<{ category: string; message: string; hint?: string; rootCause?: string }> {
  const out: Array<{ category: string; message: string; hint?: string; rootCause?: string }> = [];
  for (const v of report.violations) {
    out.push({
      category: 'tech-stack',
      message: `${v.rule} in ${v.file}: ${v.message}`,
      hint: v.samples && v.samples.length > 0 ? `e.g. ${v.samples.join(', ')}` : undefined,
      rootCause: 'Generated file does not match spec.techStack',
    });
    if (out.length >= cap) break;
  }
  return out;
}
