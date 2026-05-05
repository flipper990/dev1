// ─────────────────────────────────────────────────────────────
// Dev Dockerfiles per stack — overrides any Dockerfile the
// LLM may have produced. Optimised for fast preview iteration:
//   • single stage, no production build, no nginx
//   • bind-style copy of source (we COPY in the orchestrator)
//   • npm install with --no-audit --no-fund for speed
//   • binds dev server to 0.0.0.0 so the host can reach it
// ─────────────────────────────────────────────────────────────

import type { StackInfo, StackKind } from './types.js';

const NODE_BASE = 'node:20-alpine';

/** Generate the Dockerfile body for the given stack. */
export function getDockerfile(stack: StackInfo): string {
  const baseLines = [
    `FROM ${NODE_BASE}`,
    'WORKDIR /app',
    '# Avoid prompts and speed up installs',
    'ENV CI=1 NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false NEXT_TELEMETRY_DISABLED=1',
    '# Copy lockfiles first for better cache hits',
    'COPY package*.json ./',
    // Use --legacy-peer-deps because LLM-generated package.json files often pin React 19 stable
    // against older Next/peer ranges (and similar mismatches) that npm 10 rejects by default.
    'RUN if [ -f package-lock.json ]; then npm ci --legacy-peer-deps --no-audit --no-fund || npm install --legacy-peer-deps --no-audit --no-fund; else npm install --legacy-peer-deps --no-audit --no-fund; fi',
    '# Copy the rest of the project',
    'COPY . .',
    `EXPOSE ${stack.port}`,
  ];

  switch (stack.kind) {
    case 'nextjs':
      return [
        ...baseLines,
        // Belt-and-braces: ensure Next.js's mandatory peer/build-time deps are
        // present even when the LLM-generated package.json forgot them.
        // Doing this at build time keeps boot fast.
        'RUN npm install --legacy-peer-deps --no-audit --no-fund --no-save typescript @types/react @types/node autoprefixer postcss tailwindcss >/dev/null 2>&1 || true',
        // Force host binding so the proxy can reach it
        `CMD ["sh", "-c", "${nextDevCommand()}"]`,
      ].join('\n');

    case 'vite-react':
      return [
        ...baseLines,
        `CMD ["sh", "-c", "${viteDevCommand(stack.port)}"]`,
      ].join('\n');

    case 'plain-react':
      // Serve index.html via npx serve. No build step.
      return [
        ...baseLines,
        // npm install already happened — also pre-install serve so we don't hit the network at run time
        'RUN npm install --legacy-peer-deps --no-save --no-audit --no-fund serve@14',
        `CMD ["npx", "serve", "-s", ".", "-l", "${stack.port}", "--no-clipboard"]`,
      ].join('\n');

    case 'node-express':
      return [
        ...baseLines,
        `ENV PORT=${stack.port}`,
        `CMD ["sh", "-c", "${nodeServerCommand(stack)}"]`,
      ].join('\n');

    case 'unknown':
    default:
      // Should never get here — caller guards on isRunnableStack — but emit
      // something predictable so docker build doesn't fail with a weird error.
      return [
        ...baseLines,
        `CMD ["sh", "-c", "echo 'Unknown stack — no dev command' && sleep 5 && exit 1"]`,
      ].join('\n');
  }
}

/* ── Per-stack command helpers ───────────────────────────── */

function nextDevCommand(): string {
  // Prefer "npm run dev" if defined, but force -H 0.0.0.0 so it binds outside loopback.
  // If the LLM-produced dev script doesn't pass the flag, the env var NEXT_HOSTNAME
  // doesn't exist; the safest bet is to call next directly with -H.
  //
  // Also: LLM-generated package.json files for Next 15 frequently forget to
  // include @types/react / @types/node / typescript even though they ship a
  // tsconfig.json. Next dev refuses to boot in that case ("It looks like
  // you're trying to use TypeScript but do not have the required package(s)
  // installed."). Install them on the fly when a tsconfig is present so the
  // dev server can come up. Idempotent if already present.
  // Same story for autoprefixer/postcss when a postcss.config.* exists but the
  // deps are missing — Next's CSS pipeline crashes with "Cannot find module 'autoprefixer'".
  const ensureTsDeps = "if [ -f tsconfig.json ] && [ ! -d node_modules/@types/react ]; then npm install --legacy-peer-deps --no-audit --no-fund --no-save typescript @types/react @types/node >/dev/null 2>&1 || true; fi;";
  const ensurePostcssDeps = "if ls postcss.config.* >/dev/null 2>&1 && [ ! -d node_modules/autoprefixer ]; then npm install --legacy-peer-deps --no-audit --no-fund --no-save autoprefixer postcss >/dev/null 2>&1 || true; fi;";
  return [
    ensureTsDeps,
    ensurePostcssDeps,
    'if [ -f node_modules/.bin/next ]; then',
    'node_modules/.bin/next dev -H 0.0.0.0 -p 3000;',
    'else npm run dev -- -H 0.0.0.0 -p 3000;',
    'fi',
  ].join(' ');
}

function viteDevCommand(port: number): string {
  // Force --host so dev server is reachable from the docker host.
  return [
    'if [ -f node_modules/.bin/vite ]; then',
    `node_modules/.bin/vite --host 0.0.0.0 --port ${port};`,
    `else npm run dev -- --host 0.0.0.0 --port ${port};`,
    'fi',
  ].join(' ');
}

function nodeServerCommand(_stack: StackInfo): string {
  // Try common entry points in order of preference, falling back to npm run dev.
  // tsx is shipped via npx so .ts entries work without a build step.
  return [
    'if [ -f src/server.ts ]; then npx -y tsx src/server.ts;',
    'elif [ -f server.ts ]; then npx -y tsx server.ts;',
    'elif [ -f src/server.js ]; then node src/server.js;',
    'elif [ -f server.js ]; then node server.js;',
    'elif [ -f src/index.ts ]; then npx -y tsx src/index.ts;',
    'elif [ -f src/index.js ]; then node src/index.js;',
    'else npm run dev;',
    'fi',
  ].join(' ');
}

/** Default expected dev-server boot wait per stack (ms). */
export function bootBudgetMs(kind: StackKind): number {
  switch (kind) {
    case 'nextjs':       return 90_000;  // big install + first compile
    case 'vite-react':   return 60_000;
    case 'plain-react':  return 20_000;
    case 'node-express': return 45_000;
    case 'fullstack':    return 240_000; // postgres + api migrate + web compile
    default:             return 30_000;
  }
}
