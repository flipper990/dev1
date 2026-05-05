/**
 * Tech-stack catalog for the "Bring your own stack" picker.
 *
 * Curated, opinionated 2026 lists — popular & production-ready picks across
 * each category. Everything maps to a short label and (optional) hint that
 * gets prepended to the user's prompt so the agents can target the chosen
 * stack precisely.
 */

export type StackCategory =
  | 'frontend'
  | 'meta'
  | 'styling'
  | 'state'
  | 'backend'
  | 'language'
  | 'database'
  | 'orm'
  | 'auth'
  | 'queue'
  | 'storage'
  | 'realtime'
  | 'ai'
  | 'testing'
  | 'deploy'
  | 'mobile';

export interface StackOption {
  id: string;
  label: string;
  hint?: string;
  /** Marked as the de-facto default for this category. */
  recommended?: boolean;
}

export interface StackGroup {
  id: StackCategory;
  label: string;
  description: string;
  /** False for single-select (radio), true for multi-select (chips). */
  multi?: boolean;
  options: StackOption[];
}

export const STACK_GROUPS: StackGroup[] = [
  {
    id: 'frontend',
    label: 'Frontend framework',
    description: 'UI library powering the client.',
    options: [
      { id: 'react',     label: 'React 19',          recommended: true },
      { id: 'vue',       label: 'Vue 3' },
      { id: 'svelte',    label: 'Svelte 5' },
      { id: 'solid',     label: 'SolidJS' },
      { id: 'angular',   label: 'Angular 18' },
      { id: 'qwik',      label: 'Qwik' },
      { id: 'preact',    label: 'Preact' },
      { id: 'lit',       label: 'Lit' },
      { id: 'htmx',      label: 'HTMX (server-driven)' },
      { id: 'vanilla',   label: 'Vanilla TS' },
    ],
  },
  {
    id: 'meta',
    label: 'Meta-framework',
    description: 'Routing, SSR/SSG, file-based pages.',
    options: [
      { id: 'nextjs',    label: 'Next.js 16',        recommended: true, hint: 'App Router, RSC' },
      { id: 'remix',     label: 'Remix / React Router 7' },
      { id: 'astro',     label: 'Astro' },
      { id: 'nuxt',      label: 'Nuxt 4' },
      { id: 'sveltekit', label: 'SvelteKit 2' },
      { id: 'solidstart',label: 'SolidStart' },
      { id: 'tanstack',  label: 'TanStack Start' },
      { id: 'qwikcity',  label: 'QwikCity' },
      { id: 'analog',    label: 'AnalogJS (Angular)' },
      { id: 'none-meta', label: 'None — SPA only' },
    ],
  },
  {
    id: 'styling',
    label: 'Styling',
    multi: true,
    description: 'CSS approach + UI kit.',
    options: [
      { id: 'tailwind',     label: 'Tailwind CSS v4',    recommended: true },
      { id: 'shadcn',       label: 'shadcn/ui',          recommended: true },
      { id: 'css-modules',  label: 'CSS Modules' },
      { id: 'vanilla-extract', label: 'Vanilla Extract' },
      { id: 'panda',        label: 'Panda CSS' },
      { id: 'unocss',       label: 'UnoCSS' },
      { id: 'styled',       label: 'styled-components' },
      { id: 'emotion',      label: 'Emotion' },
      { id: 'mantine',      label: 'Mantine' },
      { id: 'mui',          label: 'MUI (Material)' },
      { id: 'chakra',       label: 'Chakra UI' },
      { id: 'radix',        label: 'Radix UI' },
      { id: 'arkui',        label: 'Ark UI' },
      { id: 'headlessui',   label: 'Headless UI' },
      { id: 'daisyui',      label: 'daisyUI' },
      { id: 'bootstrap',    label: 'Bootstrap 5' },
    ],
  },
  {
    id: 'state',
    label: 'State / data fetching',
    multi: true,
    description: 'Client state + server cache.',
    options: [
      { id: 'tanstack-query', label: 'TanStack Query',    recommended: true },
      { id: 'zustand',     label: 'Zustand',            recommended: true },
      { id: 'redux-tk',    label: 'Redux Toolkit' },
      { id: 'jotai',       label: 'Jotai' },
      { id: 'valtio',      label: 'Valtio' },
      { id: 'mobx',        label: 'MobX' },
      { id: 'xstate',      label: 'XState' },
      { id: 'pinia',       label: 'Pinia (Vue)' },
      { id: 'swr',         label: 'SWR' },
      { id: 'apollo',      label: 'Apollo Client' },
      { id: 'urql',        label: 'urql' },
      { id: 'rtk-query',   label: 'RTK Query' },
    ],
  },
  {
    id: 'backend',
    label: 'Backend framework',
    description: 'HTTP/API server.',
    options: [
      { id: 'fastify',     label: 'Fastify',            recommended: true },
      { id: 'hono',        label: 'Hono' },
      { id: 'express',     label: 'Express' },
      { id: 'koa',         label: 'Koa' },
      { id: 'nestjs',      label: 'NestJS' },
      { id: 'elysia',      label: 'ElysiaJS (Bun)' },
      { id: 'trpc',        label: 'tRPC' },
      { id: 'graphql-yoga',label: 'GraphQL Yoga' },
      { id: 'apollo-srv',  label: 'Apollo Server' },
      { id: 'fastapi',     label: 'FastAPI (Python)' },
      { id: 'django',      label: 'Django' },
      { id: 'flask',       label: 'Flask' },
      { id: 'rails',       label: 'Ruby on Rails 8' },
      { id: 'laravel',     label: 'Laravel 12' },
      { id: 'spring',      label: 'Spring Boot' },
      { id: 'gin',         label: 'Gin (Go)' },
      { id: 'echo',        label: 'Echo (Go)' },
      { id: 'fiber',       label: 'Fiber (Go)' },
      { id: 'axum',        label: 'Axum (Rust)' },
      { id: 'actix',       label: 'Actix (Rust)' },
      { id: 'phoenix',     label: 'Phoenix (Elixir)' },
      { id: 'aspnet',      label: 'ASP.NET Core' },
    ],
  },
  {
    id: 'language',
    label: 'Backend language',
    description: 'Runtime / language for the server.',
    options: [
      { id: 'node-ts',     label: 'Node.js + TypeScript', recommended: true },
      { id: 'bun',         label: 'Bun' },
      { id: 'deno',        label: 'Deno 2' },
      { id: 'python',      label: 'Python 3.13' },
      { id: 'go',          label: 'Go 1.23' },
      { id: 'rust',        label: 'Rust' },
      { id: 'java',        label: 'Java 21' },
      { id: 'kotlin',      label: 'Kotlin' },
      { id: 'csharp',      label: 'C# / .NET 9' },
      { id: 'ruby',        label: 'Ruby 3.3' },
      { id: 'elixir',      label: 'Elixir' },
      { id: 'php',         label: 'PHP 8.3' },
    ],
  },
  {
    id: 'database',
    label: 'Database',
    description: 'Primary data store.',
    options: [
      { id: 'postgres',    label: 'PostgreSQL',         recommended: true },
      { id: 'mysql',       label: 'MySQL' },
      { id: 'sqlite',      label: 'SQLite' },
      { id: 'mariadb',     label: 'MariaDB' },
      { id: 'mongodb',     label: 'MongoDB' },
      { id: 'redis',       label: 'Redis (cache/KV)' },
      { id: 'dynamodb',    label: 'DynamoDB' },
      { id: 'cassandra',   label: 'Cassandra' },
      { id: 'cockroachdb', label: 'CockroachDB' },
      { id: 'planetscale', label: 'PlanetScale' },
      { id: 'neon',        label: 'Neon (serverless PG)' },
      { id: 'supabase-db', label: 'Supabase Postgres' },
      { id: 'turso',       label: 'Turso (libSQL)' },
      { id: 'd1',          label: 'Cloudflare D1' },
      { id: 'firestore',   label: 'Firestore' },
      { id: 'fauna',       label: 'Fauna' },
      { id: 'surrealdb',   label: 'SurrealDB' },
      { id: 'duckdb',      label: 'DuckDB (analytics)' },
      { id: 'clickhouse',  label: 'ClickHouse (OLAP)' },
    ],
  },
  {
    id: 'orm',
    label: 'ORM / query builder',
    description: 'Type-safe data access.',
    options: [
      { id: 'prisma',      label: 'Prisma 6',           recommended: true },
      { id: 'drizzle',     label: 'Drizzle ORM' },
      { id: 'kysely',      label: 'Kysely' },
      { id: 'typeorm',     label: 'TypeORM' },
      { id: 'mikroorm',    label: 'MikroORM' },
      { id: 'sequelize',   label: 'Sequelize' },
      { id: 'mongoose',    label: 'Mongoose' },
      { id: 'sqlalchemy',  label: 'SQLAlchemy (Py)' },
      { id: 'gorm',        label: 'GORM (Go)' },
      { id: 'sqlx',        label: 'sqlx (Rust)' },
      { id: 'diesel',      label: 'Diesel (Rust)' },
      { id: 'activerecord',label: 'ActiveRecord' },
      { id: 'eloquent',    label: 'Eloquent (Laravel)' },
      { id: 'raw-sql',     label: 'Raw SQL — no ORM' },
    ],
  },
  {
    id: 'auth',
    label: 'Authentication',
    description: 'How users sign in.',
    options: [
      { id: 'auth-js',     label: 'Auth.js (NextAuth)', recommended: true },
      { id: 'better-auth', label: 'Better Auth' },
      { id: 'lucia',       label: 'Lucia' },
      { id: 'clerk',       label: 'Clerk' },
      { id: 'supabase-auth', label: 'Supabase Auth' },
      { id: 'firebase-auth', label: 'Firebase Auth' },
      { id: 'auth0',       label: 'Auth0' },
      { id: 'keycloak',    label: 'Keycloak' },
      { id: 'workos',      label: 'WorkOS (SSO)' },
      { id: 'stytch',      label: 'Stytch' },
      { id: 'magic',       label: 'Magic.link' },
      { id: 'cognito',     label: 'AWS Cognito' },
      { id: 'oauth-self',  label: 'Self-hosted OAuth2' },
      { id: 'jwt-self',    label: 'JWT (custom)' },
      { id: 'session',     label: 'Sessions + cookies' },
      { id: 'no-auth',     label: 'No authentication' },
    ],
  },
  {
    id: 'queue',
    label: 'Jobs / queues',
    description: 'Background work, cron, retries.',
    options: [
      { id: 'no-queue',    label: 'None',               recommended: true },
      { id: 'bullmq',      label: 'BullMQ' },
      { id: 'inngest',     label: 'Inngest' },
      { id: 'trigger',     label: 'Trigger.dev' },
      { id: 'temporal',    label: 'Temporal' },
      { id: 'celery',      label: 'Celery (Python)' },
      { id: 'sidekiq',     label: 'Sidekiq (Ruby)' },
      { id: 'sqs',         label: 'AWS SQS' },
      { id: 'rabbitmq',    label: 'RabbitMQ' },
      { id: 'kafka',       label: 'Kafka' },
      { id: 'nats',        label: 'NATS' },
      { id: 'cloudtasks',  label: 'Google Cloud Tasks' },
    ],
  },
  {
    id: 'storage',
    label: 'File storage',
    description: 'Uploads, blobs, media.',
    options: [
      { id: 'no-storage',  label: 'None',               recommended: true },
      { id: 's3',          label: 'AWS S3' },
      { id: 'r2',          label: 'Cloudflare R2' },
      { id: 'b2',          label: 'Backblaze B2' },
      { id: 'gcs',         label: 'Google Cloud Storage' },
      { id: 'azure-blob',  label: 'Azure Blob' },
      { id: 'supabase-storage', label: 'Supabase Storage' },
      { id: 'uploadthing', label: 'UploadThing' },
      { id: 'cloudinary',  label: 'Cloudinary' },
      { id: 'minio',       label: 'MinIO (self-hosted)' },
    ],
  },
  {
    id: 'realtime',
    label: 'Realtime',
    description: 'Live updates / pub-sub.',
    options: [
      { id: 'no-realtime', label: 'None',               recommended: true },
      { id: 'websockets',  label: 'Native WebSockets' },
      { id: 'sse',         label: 'Server-Sent Events' },
      { id: 'socketio',    label: 'Socket.IO' },
      { id: 'pusher',      label: 'Pusher' },
      { id: 'ably',        label: 'Ably' },
      { id: 'liveblocks',  label: 'Liveblocks' },
      { id: 'partykit',    label: 'PartyKit' },
      { id: 'supabase-rt', label: 'Supabase Realtime' },
      { id: 'phoenix-ch',  label: 'Phoenix Channels' },
      { id: 'centrifugo',  label: 'Centrifugo' },
    ],
  },
  {
    id: 'ai',
    label: 'AI / ML',
    multi: true,
    description: 'LLMs, embeddings, vector DB.',
    options: [
      { id: 'no-ai',       label: 'None',               recommended: true },
      { id: 'openai',      label: 'OpenAI (gpt-4o, o-series)' },
      { id: 'anthropic',   label: 'Anthropic Claude' },
      { id: 'google',      label: 'Google Gemini' },
      { id: 'meta',        label: 'Meta Llama' },
      { id: 'mistral',     label: 'Mistral' },
      { id: 'groq',        label: 'Groq' },
      { id: 'ollama',      label: 'Ollama (local)' },
      { id: 'vercel-ai',   label: 'Vercel AI SDK' },
      { id: 'langchain',   label: 'LangChain' },
      { id: 'llamaindex',  label: 'LlamaIndex' },
      { id: 'pgvector',    label: 'pgvector' },
      { id: 'pinecone',    label: 'Pinecone' },
      { id: 'qdrant',      label: 'Qdrant' },
      { id: 'weaviate',    label: 'Weaviate' },
      { id: 'chroma',      label: 'Chroma' },
    ],
  },
  {
    id: 'testing',
    label: 'Testing',
    multi: true,
    description: 'Unit, e2e, component.',
    options: [
      { id: 'vitest',      label: 'Vitest',             recommended: true },
      { id: 'playwright',  label: 'Playwright',         recommended: true },
      { id: 'jest',        label: 'Jest' },
      { id: 'mocha',       label: 'Mocha' },
      { id: 'cypress',     label: 'Cypress' },
      { id: 'rtl',         label: 'React Testing Library' },
      { id: 'storybook',   label: 'Storybook' },
      { id: 'msw',         label: 'MSW (mocks)' },
    ],
  },
  {
    id: 'deploy',
    label: 'Deployment target',
    description: 'Where the app runs.',
    options: [
      { id: 'vercel',      label: 'Vercel',             recommended: true },
      { id: 'netlify',     label: 'Netlify' },
      { id: 'cloudflare',  label: 'Cloudflare Pages/Workers' },
      { id: 'railway',     label: 'Railway' },
      { id: 'render',      label: 'Render' },
      { id: 'fly',         label: 'Fly.io' },
      { id: 'aws',         label: 'AWS (ECS/Lambda)' },
      { id: 'gcp',         label: 'Google Cloud Run' },
      { id: 'azure',       label: 'Azure App Service' },
      { id: 'do',          label: 'DigitalOcean' },
      { id: 'heroku',      label: 'Heroku' },
      { id: 'k8s',         label: 'Kubernetes' },
      { id: 'docker',      label: 'Docker Compose (self-host)' },
      { id: 'vps',         label: 'Bare VPS' },
    ],
  },
  {
    id: 'mobile',
    label: 'Mobile (optional)',
    description: 'Add a mobile target.',
    options: [
      { id: 'no-mobile',   label: 'Web only',           recommended: true },
      { id: 'react-native',label: 'React Native (Expo)' },
      { id: 'flutter',     label: 'Flutter' },
      { id: 'swift',       label: 'SwiftUI (iOS)' },
      { id: 'kotlin-mp',   label: 'Kotlin Multiplatform' },
      { id: 'capacitor',   label: 'Capacitor (web wrapper)' },
      { id: 'tauri',       label: 'Tauri (desktop+mobile)' },
      { id: 'pwa',         label: 'PWA' },
    ],
  },
];

export type StackSelection = Record<StackCategory, string | string[] | undefined>;

/**
 * Two stack-selection modes:
 *   - 'auto'   (default): the user has NOT touched the picker. The pipeline
 *              chooses the stack from the prompt. We do NOT inject any
 *              hardcoded stack instructions.
 *   - 'manual': the user explicitly opened the picker and selected values.
 *              We send those values as a hard override that the pipeline
 *              MUST honour for spec, builder, validator, and preview.
 *
 * Backward safety: if a stored value is missing `mode`, treat it as 'auto'
 * unless the selection contains at least one explicit pick.
 */
export type StackSelectionMode = 'auto' | 'manual';

export interface StackPickerValue {
  mode: StackSelectionMode;
  selection: StackSelection;
}

/** Default = AUTO mode with an empty selection — nothing preselected. */
export function defaultPickerValue(): StackPickerValue {
  return { mode: 'auto', selection: {} as StackSelection };
}

/**
 * Migrate a legacy `StackSelection` (or undefined) to the new shape. If any
 * pick is non-empty we treat it as 'manual'; otherwise 'auto'.
 */
export function asPickerValue(
  v: StackPickerValue | StackSelection | undefined | null,
): StackPickerValue {
  if (!v) return defaultPickerValue();
  if (typeof v === 'object' && 'mode' in v && 'selection' in v) {
    return { mode: v.mode === 'manual' ? 'manual' : 'auto', selection: v.selection ?? ({} as StackSelection) };
  }
  const sel = v as StackSelection;
  const hasAny = Object.values(sel).some((x) =>
    Array.isArray(x) ? x.length > 0 : Boolean(x),
  );
  return { mode: hasAny ? 'manual' : 'auto', selection: sel };
}

/**
 * Empty selection — nothing chosen. This is what we render when the picker
 * is in 'auto' mode (the new default) so we never show preselected chips.
 */
export function emptySelection(): StackSelection {
  return {} as StackSelection;
}

/**
 * Legacy "all recommended" selection. Kept for callers that explicitly want
 * the old behaviour (e.g. tests). No longer used as the picker default.
 */
export function defaultSelection(): StackSelection {
  const out = {} as StackSelection;
  for (const g of STACK_GROUPS) {
    const rec = g.options.find((o) => o.recommended);
    if (g.multi) {
      out[g.id] = g.options.filter((o) => o.recommended).map((o) => o.id);
    } else {
      out[g.id] = rec?.id;
    }
  }
  return out;
}

/** True when the user has picked at least one option in any group. */
export function isManualSelection(sel: StackSelection): boolean {
  return Object.values(sel).some((v) =>
    Array.isArray(v) ? v.length > 0 : Boolean(v),
  );
}

export function selectionToPromptPrefix(sel: StackSelection): string {
  const lines: string[] = [];
  for (const g of STACK_GROUPS) {
    const v = sel[g.id];
    if (!v || (Array.isArray(v) && v.length === 0)) continue;
    const ids = Array.isArray(v) ? v : [v];
    const labels = ids
      .map((id) => g.options.find((o) => o.id === id)?.label)
      .filter(Boolean);
    if (labels.length === 0) continue;
    lines.push(`- ${g.label}: ${labels.join(', ')}`);
  }
  if (lines.length === 0) return '';
  return [
    'Use exactly this technology stack — do not substitute:',
    ...lines,
    '',
    '---',
    '',
  ].join('\n');
}

export function selectionSummary(sel: StackSelection): string {
  const parts: string[] = [];
  const pick = (cat: StackCategory) => {
    const v = sel[cat];
    if (!v) return null;
    const id = Array.isArray(v) ? v[0] : v;
    const g = STACK_GROUPS.find((x) => x.id === cat);
    return g?.options.find((o) => o.id === id)?.label ?? null;
  };
  const fe = pick('meta') ?? pick('frontend');
  const be = pick('backend');
  const db = pick('database');
  if (fe) parts.push(fe);
  if (be) parts.push(be);
  if (db) parts.push(db);
  return parts.join(' · ') || 'Auto-select stack';
}

/**
 * Convert the user's selection into a structured techStack object that mirrors
 * the shape the spec agent emits. Sent to the API as
 * `preferences.techStackOverride` so the agents are forced to honour it.
 */
export function selectionToTechStack(sel: StackSelection): Record<string, string> {
  const labelOf = (cat: StackCategory): string | null => {
    const v = sel[cat];
    if (!v) return null;
    const ids = Array.isArray(v) ? v : [v];
    const g = STACK_GROUPS.find((x) => x.id === cat);
    if (!g) return null;
    const labels = ids
      .map((id) => g.options.find((o) => o.id === id)?.label)
      .filter((x): x is string => Boolean(x));
    return labels.length ? labels.join(' + ') : null;
  };

  const out: Record<string, string> = {};
  const fe  = labelOf('frontend');
  const meta = labelOf('meta');
  const lang = labelOf('language');
  const be  = labelOf('backend');
  const db  = labelOf('database');
  const orm = labelOf('orm');
  const auth = labelOf('auth');
  const styling = labelOf('styling');
  const state = labelOf('state');
  const queue = labelOf('queue');
  const storage = labelOf('storage');
  const realtime = labelOf('realtime');
  const ai = labelOf('ai');
  const testing = labelOf('testing');
  const deploy = labelOf('deploy');
  const mobile = labelOf('mobile');

  if (fe || meta) out.frontend = [meta, fe].filter(Boolean).join(' / ');
  if (be) out.backend = [be, lang].filter(Boolean).join(' on ');
  else if (lang) out.backend = lang;
  if (db) out.database = [db, orm].filter(Boolean).join(' + ');
  if (auth) out.auth = auth;
  if (styling) out.styling = styling;
  if (state) out.state = state;
  if (queue) out.queue = queue;
  if (storage) out.storage = storage;
  if (realtime) out.realtime = realtime;
  if (ai) out.ai = ai;
  if (testing) out.testing = testing;
  if (deploy) out.deployment = deploy;
  if (mobile) out.mobile = mobile;
  return out;
}
