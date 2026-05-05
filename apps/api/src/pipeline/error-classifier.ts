// ─────────────────────────────────────────────────────────────
// Error classifier for execution feedback.
//
// Takes raw stdout/stderr lines from npm install / build / dev and
// produces a structured `ClassifiedError` object with:
//   - one of five top-level categories
//   - a concrete sub-type (TS error code, package name, port number, etc.)
//   - a fix-hint targeted at the QA / Builder agent
//
// The classifier is deliberately conservative: when in doubt, it tags
// `category: 'unknown'` rather than guessing, so the agent still sees
// the raw message and can decide for itself.
//
// Categories (per user request):
//   1. dependency  — missing package, peer dep mismatch, install failure
//   2. build       — TypeScript, syntax, JSX/TSX, compile failure
//   3. runtime     — uncaught exception in dev server (TypeError, etc.)
//   4. port        — EADDRINUSE, EACCES on bind, port conflict
//   5. api         — HTTP probe returned non-2xx / blank / timeout
// ─────────────────────────────────────────────────────────────

import type { ExecutionValidationResult, HttpProbeResult } from './execution-runner.js';

export type ErrorCategory =
  | 'dependency'
  | 'build'
  | 'runtime'
  | 'port'
  | 'api'
  | 'unknown';

export type ErrorSubtype =
  // dependency
  | 'missing-module' | 'peer-mismatch' | 'install-failure' | 'lockfile-mismatch'
  // build
  | 'typescript' | 'syntax' | 'jsx' | 'compile' | 'config'
  // runtime
  | 'type-error' | 'reference-error' | 'range-error' | 'unhandled-rejection' | 'crash'
  // port
  | 'port-in-use' | 'port-permission' | 'port-bind-failure'
  // api
  | 'http-status' | 'blank-page' | 'missing-markers' | 'http-timeout' | 'connection-refused'
  // catch-all
  | 'unclassified';

export interface ClassifiedError {
  category: ErrorCategory;
  subtype: ErrorSubtype;
  /** A 1-line summary suitable for log display. */
  message: string;
  /** Stable category key for `runtimeFeedback.issues[].category` (e.g. "build:typescript:TS2304"). */
  tag: string;
  /** Human-readable hint to help the agent pick a fix strategy. */
  hint: string;
  /** The raw line we classified, capped to 400 chars for prompt sanity. */
  raw: string;
  /** Severity (informational; everything making it here is non-fatal-to-classify). */
  severity: 'fatal' | 'error' | 'warn';
  /** Structured details extracted from the line. All fields optional. */
  details: {
    code?: string;          // e.g. 'TS2304', 'MODULE_NOT_FOUND'
    packageName?: string;   // 'react-router', '@types/node'
    file?: string;          // 'src/app/page.tsx'
    line?: number;
    column?: number;
    port?: number;
    httpStatus?: number;
    httpRoute?: string;
  };
}

const truncate = (s: string, n = 400): string => (s.length > n ? `${s.slice(0, n)}\u2026` : s);

/** Strip ANSI colour codes which sometimes leak through CI envs. */
const stripAnsi = (s: string): string => s.replace(/\u001B\[[0-9;]*m/g, '');

/* ────────────────────────────── Build-error patterns ───────────────────────── */

/**
 * TypeScript diagnostic line:
 *   "src/app/page.tsx:12:5 - error TS2304: Cannot find name 'foo'."
 *   "src/app/page.tsx(12,5): error TS2304: Cannot find name 'foo'."
 */
const TS_DIAGNOSTIC = /^([^\s:()]+\.[tj]sx?)[:(](\d+)[,:](\d+)\)?[\s-]*error\s+(TS\d{3,5}):\s*(.+)$/i;

/** Plain TS error code anywhere in the line, e.g. "TS2552". */
const TS_CODE_ANYWHERE = /\bTS(\d{3,5})\b/;

/** Vite/Webpack syntax error: "SyntaxError: Unexpected token (3:5)" */
const SYNTAX_ERROR = /SyntaxError:\s*(.+)/i;

/* ────────────────────────────── Dependency patterns ───────────────────────── */

const CANNOT_FIND_MODULE = /Cannot\s+find\s+module\s+["']([^"']+)["']/i;
const MODULE_NOT_FOUND   = /Module\s+not\s+found:?\s*(?:Error:\s*)?Can(?:'t|not)\s+resolve\s+["']([^"']+)["']/i;
const PEER_DEP           = /(unmet\s+peer|peer\s+dep(?:endenc(?:y|ies))?\s+(?:not\s+)?(?:satisfied|missing)|ERESOLVE)/i;
const NPM_INSTALL_ERR    = /^npm\s+(?:ERR!|error)\s+(.+)/i;
const LOCKFILE_OUT_OF_SYNC = /(lockfile|pnpm-lock|package-lock).*(?:out\s*of\s*sync|frozen|mismatch)/i;

/* ────────────────────────────── Runtime patterns ──────────────────────────── */

const TYPE_ERROR      = /^(?:Uncaught\s+)?TypeError:\s*(.+)/i;
const REFERENCE_ERROR = /^(?:Uncaught\s+)?ReferenceError:\s*(.+)/i;
const RANGE_ERROR     = /^(?:Uncaught\s+)?RangeError:\s*(.+)/i;
const UNHANDLED_REJ   = /Unhandled\s+(?:promise\s+)?rejection/i;
const NODE_INTERNAL   = /Error\s*\[ERR_[A-Z_]+]:/;

/* ────────────────────────────── Port patterns ─────────────────────────────── */

const EADDRINUSE = /EADDRINUSE.*?(?:port\s+|:\s*|address\s+already\s+in\s+use[^0-9]+)(\d{2,5})/i;
const EADDRINUSE_FALLBACK = /\bEADDRINUSE\b/i;
const EACCES_PORT = /EACCES.*?(?:port|bind).*?(\d{2,5})?/i;

/* ────────────────────────────── Top-level classifier ──────────────────────── */

/**
 * Classify a single raw error line.
 */
export function classifyError(rawLine: string): ClassifiedError {
  const raw = stripAnsi(rawLine).trim();
  const line = raw;

  // ── 1. Build / TypeScript ────────────────────────────────────
  const tsm = line.match(TS_DIAGNOSTIC);
  if (tsm) {
    const [, file, ln, col, code, msg] = tsm;
    return {
      category: 'build',
      subtype: 'typescript',
      message: `${code}: ${msg}`,
      tag: `build:typescript:${code}`,
      hint: `TypeScript ${code} at ${file}:${ln}:${col}. Read the diagnostic, then fix the type/name in that file. Do not silence the error with @ts-ignore.`,
      raw: truncate(raw),
      severity: 'error',
      details: { code, file, line: Number(ln), column: Number(col) },
    };
  }
  const tsCode = line.match(TS_CODE_ANYWHERE);
  if (tsCode && /error\s+TS/i.test(line)) {
    const code = `TS${tsCode[1]}`;
    return {
      category: 'build',
      subtype: 'typescript',
      message: line,
      tag: `build:typescript:${code}`,
      hint: `TypeScript ${code}. Fix the underlying type problem in the offending file.`,
      raw: truncate(raw),
      severity: 'error',
      details: { code },
    };
  }
  const sym = line.match(SYNTAX_ERROR);
  if (sym) {
    return {
      category: 'build',
      subtype: 'syntax',
      message: `SyntaxError: ${sym[1]}`,
      tag: 'build:syntax',
      hint: 'Syntax error in the source. Re-check brackets, JSX tags, and import/export statements.',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }
  if (/jsx\s+expressions?|adjacent\s+JSX|expected\s+corresponding\s+JSX/i.test(line)) {
    return {
      category: 'build',
      subtype: 'jsx',
      message: line,
      tag: 'build:jsx',
      hint: 'JSX structure is invalid. Wrap siblings in a fragment <> ... </> or single parent element.',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }
  if (/failed\s+to\s+compile|build\s+failed|compilation\s+failed/i.test(line)) {
    return {
      category: 'build',
      subtype: 'compile',
      message: line,
      tag: 'build:compile',
      hint: 'Compilation failed. Check earlier lines for the underlying TypeScript / module-resolution / config issue and fix that first.',
      raw: truncate(raw),
      severity: 'fatal',
      details: {},
    };
  }
  if (/(tsconfig|next\.config|vite\.config|tailwind\.config)\.?[a-z]*\s*[:.]?\s*(error|invalid|missing)/i.test(line)) {
    return {
      category: 'build',
      subtype: 'config',
      message: line,
      tag: 'build:config',
      hint: 'A build-config file is wrong or missing a field. Re-emit the config so it matches the framework defaults.',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }

  // ── 2. Dependency ────────────────────────────────────────────
  const cfm = line.match(CANNOT_FIND_MODULE);
  const mnf = line.match(MODULE_NOT_FOUND);
  const missingModule = cfm?.[1] ?? mnf?.[1] ?? null;
  if (missingModule) {
    const isRelative = missingModule.startsWith('.') || missingModule.startsWith('/');
    return {
      category: 'dependency',
      subtype: isRelative ? 'missing-module' : 'missing-module',
      message: `Cannot find module "${missingModule}"`,
      tag: `dependency:missing-module:${missingModule}`,
      hint: isRelative
        ? `The relative import "${missingModule}" does not resolve. Either CREATE the file at that path, or correct the import to point to an existing file.`
        : `The package "${missingModule}" is imported but not declared in package.json.dependencies. ADD it to dependencies (do NOT use devDependencies for runtime imports).`,
      raw: truncate(raw),
      severity: 'fatal',
      details: { packageName: missingModule },
    };
  }
  if (PEER_DEP.test(line)) {
    return {
      category: 'dependency',
      subtype: 'peer-mismatch',
      message: line,
      tag: 'dependency:peer-mismatch',
      hint: 'Peer dependency conflict. Adjust the version of the offending package in package.json so it matches the peer requirement, or pick a single major version of the framework.',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }
  if (LOCKFILE_OUT_OF_SYNC.test(line)) {
    return {
      category: 'dependency',
      subtype: 'lockfile-mismatch',
      message: line,
      tag: 'dependency:lockfile-mismatch',
      hint: 'Lockfile is out of sync with package.json. Remove the lockfile from the generated output (the runner regenerates it).',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }
  if (NPM_INSTALL_ERR.test(line)) {
    return {
      category: 'dependency',
      subtype: 'install-failure',
      message: line,
      tag: 'dependency:install-failure',
      hint: 'npm install failed. Check that every package in dependencies + devDependencies exists on the npm registry and uses a valid semver range.',
      raw: truncate(raw),
      severity: 'fatal',
      details: {},
    };
  }

  // ── 3. Port ──────────────────────────────────────────────────
  const eaim = line.match(EADDRINUSE);
  if (eaim || EADDRINUSE_FALLBACK.test(line)) {
    const port = eaim ? Number(eaim[1]) : undefined;
    return {
      category: 'port',
      subtype: 'port-in-use',
      message: port ? `Port ${port} is already in use` : 'Port already in use',
      tag: port ? `port:in-use:${port}` : 'port:in-use',
      hint: 'The dev server attempted to bind to a port that is occupied. Read the PORT env var instead of hardcoding a port — for Next.js use `next dev --port $PORT`, for Vite use `vite --port $PORT`. Do not hardcode 3000/4000/5173.',
      raw: truncate(raw),
      severity: 'fatal',
      details: port ? { port } : {},
    };
  }
  const eapm = line.match(EACCES_PORT);
  if (eapm) {
    const port = eapm[1] ? Number(eapm[1]) : undefined;
    return {
      category: 'port',
      subtype: 'port-permission',
      message: line,
      tag: port ? `port:permission:${port}` : 'port:permission',
      hint: 'Cannot bind to a privileged port. Use a port >= 1024 (the runner injects $PORT — read it from process.env).',
      raw: truncate(raw),
      severity: 'fatal',
      details: port ? { port } : {},
    };
  }

  // ── 4. Runtime ───────────────────────────────────────────────
  const tem = line.match(TYPE_ERROR);
  if (tem) {
    return {
      category: 'runtime',
      subtype: 'type-error',
      message: `TypeError: ${tem[1]}`,
      tag: 'runtime:type-error',
      hint: 'A value was undefined/null when something else was expected at runtime. Add a guard, default value, or fix the upstream code that produces the value.',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }
  const rem = line.match(REFERENCE_ERROR);
  if (rem) {
    return {
      category: 'runtime',
      subtype: 'reference-error',
      message: `ReferenceError: ${rem[1]}`,
      tag: 'runtime:reference-error',
      hint: 'An identifier is used before declaration or is missing entirely. Add the import or declaration.',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }
  const ranm = line.match(RANGE_ERROR);
  if (ranm) {
    return {
      category: 'runtime',
      subtype: 'range-error',
      message: `RangeError: ${ranm[1]}`,
      tag: 'runtime:range-error',
      hint: 'A numeric / array operation went out of bounds. Validate inputs and add boundary checks.',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }
  if (UNHANDLED_REJ.test(line)) {
    return {
      category: 'runtime',
      subtype: 'unhandled-rejection',
      message: line,
      tag: 'runtime:unhandled-rejection',
      hint: 'A promise was rejected but never caught. Add a .catch / try-catch to the awaiting code path and surface the error properly.',
      raw: truncate(raw),
      severity: 'error',
      details: {},
    };
  }
  if (NODE_INTERNAL.test(line)) {
    return {
      category: 'runtime',
      subtype: 'crash',
      message: line,
      tag: 'runtime:crash',
      hint: 'Node-level error. Inspect the ERR_* code and address the failing API call.',
      raw: truncate(raw),
      severity: 'fatal',
      details: {},
    };
  }

  // ── Default ──────────────────────────────────────────────────
  return {
    category: 'unknown',
    subtype: 'unclassified',
    message: line,
    tag: 'unknown',
    hint: 'No specific classifier matched. Read the raw output and apply best judgement.',
    raw: truncate(raw),
    severity: 'error',
    details: {},
  };
}

/**
 * Classify an HTTP probe failure. Always returns category 'api'.
 */
export function classifyHttpProbe(probe: HttpProbeResult): ClassifiedError {
  const route = probe.path;
  const status = probe.status;
  const err = probe.error ?? '';

  let subtype: ErrorSubtype = 'http-status';
  let hint = 'The route returned a non-2xx status. Check that the page component renders without throwing.';
  let tag = `api:http-status:${status ?? 'null'}`;
  let message = `${route} returned status=${status ?? 'no response'} body=${probe.bodyBytes}B`;

  if (err.includes('blank') || /blank\s+page/i.test(err)) {
    subtype = 'blank-page';
    tag = 'api:blank-page';
    hint = 'The dev server returned an empty/whitespace-only body. The page component is not rendering markup — make sure it returns JSX (not just "Loading..." or null) and that client/server-component boundaries are correct.';
    message = `${route} rendered a blank page (body=${probe.bodyBytes}B)`;
  } else if (/missing\s+(required\s+)?markers/i.test(err)) {
    subtype = 'missing-markers';
    tag = 'api:missing-markers';
    hint = 'The HTML is non-empty but does not contain the expected root element (<html>/<body>/<div>/<main>/#root/#__next/#app). Make sure the layout actually wraps children.';
    message = `${route} HTML is missing required markers`;
  } else if (/timed\s+out/i.test(err)) {
    subtype = 'http-timeout';
    tag = 'api:http-timeout';
    hint = 'The request took too long. The route is probably blocking on a slow server-side fetch — add a timeout, or move the call to client-side useEffect with a loading state.';
    message = `${route} request timed out`;
  } else if (/did\s+not\s+accept\s+connections|ECONNREFUSED/i.test(err)) {
    subtype = 'connection-refused';
    tag = 'api:connection-refused';
    hint = 'The dev server reported ready but the TCP socket refused connection. The server may be binding to the wrong host — bind to 127.0.0.1 or 0.0.0.0, not "localhost" only, and read the PORT env var.';
    message = `${route} connection refused`;
  } else if (typeof status === 'number' && status >= 500) {
    tag = `api:http-status:${status}`;
    hint = `The route threw a 5xx. Read the dev-server logs (above) for the underlying exception and fix the failing handler/component.`;
  } else if (typeof status === 'number' && status >= 400) {
    tag = `api:http-status:${status}`;
    hint = `The route returned a client error (${status}). Likely a missing route file or wrong path — verify app/${route.replace(/^\//, '')}/page.tsx exists.`;
  }

  return {
    category: 'api',
    subtype,
    message,
    tag,
    hint,
    raw: truncate(`${route}: ${err || `status=${status}`}`),
    severity: 'error',
    details: {
      httpRoute: route,
      httpStatus: status ?? undefined,
    },
  };
}

/**
 * Classify everything in an `ExecutionValidationResult`. Build/runtime errors
 * pass through `classifyError`; HTTP probe failures pass through
 * `classifyHttpProbe`.
 */
export function classifyExecutionResult(result: ExecutionValidationResult): ClassifiedError[] {
  const out: ClassifiedError[] = [];

  for (const e of result.buildErrors) {
    const c = classifyError(e);
    // If we landed in 'unknown' for a buildError line, force it to 'build'
    // so the agent at least has the right top-level category.
    if (c.category === 'unknown') {
      out.push({ ...c, category: 'build', tag: c.tag === 'unknown' ? 'build:unclassified' : c.tag });
    } else {
      out.push(c);
    }
  }
  for (const e of result.runtimeErrors) {
    const c = classifyError(e);
    if (c.category === 'unknown') {
      out.push({ ...c, category: 'runtime', tag: c.tag === 'unknown' ? 'runtime:unclassified' : c.tag });
    } else {
      out.push(c);
    }
  }
  for (const p of result.httpProbes) {
    if (!p.ok) out.push(classifyHttpProbe(p));
  }

  return out;
}

/**
 * Group a list of classified errors by top-level category. Useful for
 * building per-category sections in the agent prompt.
 */
export function groupByCategory(errors: ClassifiedError[]): Record<ErrorCategory, ClassifiedError[]> {
  const out: Record<ErrorCategory, ClassifiedError[]> = {
    dependency: [], build: [], runtime: [], port: [], api: [], unknown: [],
  };
  for (const e of errors) out[e.category].push(e);
  return out;
}

/**
 * Pick the most pressing category — used to drive prompt phrasing.
 * Order: port (blocks startup) → dependency (blocks install) →
 *        build (blocks compile) → runtime → api → unknown.
 */
export function dominantCategory(errors: ClassifiedError[]): ErrorCategory {
  const order: ErrorCategory[] = ['port', 'dependency', 'build', 'runtime', 'api', 'unknown'];
  for (const cat of order) {
    if (errors.some((e) => e.category === cat)) return cat;
  }
  return 'unknown';
}
