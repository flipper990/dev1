// ─────────────────────────────────────────────────────────────
// Runtime preview validator + QA-loop auto-fix.
//
// Closes the user's spec:
//   "VALIDATION: after build, verify: app renders, no blank screen,
//    no runtime errors. If preview fails: send back to QA agent,
//    fix issues and rebuild."
//
// We do this WITHOUT a headless browser dep (Playwright pulls ~300MB of
// Chromium). The Docker preview already gives us:
//   • Container build/run logs (stdout+stderr, including dev-server compile
//     errors and React runtime errors).
//   • A real HTTP endpoint we can fetch through the reverse proxy.
//
// That is enough to detect the failure modes that actually happen in
// generated apps:
//   • Module-not-found / package-missing                 (compile log)
//   • Server/Client component misuse (Next App Router)   (compile log)
//   • TypeScript syntax errors                           (compile log)
//   • 5xx response on the index page                     (HTTP probe)
//   • Blank DOM (body has no rendered content)           (HTTP probe)
//   • Runtime React errors leaking to SSR                (HTTP probe text)
//
// The output is a small set of "issue lines" suitable for feeding back to
// the QA/builder agents as a refinement prompt.
// ─────────────────────────────────────────────────────────────

import { createConnection } from 'node:net';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { PreviewManager } from '../preview/preview-manager.js';
import type { PreviewStatus } from '../preview/types.js';

export type ValidationVerdict = 'pass' | 'fail';

export interface ValidationIssue {
  category:
    | 'missing-module'
    | 'compile-error'
    | 'runtime-error'
    | 'http-error'
    | 'blank-dom'
    | 'docker'
    | 'api-error'
    | 'db-error'
    | 'integration-error'
    | 'route-missing'
    | 'unknown';
  message: string;
  /** Optional file path the issue points at, when extractable from logs. */
  hint?: string;
  /** Best-guess root cause (e.g. "postgres unreachable", "missing route handler"). */
  rootCause?: string;
}

export interface ValidationResult {
  verdict: ValidationVerdict;
  issues: ValidationIssue[];
  /** Final preview status from the manager (may be 'failed' or 'ready'). */
  preview: PreviewStatus | null;
  /** First ~2KB of the response body when we got one — useful for debugging. */
  bodySample?: string;
  /** Summary of the system checks run against a fullstack preview, if any. */
  systemChecks?: SystemCheckSummary;
  durationMs: number;
}

export interface SystemCheckSummary {
  frontend: { ok: boolean; status?: number; note?: string };
  backendHealth: { ok: boolean; status?: number; note?: string };
  database: { ok: boolean; note?: string };
  apiEndpoints: Array<{ id: string; method: string; path: string; status?: number; ok: boolean; note?: string }>;
  scenarios: Array<{ name: string; ok: boolean; steps: Array<{ step: string; ok: boolean; note?: string }> }>;
}

export interface ValidatorDeps {
  previewManager: PreviewManager;
  /** Base URL the API is listening on, e.g. `http://127.0.0.1:3003`. */
  apiBaseUrl: string;
  logger: Logger;
  /** Project spec (for apiContracts + userJourneys driven system checks). Optional. */
  spec?: Record<string, unknown>;
}

/**
 * Run a single validation pass: ensure preview is ready, fetch the index,
 * scan logs, and classify any issues.
 */
export async function validatePreview(projectId: string, deps: ValidatorDeps): Promise<ValidationResult> {
  const t0 = Date.now();
  const issues: ValidationIssue[] = [];

  // 1. Start (idempotent — returns existing record if already running).
  let status: PreviewStatus | null = null;
  try {
    status = await deps.previewManager.start(projectId);
  } catch (err) {
    return {
      verdict: 'fail',
      issues: [{ category: 'docker', message: err instanceof Error ? err.message : String(err) }],
      preview: null,
      durationMs: Date.now() - t0,
    };
  }

  // 2. Mine the build/runtime log for known signatures, regardless of state.
  if (status.log) {
    issues.push(...classifyLog(status.log));
  }

  // 3. If the manager says we never reached `ready`, we're done.
  if (status.state !== 'ready' || !status.url) {
    if (status.error && !issues.some((i) => i.message === status?.error)) {
      issues.push({ category: 'runtime-error', message: status.error });
    }
    return { verdict: 'fail', issues: dedupe(issues), preview: status, durationMs: Date.now() - t0 };
  }

  // 4. Fetch the index page through the API reverse proxy.
  const probeUrl = `${deps.apiBaseUrl}${status.url}`;
  const probe = await httpProbe(probeUrl, 15_000);

  if (probe.kind === 'error') {
    issues.push({ category: 'http-error', message: `Could not fetch ${probeUrl}: ${probe.message}` });
    return { verdict: 'fail', issues: dedupe(issues), preview: status, durationMs: Date.now() - t0 };
  }

  if (probe.status >= 500) {
    issues.push({ category: 'http-error', message: `Index page returned HTTP ${probe.status}` });
  }

  // 5. Blank-DOM check: only flag when the body genuinely has nothing — no
  //    visible text, no images/SVGs, no inputs/forms. A streaming Next.js
  //    page with just a "Loading…" spinner is a *valid* render, not blank.
  if (isBlankBody(probe.body)) {
    issues.push({
      category: 'blank-dom',
      message: 'Page rendered but the body has no visible content, images, or interactive elements.',
    });
  }

  // Re-scan body for inline error markers (Next dev overlay, React error #).
  issues.push(...classifyResponseBody(probe.body));

  // 6. After the HTTP probe, fetch the latest container log tail (compile
  //    errors that surfaced only on first request often only appear here).
  const refreshed = deps.previewManager.getStatus(projectId);
  if (refreshed?.log && refreshed.log.length > status.log.length) {
    issues.push(...classifyLog(refreshed.log.slice(status.log.length)));
  }

  // 7. Fullstack: run the full system-check suite against the running stack
  //    (frontend / backend / db / api endpoints / integration scenarios).
  let systemChecks: SystemCheckSummary | undefined;
  const apiHostPort = (refreshed ?? status).apiHostPort ?? null;
  if ((refreshed ?? status).stack === 'fullstack' && apiHostPort != null) {
    systemChecks = await runSystemChecks({
      projectId,
      webIndexStatus: probe.status,
      webBodyLooksValid: !isBlankBody(probe.body),
      apiBaseUrlForApiContainer: `http://127.0.0.1:${apiHostPort}`,
      spec: deps.spec,
      logFn: (msg) => deps.logger.info(msg, { projectId }),
    });
    issues.push(...issuesFromSystemChecks(systemChecks, refreshed?.log ?? status.log ?? ''));
  }

  const deduped = dedupe(issues);
  const verdict: ValidationVerdict = deduped.length === 0 ? 'pass' : 'fail';
  return {
    verdict,
    issues: deduped,
    preview: refreshed ?? status,
    bodySample: probe.body.slice(0, 2_000),
    systemChecks,
    durationMs: Date.now() - t0,
  };
}

/* ── log signature matching ─────────────────────────────────── */

function classifyLog(log: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  const seen = new Set<string>();
  const dedupe = (issue: ValidationIssue) => {
    const k = `${issue.category}:${issue.message}`;
    if (seen.has(k)) return;
    seen.add(k);
    out.push(issue);
  };

  // Module not found — Webpack / Node both emit this.
  for (const m of log.matchAll(/Cannot find module ['"]([^'"\n]+)['"]/g)) {
    dedupe({ category: 'missing-module', message: `Cannot find module '${m[1]}'`, hint: m[1] });
  }
  // Next.js / Webpack: `Module not found: Can't resolve 'X'`. We anchor
  // explicitly on `Can't resolve` first because the apostrophe inside `Can't`
  // would otherwise be matched as the opening quote of the specifier — that
  // produced bogus hints like `t resolve` in earlier runs.
  for (const m of log.matchAll(/Module not found:\s*(?:Error:\s*)?Can(?:'|’|&#39;)t resolve\s+['"]([^'"\n]{1,200})['"]/g)) {
    const spec = m[1].trim();
    if (!spec || /[\n\r]/.test(spec)) continue;
    dedupe({ category: 'missing-module', message: `Module not found: '${spec}'`, hint: spec });
  }
  // Generic `Module not found: '<spec>'` fallback (some bundlers emit this
  // form directly, without the `Can't resolve` preamble). Skip lines that
  // contain `Can't resolve` — those are handled above with stricter parsing.
  for (const m of log.matchAll(/Module not found:(?![^\n]*Can(?:'|’|&#39;)t resolve)[^\n]*?['"]([^'"\n]{1,200})['"]/g)) {
    const spec = m[1].trim();
    if (!spec || /[\n\r]/.test(spec)) continue;
    dedupe({ category: 'missing-module', message: `Module not found: '${spec}'`, hint: spec });
  }
  // Next.js client-component diagnostic (LLM frequently forgets "use client").
  if (/needs `useState`|needs `useEffect`|This React Hook only works in a Client Component/.test(log)) {
    dedupe({
      category: 'compile-error',
      message: 'A component imported `useState`/`useEffect` (or another client hook) but is missing the "use client" directive.',
    });
  }
  // Generic webpack/SWC compile errors (Next prefixes with " ⨯ ").
  for (const m of log.matchAll(/(?:^|\n)\s*[⨯✗×]\s+([^\n]{1,300})/g)) {
    const msg = m[1].trim();
    if (msg.length === 0) continue;
    if (msg.startsWith('Cannot find module')) continue; // already captured above
    if (msg.startsWith('Module not found')) continue; // already captured above
    dedupe({ category: 'compile-error', message: msg });
  }
  // Hard exit: container died on startup.
  if (/EADDRINUSE|ENOTFOUND|EACCES.*permission denied|docker:.+Error/i.test(log)) {
    const line = log.split(/\r?\n/).find((l) => /EADDRINUSE|ENOTFOUND|EACCES|docker:/i.test(l)) ?? '';
    if (line) dedupe({ category: 'docker', message: line.trim().slice(0, 300) });
  }
  return out;
}

function classifyResponseBody(body: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];
  // Next dev error overlay / "Internal Server Error" stub.
  if (/__next_error|Application error: a server-side exception has occurred/i.test(body)) {
    out.push({ category: 'runtime-error', message: 'Next.js dev server returned a server-side exception page.' });
  }
  if (/<h1[^>]*>\s*Internal Server Error\s*<\/h1>/i.test(body)) {
    out.push({ category: 'runtime-error', message: 'Server returned an "Internal Server Error" page.' });
  }
  // React invariant message embedded in a JSON error blob.
  for (const m of body.matchAll(/Minified React error #(\d+)/g)) {
    out.push({ category: 'runtime-error', message: `React invariant violation #${m[1]}` });
  }
  return out;
}

function stripNonContent(html: string): string {
  return html
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * A body is "blank" only when ALL of the following are true:
 *  - extracted visible text is shorter than 3 chars
 *  - body contains no <svg>, <img>, <video>, <canvas>, <iframe>
 *  - body contains no <button>, <input>, <a>, <form> (interactive)
 *
 * This avoids false positives on Next.js streaming RSC pages that only
 * show a "Loading…" spinner during initial paint — which is a valid render.
 */
function isBlankBody(html: string): boolean {
  const visible = stripNonContent(html);
  if (visible.length >= 3) return false;
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const body = bodyMatch ? bodyMatch[1] : html;
  if (/<(svg|img|video|canvas|iframe|button|input|a |form|select|textarea)\b/i.test(body)) return false;
  return true;
}

function dedupe(issues: ValidationIssue[]): ValidationIssue[] {
  const seen = new Set<string>();
  const out: ValidationIssue[] = [];
  for (const issue of issues) {
    const key = `${issue.category}::${issue.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out.slice(0, 25);
}

/* ── tiny http GET (avoid pulling fetch polyfills) ──────────── */

interface ProbeOk { kind: 'ok'; status: number; body: string }
interface ProbeErr { kind: 'error'; message: string }
type ProbeResult = ProbeOk | ProbeErr;

async function httpProbe(urlString: string, timeoutMs: number): Promise<ProbeResult> {
  // Use global fetch (Node 20 has it). AbortController for the timeout.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(urlString, {
      redirect: 'manual',
      signal: ctrl.signal,
      headers: { Accept: 'text/html,application/xhtml+xml' },
    });
    const body = await res.text();
    return { kind: 'ok', status: res.status, body };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

// Re-export so callers don't have to import from node:net for connectivity tests.
export { createConnection };

/* ── prompt synthesis for QA/builder feedback ───────────────── */

/**
 * Format issues into a fix-this-and-rebuild prompt suitable for handing
 * to ProjectUpdater. We keep it tight (~200-400 tokens) so the agents
 * actually focus on the failures.
 */
export function buildAutoFixPrompt(result: ValidationResult): string {
  const lines: string[] = [];
  lines.push('The previously generated app failed runtime/system validation. Fix the following issues so that:');
  lines.push('  • The Next.js / Vite dev server compiles without errors,');
  lines.push('  • The index page renders non-blank content,');
  lines.push('  • There are no runtime React errors,');
  lines.push('  • Backend /health responds 2xx and reports database connected,');
  lines.push('  • Every API endpoint declared in spec.apiContracts handles requests without 5xx,');
  lines.push('  • The auth and write-then-read integration scenarios complete end-to-end.');
  lines.push('');
  lines.push('Detected issues (with root cause when known):');
  for (const issue of result.issues) {
    const tag = `[${issue.category}]`;
    const hint = issue.hint ? ` (hint: ${issue.hint})` : '';
    const rc = issue.rootCause ? `\n      ROOT CAUSE: ${issue.rootCause}` : '';
    lines.push(`  - ${tag} ${issue.message}${hint}${rc}`);
  }
  if (result.systemChecks) {
    const s = result.systemChecks;
    lines.push('');
    lines.push('System check results:');
    lines.push(`  • frontend:        ${s.frontend.ok ? 'PASS' : 'FAIL'} (status=${s.frontend.status ?? 'n/a'}${s.frontend.note ? `, ${s.frontend.note}` : ''})`);
    lines.push(`  • backend /health: ${s.backendHealth.ok ? 'PASS' : 'FAIL'} (status=${s.backendHealth.status ?? 'n/a'}${s.backendHealth.note ? `, ${s.backendHealth.note}` : ''})`);
    lines.push(`  • database:        ${s.database.ok ? 'PASS' : 'FAIL'}${s.database.note ? ` (${s.database.note})` : ''}`);
    if (s.apiEndpoints.length > 0) {
      lines.push('  • api endpoints:');
      for (const ep of s.apiEndpoints) {
        lines.push(`      - ${ep.method.padEnd(6)} ${ep.path} → ${ep.ok ? 'PASS' : 'FAIL'}${ep.note ? ` (${ep.note})` : ''}`);
      }
    }
    if (s.scenarios.length > 0) {
      lines.push('  • integration scenarios:');
      for (const sc of s.scenarios) {
        lines.push(`      - ${sc.name}: ${sc.ok ? 'PASS' : 'FAIL'}`);
        for (const st of sc.steps) {
          lines.push(`          · ${st.step} → ${st.ok ? 'ok' : 'FAIL'}${st.note ? ` (${st.note})` : ''}`);
        }
      }
    }
  }
  lines.push('');
  lines.push('Rules:');
  lines.push('  • Add the "use client" directive to any file that uses React hooks (useState, useEffect, etc.) or browser-only APIs.');
  lines.push('  • If a module is missing, either add it to package.json with a real version or replace its usage with code that does not need it.');
  lines.push('  • If a route returns 404, register the missing handler on the Fastify server in apps/api/src/server.ts (or the router file it imports).');
  lines.push('  • If /health does not report db connectivity, return `{ status: "ok", db: "ok" }` after a successful Prisma `$queryRaw\\`SELECT 1\\``.');
  lines.push('  • If Prisma cannot connect, ensure DATABASE_URL points at the `postgres` compose service (host=postgres, port=5432) and that migrations run on api startup.');
  lines.push('  • If auth scenario fails, ensure register returns 201 with a token (or sets a session cookie) and login returns the same token shape.');
  lines.push('  • Keep all existing public component APIs and routes intact unless that is the source of the failure.');
  lines.push('  • Output the patched files in full — do not emit diffs.');
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
 * System-validator: runs against a live fullstack preview and
 * checks frontend / backend / db / api endpoints / integration
 * scenarios. Used to drive the QA auto-fix loop with concrete,
 * root-cause-tagged failures rather than surface symptoms.
 * ───────────────────────────────────────────────────────────── */

interface SystemCheckInput {
  projectId: string;
  webIndexStatus: number;
  webBodyLooksValid: boolean;
  /** URL the api container is reachable at from the host (e.g. http://127.0.0.1:54123). */
  apiBaseUrlForApiContainer: string;
  spec?: Record<string, unknown>;
  logFn: (msg: string) => void;
}

interface ApiContract {
  id: string;
  method: string;
  path: string;
  auth?: boolean;
  requestSchema?: Record<string, unknown>;
}

async function runSystemChecks(input: SystemCheckInput): Promise<SystemCheckSummary> {
  const apiBase = input.apiBaseUrlForApiContainer.replace(/\/+$/, '');
  const summary: SystemCheckSummary = {
    frontend: {
      ok: input.webIndexStatus < 500 && input.webBodyLooksValid,
      status: input.webIndexStatus,
      note: !input.webBodyLooksValid ? 'Body rendered blank' : undefined,
    },
    backendHealth: { ok: false },
    database: { ok: false },
    apiEndpoints: [],
    scenarios: [],
  };

  // ── 1. Backend /health probe (every fullstack scaffold ships /health) ──
  const health = await jsonProbe(`${apiBase}/health`, 'GET', undefined, undefined, 8_000);
  summary.backendHealth = {
    ok: health.kind === 'ok' && health.status >= 200 && health.status < 300,
    status: health.kind === 'ok' ? health.status : undefined,
    note: health.kind === 'error' ? health.message : (health.status >= 400 ? `HTTP ${health.status}` : undefined),
  };

  // ── 2. Database connection — inferred from /health body or an explicit /health/db route ──
  if (summary.backendHealth.ok && health.kind === 'ok') {
    // Try parsing common shapes: { db: 'ok' }, { database: { ok: true } }, etc.
    const dbState = inferDbState(health.body);
    if (dbState === 'ok') {
      summary.database = { ok: true };
    } else if (dbState === 'down') {
      summary.database = { ok: false, note: 'Backend /health reports database is down' };
    } else {
      // /health didn't report db status. Try /health/db, then fall through.
      const dbHealth = await jsonProbe(`${apiBase}/health/db`, 'GET', undefined, undefined, 5_000);
      if (dbHealth.kind === 'ok' && dbHealth.status < 400) {
        summary.database = { ok: true };
      } else {
        // No explicit signal — leave ok=false but mark unknown so we don't
        // raise a false alarm purely on "no /health/db endpoint".
        summary.database = { ok: false, note: 'No /health database signal — could not verify connection' };
      }
    }
  } else {
    summary.database = { ok: false, note: 'Backend unreachable; cannot verify database' };
  }

  // ── 3. API endpoints — probe every contract that's safely probeable ──
  const contracts = extractContracts(input.spec);
  for (const c of contracts) {
    // Only probe idempotent verbs without auth — POST/PUT/DELETE require
    // valid bodies + sessions, which we drive separately via scenarios.
    const isReadOnly = c.method === 'GET' || c.method === 'HEAD';
    const skipAuth = c.auth === true;
    if (!isReadOnly || skipAuth) {
      summary.apiEndpoints.push({
        id: c.id, method: c.method, path: c.path,
        ok: true,
        note: 'skipped (non-idempotent or auth-required — covered by scenarios)',
      });
      continue;
    }
    const url = `${apiBase}${c.path.startsWith('/') ? c.path : `/${c.path}`}`;
    const r = await jsonProbe(url, c.method, undefined, undefined, 8_000);
    if (r.kind === 'error') {
      summary.apiEndpoints.push({ id: c.id, method: c.method, path: c.path, ok: false, note: r.message });
    } else {
      const ok = r.status < 500 && r.status !== 404;
      summary.apiEndpoints.push({
        id: c.id, method: c.method, path: c.path, status: r.status, ok,
        note: !ok ? `HTTP ${r.status}` : undefined,
      });
    }
  }

  // ── 4. Integration scenarios (auth + create, read-after-write) ──
  if (summary.backendHealth.ok) {
    const scenarios = await runIntegrationScenarios(apiBase, contracts, input.logFn);
    summary.scenarios = scenarios;
  }

  return summary;
}

function extractContracts(spec: Record<string, unknown> | undefined): ApiContract[] {
  if (!spec || !Array.isArray(spec['apiContracts'])) return [];
  const raw = spec['apiContracts'] as unknown[];
  const out: ApiContract[] = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    const method = String(o['method'] ?? '').toUpperCase();
    const path = String(o['path'] ?? '');
    const id = String(o['id'] ?? `${method} ${path}`);
    if (!method || !path) continue;
    out.push({
      id, method, path,
      auth: o['auth'] === true,
      requestSchema: (o['requestSchema'] && typeof o['requestSchema'] === 'object')
        ? (o['requestSchema'] as Record<string, unknown>) : undefined,
    });
  }
  return out;
}

function inferDbState(body: string): 'ok' | 'down' | 'unknown' {
  let parsed: unknown;
  try { parsed = JSON.parse(body); } catch { return 'unknown'; }
  if (!parsed || typeof parsed !== 'object') return 'unknown';
  const o = parsed as Record<string, unknown>;
  // Common shapes shipped by our fullstack scaffold + frequent LLM variants.
  const candidates: unknown[] = [o['db'], o['database'], (o['checks'] as Record<string, unknown> | undefined)?.['db']];
  for (const c of candidates) {
    if (c == null) continue;
    if (typeof c === 'string') {
      const v = c.toLowerCase();
      if (v === 'ok' || v === 'up' || v === 'healthy' || v === 'connected') return 'ok';
      if (v === 'down' || v === 'error' || v === 'unhealthy' || v === 'disconnected') return 'down';
    }
    if (typeof c === 'boolean') return c ? 'ok' : 'down';
    if (typeof c === 'object') {
      const dbObj = c as Record<string, unknown>;
      if (dbObj['ok'] === true || dbObj['connected'] === true || dbObj['status'] === 'ok') return 'ok';
      if (dbObj['ok'] === false || dbObj['connected'] === false) return 'down';
    }
  }
  return 'unknown';
}

/**
 * End-to-end scenarios that simulate a user. Heuristically inferred from
 * apiContracts: if there's a register+login pair, run an auth flow; if
 * there's a "create X" + "list X" pair, run a write-then-read flow.
 */
async function runIntegrationScenarios(
  apiBase: string,
  contracts: ApiContract[],
  logFn: (msg: string) => void,
): Promise<SystemCheckSummary['scenarios']> {
  const out: SystemCheckSummary['scenarios'] = [];

  const findContract = (predicate: (c: ApiContract) => boolean): ApiContract | undefined => contracts.find(predicate);

  // Auth scenario: register → login → /me.
  const register = findContract((c) => c.method === 'POST' && /\b(register|signup|sign-up|users\.create)\b/i.test(`${c.id} ${c.path}`));
  const login    = findContract((c) => c.method === 'POST' && /\b(login|signin|sign-in|sessions\.create|auth\.login)\b/i.test(`${c.id} ${c.path}`));
  const me       = findContract((c) => c.method === 'GET'  && /\b(me|profile|users\.me|auth\.me|current[-_]?user)\b/i.test(`${c.id} ${c.path}`));

  if (register || login) {
    const steps: Array<{ step: string; ok: boolean; note?: string }> = [];
    let token: string | null = null;
    const email = `qa+${Date.now()}@dev1.local`;
    const password = 'P@ssword-${Date.now()}';

    if (register) {
      const r = await jsonProbe(`${apiBase}${register.path}`, register.method, { email, password, name: 'QA Bot' }, undefined, 10_000);
      const ok = r.kind === 'ok' && r.status < 400;
      steps.push({ step: `register (${register.method} ${register.path})`, ok, note: r.kind === 'ok' ? `HTTP ${r.status}` : r.message });
      if (ok && r.kind === 'ok') token = extractToken(r.body);
    }
    if (login) {
      const r = await jsonProbe(`${apiBase}${login.path}`, login.method, { email, password }, undefined, 10_000);
      const ok = r.kind === 'ok' && r.status < 400;
      steps.push({ step: `login (${login.method} ${login.path})`, ok, note: r.kind === 'ok' ? `HTTP ${r.status}` : r.message });
      if (ok && r.kind === 'ok' && !token) token = extractToken(r.body);
    }
    if (me && token) {
      const r = await jsonProbe(`${apiBase}${me.path}`, me.method, undefined, { Authorization: `Bearer ${token}` }, 8_000);
      const ok = r.kind === 'ok' && r.status >= 200 && r.status < 300;
      steps.push({ step: `whoami (${me.method} ${me.path})`, ok, note: r.kind === 'ok' ? `HTTP ${r.status}` : r.message });
    }
    out.push({ name: 'auth-flow', ok: steps.every((s) => s.ok), steps });
    logFn(`scenario auth-flow: ${steps.map((s) => `${s.step}=${s.ok ? 'ok' : 'FAIL'}`).join(', ')}`);
  }

  // Write-then-read scenario: find a (POST X, GET X) pair on the same base path.
  const creators = contracts.filter((c) => c.method === 'POST');
  for (const create of creators) {
    if (/\b(login|signin|signup|register|auth)\b/i.test(`${create.id} ${create.path}`)) continue;
    const basePath = create.path.replace(/\/+$/, '');
    const list = contracts.find((c) => c.method === 'GET' && c.path.replace(/\/+$/, '') === basePath);
    if (!list) continue;
    const steps: Array<{ step: string; ok: boolean; note?: string }> = [];
    const sample = sampleBodyFor(create);
    const r1 = await jsonProbe(`${apiBase}${create.path}`, 'POST', sample, undefined, 10_000);
    const ok1 = r1.kind === 'ok' && r1.status < 400;
    steps.push({ step: `create (POST ${create.path})`, ok: ok1, note: r1.kind === 'ok' ? `HTTP ${r1.status}` : r1.message });
    const r2 = await jsonProbe(`${apiBase}${list.path}`, 'GET', undefined, undefined, 8_000);
    const ok2 = r2.kind === 'ok' && r2.status >= 200 && r2.status < 300;
    steps.push({ step: `read-back (GET ${list.path})`, ok: ok2, note: r2.kind === 'ok' ? `HTTP ${r2.status}` : r2.message });
    out.push({ name: `write-then-read:${basePath}`, ok: ok1 && ok2, steps });
    logFn(`scenario write-then-read ${basePath}: create=${ok1 ? 'ok' : 'FAIL'}, read=${ok2 ? 'ok' : 'FAIL'}`);
    break; // one is enough to surface most regressions
  }

  return out;
}

function extractToken(body: string): string | null {
  try {
    const parsed = JSON.parse(body) as Record<string, unknown>;
    const cand = parsed['token'] ?? parsed['accessToken'] ?? parsed['access_token'] ?? parsed['jwt'];
    if (typeof cand === 'string' && cand.length > 0) return cand;
    const data = parsed['data'];
    if (data && typeof data === 'object') {
      const c2 = (data as Record<string, unknown>)['token'] ?? (data as Record<string, unknown>)['accessToken'];
      if (typeof c2 === 'string') return c2;
    }
  } catch { /* ignore */ }
  return null;
}

function sampleBodyFor(contract: ApiContract): Record<string, unknown> {
  // Best-effort sample: walk requestSchema and emit plausible values for
  // common types. Falls back to a generic { name, content } shape so the
  // probe still exercises validation + handler paths.
  const schema = contract.requestSchema;
  if (schema && typeof schema === 'object') {
    const props = (schema['properties'] && typeof schema['properties'] === 'object')
      ? (schema['properties'] as Record<string, unknown>) : null;
    if (props) {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(props)) {
        if (!v || typeof v !== 'object') continue;
        const t = (v as Record<string, unknown>)['type'];
        out[k] =
          t === 'number' || t === 'integer' ? 1 :
          t === 'boolean' ? true :
          t === 'array' ? [] :
          t === 'object' ? {} :
          k.toLowerCase().includes('email') ? `qa+${Date.now()}@dev1.local` :
          `qa-${k}-${Date.now()}`;
      }
      if (Object.keys(out).length > 0) return out;
    }
  }
  return { name: `qa-sample-${Date.now()}`, content: 'integration-test', title: 'QA' };
}

/** Convert system-check failures into ValidationIssues with root-cause hints. */
function issuesFromSystemChecks(s: SystemCheckSummary, log: string): ValidationIssue[] {
  const out: ValidationIssue[] = [];

  if (!s.frontend.ok) {
    out.push({
      category: 'http-error',
      message: `Frontend not serving: status=${s.frontend.status ?? 'n/a'} ${s.frontend.note ?? ''}`.trim(),
      rootCause: 'Web container not rendering the index page — check Next.js dev server compile log.',
    });
  }
  if (!s.backendHealth.ok) {
    out.push({
      category: 'api-error',
      message: `Backend /health failed: ${s.backendHealth.note ?? `status=${s.backendHealth.status ?? 'no response'}`}`,
      rootCause: inferBackendRootCause(log),
    });
  }
  if (!s.database.ok && s.backendHealth.ok) {
    out.push({
      category: 'db-error',
      message: s.database.note ?? 'Database connection check failed',
      rootCause: inferDbRootCause(log),
    });
  }
  for (const ep of s.apiEndpoints) {
    if (ep.ok) continue;
    if (ep.note?.startsWith('skipped')) continue;
    const cat: ValidationIssue['category'] = ep.status === 404 ? 'route-missing' : 'api-error';
    out.push({
      category: cat,
      message: `${ep.method} ${ep.path} (${ep.id}): ${ep.note ?? `HTTP ${ep.status}`}`,
      hint: ep.path,
      rootCause: cat === 'route-missing'
        ? 'Route handler is not registered on the Fastify server (or path mismatches spec).'
        : ep.status && ep.status >= 500 ? 'Server-side exception — see api logs above for stack trace.' : undefined,
    });
  }
  for (const sc of s.scenarios) {
    if (sc.ok) continue;
    const failedStep = sc.steps.find((st) => !st.ok);
    out.push({
      category: 'integration-error',
      message: `Scenario "${sc.name}" failed at step "${failedStep?.step ?? 'unknown'}": ${failedStep?.note ?? ''}`.trim(),
      rootCause: sc.name === 'auth-flow'
        ? 'Auth flow broken: register/login route is missing, returns non-2xx, or does not issue a token.'
        : 'Write-then-read flow broken: create returned non-2xx or read does not surface the new row (check Prisma migration + response shape).',
    });
  }
  return out;
}

function inferBackendRootCause(log: string): string | undefined {
  if (/listen EADDRINUSE/i.test(log)) return 'API port already in use inside container.';
  if (/Cannot find module ['"]@prisma\/client['"]/i.test(log)) return 'Prisma client was never generated — run `prisma generate` in api Dockerfile/postinstall.';
  if (/PrismaClientInitializationError/i.test(log)) return 'Prisma could not connect to postgres — check DATABASE_URL and that postgres service is healthy.';
  if (/SyntaxError|Unexpected token/i.test(log)) return 'API source has a syntax error — see api logs for the exact line.';
  if (/Error: connect ECONNREFUSED.*5432/i.test(log)) return 'API tried to connect to postgres before it was ready — add a depends_on healthcheck or retry loop.';
  if (/route .* not found|Route not found/i.test(log)) return 'A registered route did not match the path the client called.';
  return undefined;
}

function inferDbRootCause(log: string): string | undefined {
  if (/PrismaClientInitializationError|ECONNREFUSED.*5432/i.test(log)) return 'Postgres unreachable from api container at the configured DATABASE_URL.';
  if (/migration.*failed|Migration failed/i.test(log)) return 'Prisma migrations failed to apply — check schema.prisma for invalid types/relations.';
  if (/relation ".*" does not exist/i.test(log)) return 'Prisma schema and runtime queries are out of sync — migrate deploy did not run, or schema was edited without a new migration.';
  if (/password authentication failed/i.test(log)) return 'Postgres credentials in DATABASE_URL do not match the postgres service env.';
  return undefined;
}

/* ── richer JSON probe (supports method + headers + json body) ── */

interface JsonProbeOk { kind: 'ok'; status: number; body: string }
interface JsonProbeErr { kind: 'error'; message: string }
type JsonProbeResult = JsonProbeOk | JsonProbeErr;

async function jsonProbe(
  urlString: string,
  method: string,
  body: Record<string, unknown> | undefined,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<JsonProbeResult> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const init: RequestInit = {
      method,
      redirect: 'manual',
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(headers ?? {}),
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await fetch(urlString, init);
    const text = await res.text();
    return { kind: 'ok', status: res.status, body: text };
  } catch (err) {
    return { kind: 'error', message: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}
