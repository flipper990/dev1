// ─────────────────────────────────────────────────────────────
// Preview content-health probe.
//
// A dev server can be REACHABLE (HTTP 200/500 from awaitHealthy) and
// still be useless to the user — Next.js, Vite and CRA all serve a
// development error overlay on a working HTTP response when the app
// itself fails to compile or hydrate. Marking such a preview "ready"
// produces the bug captured in the platform spec:
//
//     iframe shows "Module not found: Can't resolve 'class-variance-
//     authority'" while previewStatus = ready
//
// This module exposes two pieces:
//
//   1. detectDevOverlay(html)  — pure scanner. Given a response body
//      (HTML or JSON), returns the first dev-overlay error it finds
//      with `detectedErrorType`, `detectedErrorMessage` and (when the
//      pattern carries one) `affectedModule`. Pure / no IO so it's
//      easy to unit-test.
//
//   2. probePreviewContent(...) — performs an HTTP GET against the
//      running dev server, caps the body at 256 KB, and feeds it
//      through `detectDevOverlay`. Used by PreviewManager's
//      readiness gate before any markPreviewStep('ready', …) call.
//
// Adding indicators here is cheap and centralised — every preview
// backend (docker, local, fullstack) calls into the same scanner.
// ─────────────────────────────────────────────────────────────

import { request as httpRequest } from 'node:http';

/** Maximum response body we keep in memory while scanning. The Next.js
 *  dev overlay payload fits in ~30 KB; a 256 KB cap leaves headroom for
 *  larger bundlers (Vite source-mapped overlays) without inviting a DoS
 *  via an attacker-controlled dev server. */
const MAX_BODY_BYTES = 256 * 1024;

/** Result of `detectDevOverlay`. `null` when the body is healthy. */
export interface DevOverlayDetection {
  /** Human-readable category. Stable enum strings — used as a router
   *  key in the UI failure card and in the integrity-runner postmortem. */
  detectedErrorType:
    | 'module-not-found'
    | 'cannot-resolve'
    | 'build-error'
    | 'unhandled-runtime-error'
    | 'application-error'
    | 'hydration-failed'
    | 'chunk-load-error'
    | 'nextjs-dev-overlay';
  /** First line of the overlay error message (≤512 chars). */
  detectedErrorMessage: string;
  /** Module specifier extracted from "Can't resolve 'X'" / "Module not
   *  found: 'X'" patterns, when present. Absent for runtime-only
   *  overlays (hydration, generic chunk-load). */
  affectedModule?: string;
}

/** Pattern table. Order matters — the first match wins, so place the
 *  most specific patterns first. Each entry returns a `DevOverlayDetection`
 *  builder so the caller can capture groups (module names) cleanly. */
const DETECTORS: ReadonlyArray<{
  name: DevOverlayDetection['detectedErrorType'];
  re: RegExp;
  /** Build the detection from a regex match. */
  build: (m: RegExpMatchArray, raw: string) => DevOverlayDetection;
}> = [
  // "Module not found: Can't resolve 'X'"  (Next.js / webpack)
  // "Module not found: Error: Can't resolve 'X' in '/app'"
  {
    name: 'module-not-found',
    re: /Module not found:?\s*(?:Error:?\s*)?Can'?t resolve\s+['"`]([^'"`]+)['"`]/i,
    build: (m) => ({
      detectedErrorType: 'module-not-found',
      detectedErrorMessage: trimMessage(m[0]),
      affectedModule: m[1],
    }),
  },
  // Bare "Cannot resolve 'X'"  (Vite / esbuild / generic)
  {
    name: 'cannot-resolve',
    re: /Cannot resolve\s+(?:module\s+)?['"`]([^'"`]+)['"`]/i,
    build: (m) => ({
      detectedErrorType: 'cannot-resolve',
      detectedErrorMessage: trimMessage(m[0]),
      affectedModule: m[1],
    }),
  },
  // "Module not found" (no captured module — e.g. JSON CSS file)
  {
    name: 'module-not-found',
    re: /Module not found/i,
    build: (m, raw) => ({
      detectedErrorType: 'module-not-found',
      detectedErrorMessage: extractContext(raw, m.index ?? 0),
    }),
  },
  // Next.js compile-error overlay: ALWAYS includes the literal
  // "Build Error" header inside the overlay HTML.
  {
    name: 'build-error',
    re: /Build Error/,
    build: (m, raw) => ({
      detectedErrorType: 'build-error',
      detectedErrorMessage: extractContext(raw, m.index ?? 0),
    }),
  },
  // Next.js runtime overlay (post-hydration error in the browser).
  {
    name: 'unhandled-runtime-error',
    re: /Unhandled Runtime Error/,
    build: (m, raw) => ({
      detectedErrorType: 'unhandled-runtime-error',
      detectedErrorMessage: extractContext(raw, m.index ?? 0),
    }),
  },
  // Hydration mismatch ("Text content does not match server-rendered HTML",
  // "Hydration failed because the initial UI does not match…").
  {
    name: 'hydration-failed',
    re: /Hydration failed/i,
    build: (m, raw) => ({
      detectedErrorType: 'hydration-failed',
      detectedErrorMessage: extractContext(raw, m.index ?? 0),
    }),
  },
  // Chunk loading failure — usually a stale build referenced from a fresh
  // HTML shell, but any occurrence in the initial body is a hard fail.
  {
    name: 'chunk-load-error',
    re: /ChunkLoadError/,
    build: (m, raw) => ({
      detectedErrorType: 'chunk-load-error',
      detectedErrorMessage: extractContext(raw, m.index ?? 0),
    }),
  },
  // Generic Next.js fallback page ("Application error: a server-side
  // exception has occurred"). Distinct from the dev overlay — this is
  // the prod-style 500 placeholder that Next renders when the server
  // function threw before producing any JSX.
  {
    name: 'application-error',
    re: /Application error:?\s*([^\n<]{0,240})/i,
    build: (m) => ({
      detectedErrorType: 'application-error',
      detectedErrorMessage: trimMessage(m[0]),
    }),
  },
  // Internal Next.js dev-overlay sentinel. If we still see this anchor
  // and nothing else above matched, treat the page as a dev overlay of
  // unknown subtype rather than a healthy app shell.
  {
    name: 'nextjs-dev-overlay',
    re: /__nextjs_original-stack-frame/,
    build: (m, raw) => ({
      detectedErrorType: 'nextjs-dev-overlay',
      detectedErrorMessage: extractContext(raw, m.index ?? 0),
    }),
  },
];

/**
 * Scan a response body for known dev-overlay indicators. Returns the
 * FIRST detection (by detector priority — see `DETECTORS`). Pure
 * function, easy to unit-test.
 *
 * The scan is intentionally case-insensitive on most patterns because
 * Next.js variants vary their casing across versions ("Build Error" vs
 * "Build error"). Patterns that key off literal sentinels
 * (`__nextjs_original-stack-frame`) stay case-sensitive.
 */
export function detectDevOverlay(body: string): DevOverlayDetection | null {
  if (!body || body.length === 0) return null;
  // Cap before scanning — a 5 MB error page from a misconfigured proxy
  // is not worth scanning end-to-end.
  const sample = body.length > MAX_BODY_BYTES ? body.slice(0, MAX_BODY_BYTES) : body;
  for (const det of DETECTORS) {
    const m = sample.match(det.re);
    if (m) return det.build(m, sample);
  }
  return null;
}

/** Result of `probePreviewContent`. */
export interface PreviewContentProbeResult {
  /** HTTP status code returned by the dev server. `null` only if the
   *  transport itself failed (timeout, connection refused). */
  status: number | null;
  /** First N bytes of the body, decoded as utf-8. Already capped at
   *  `MAX_BODY_BYTES`. Empty string when there was no body or
   *  transport failed. */
  bodySample: string;
  /** Computed health verdict.
   *
   *   • `healthy: true`   — status 200-399 AND no dev-overlay sentinel.
   *   • `healthy: false`  — overlay detected, OR transport failure, OR
   *                         status 5xx with no overlay match (the dev
   *                         server crashed). */
  healthy: boolean;
  /** Populated when `healthy: false` because of a dev-overlay match. */
  detected: DevOverlayDetection | null;
  /** Free-form reason when `healthy: false` AND `detected: null` — e.g.
   *  "transport-failed", "http-500-no-overlay". */
  unhealthyReason: string | null;
}

/**
 * Issue an HTTP GET to the running dev server and decide whether the
 * preview is actually USABLE. Returns within `timeoutMs` regardless of
 * the upstream's behaviour. Never throws — every failure mode is
 * encoded in the return value.
 */
export function probePreviewContent(
  hostPort: number,
  path: string,
  timeoutMs: number,
): Promise<PreviewContentProbeResult> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (r: PreviewContentProbeResult): void => {
      if (settled) return;
      settled = true;
      resolve(r);
    };
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port: hostPort,
        path: path || '/',
        method: 'GET',
        timeout: timeoutMs,
        headers: {
          // Force the upstream dev server to render its HTML page
          // (not a JSON 404 from a missing API route).
          'User-Agent': 'devteam-content-health/1.0',
          Accept: 'text/html,application/xhtml+xml,*/*;q=0.8',
        },
      },
      (res) => {
        const status = res.statusCode ?? null;
        const chunks: Buffer[] = [];
        let total = 0;
        res.on('data', (chunk: Buffer) => {
          if (total >= MAX_BODY_BYTES) return; // drop excess
          const remaining = MAX_BODY_BYTES - total;
          if (chunk.length <= remaining) {
            chunks.push(chunk);
            total += chunk.length;
          } else {
            chunks.push(chunk.subarray(0, remaining));
            total = MAX_BODY_BYTES;
            res.resume(); // stop buffering — keep draining the socket
          }
        });
        res.on('end', () => {
          const bodySample = Buffer.concat(chunks).toString('utf8');
          const detected = detectDevOverlay(bodySample);
          let healthy = status !== null && status >= 200 && status < 400 && detected === null;
          let unhealthyReason: string | null = null;
          if (!healthy) {
            if (detected) unhealthyReason = `dev-overlay:${detected.detectedErrorType}`;
            else if (status !== null && status >= 500) unhealthyReason = `http-${status}-no-overlay`;
            else unhealthyReason = `http-${status ?? 'no-response'}`;
          }
          finish({ status, bodySample, healthy, detected, unhealthyReason });
        });
        res.on('error', () => {
          finish({
            status,
            bodySample: Buffer.concat(chunks).toString('utf8'),
            healthy: false,
            detected: null,
            unhealthyReason: 'response-stream-error',
          });
        });
      },
    );
    req.on('error', () => {
      finish({
        status: null,
        bodySample: '',
        healthy: false,
        detected: null,
        unhealthyReason: 'transport-failed',
      });
    });
    req.on('timeout', () => {
      req.destroy();
      finish({
        status: null,
        bodySample: '',
        healthy: false,
        detected: null,
        unhealthyReason: 'transport-timeout',
      });
    });
    req.end();
  });
}

// ── helpers ─────────────────────────────────────────────────

function trimMessage(s: string): string {
  return s.replace(/\s+/g, ' ').trim().slice(0, 512);
}

/** Extract a small window of context around a regex match index — used
 *  when a pattern matched but didn't capture a useful group. Stops at
 *  the first newline after the match so we don't drag the entire HTML
 *  body into the error message. */
function extractContext(raw: string, index: number): string {
  // Walk back to the start of the line, then forward to the next
  // newline. Cap the slice at 512 chars.
  const start = Math.max(0, raw.lastIndexOf('\n', index) + 1);
  let end = raw.indexOf('\n', index);
  if (end === -1) end = Math.min(raw.length, index + 512);
  return trimMessage(stripHtmlTags(raw.slice(start, end)));
}

/** Strip HTML tags from a snippet so the error message is human-readable
 *  when extracted from a dev-overlay HTML payload. Conservative — does
 *  NOT decode entities. */
function stripHtmlTags(s: string): string {
  return s.replace(/<[^>]+>/g, ' ');
}
