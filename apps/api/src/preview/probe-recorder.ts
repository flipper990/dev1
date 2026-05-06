// ─────────────────────────────────────────────────────────────
// Preview HTTP probe recorder.
//
// Single-probe primitive used by both the local-runner readiness
// loop and the docker-runner awaitHealthy loop. Distinct from the
// transport-level probe helpers in those modules because it ALSO:
//
//   • Captures every connection result (success, timeout, ECONNREFUSED,
//     ENOTFOUND, …) into a structured `ProbeAttempt` so the timeout
//     dump can answer "what kind of startup failure was this?".
//   • Reads the first 200 chars of the response body when one came
//     back — the body shape disambiguates "HTTP 200 with a build-error
//     overlay" from "HTTP 200 with a real app shell".
//   • Classifies the attempt into one of:
//       - `success`            ── HTTP responded with an OK-ish status
//       - `tcp-failed`         ── connect() failed (ECONNREFUSED, etc.)
//       - `tcp-timeout`        ── connect() timed out
//       - `http-timeout`       ── socket connected but no full HTTP
//                                 response within the budget
//       - `http-error-status`  ── HTTP responded but status was 5xx
//                                 or otherwise non-OK
//
// The CALLER decides whether a probe is "ready" — this module just
// describes WHAT happened. Keeping this separation lets the
// preview-manager classify the LAST observed probe distinctly from
// the readiness gate's verdict ("we got a 200 but the body looked
// like a build-error overlay" is different from "we never connected").
// ─────────────────────────────────────────────────────────────

import { request as httpRequest } from 'node:http';

/** Outcome bucket assigned by classifyProbeAttempt. Stable enum —
 *  surfaced into `last-preview-timeout.json` and the dashboard, so
 *  renaming a member is a breaking change for downstream tooling. */
export type ProbeOutcome =
  | 'success'
  | 'tcp-failed'
  | 'tcp-timeout'
  | 'http-timeout'
  | 'http-error-status';

/** One attempt at probing a preview HTTP endpoint. The probe loop
 *  appends a fresh ProbeAttempt every poll iteration and trims the
 *  history to the last N entries (cap defined by the caller). */
export interface ProbeAttempt {
  /** ISO timestamp when the request was issued. */
  at: string;
  /** Wall-clock duration (ms) from request start to terminal event. */
  durationMs: number;
  /** The full URL we requested (host + port + path). Useful when a
   *  bug is sending the probe at the wrong port. */
  url: string;
  /** HTTP method used (HEAD for liveness checks, GET when capturing
   *  the body). */
  method: 'HEAD' | 'GET';
  /** Outcome classification — drives the timeout dump's headline. */
  outcome: ProbeOutcome;
  /** True iff a TCP connection was established. Set as soon as the
   *  socket emits `connect`. Lets the dump distinguish
   *  "port never opened" from "port opened but HTTP hung". */
  tcpConnected: boolean;
  /** True iff `outcome === 'success'`. Convenience flag — same as
   *  the readiness verdict for that attempt. */
  ok: boolean;
  /** HTTP status code when the server replied. `null` for
   *  tcp-failed / tcp-timeout / http-timeout. */
  status: number | null;
  /** First 200 chars of the response body when one was received.
   *  `null` when no body (HEAD / no response / connection error). */
  bodySample: string | null;
  /** Node.js error code (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`,
   *  …) for the failure case. `null` on success. */
  errorCode: string | null;
  /** Human-readable error message. `null` on success. */
  errorMessage: string | null;
}

/**
 * Issue a single probe and record the full diagnostic shape.
 *
 * Never throws — connection / parse failures are encoded into the
 * returned ProbeAttempt so the caller can append every attempt to a
 * ring buffer without try/catch boilerplate.
 *
 * `captureBody` controls whether we use HEAD (no body) or GET (read
 * up to 200 chars). The local-runner readiness loop uses HEAD by
 * default (cheaper) and switches to GET on the LAST attempt before
 * giving up so the timeout dump always has a body sample.
 */
export async function recordProbe(opts: {
  host?: string;
  port: number;
  path?: string;
  timeoutMs?: number;
  captureBody?: boolean;
}): Promise<ProbeAttempt> {
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port;
  const path = opts.path ?? '/';
  const timeoutMs = opts.timeoutMs ?? 1_500;
  const method: 'HEAD' | 'GET' = opts.captureBody ? 'GET' : 'HEAD';
  const url = `http://${host}:${port}${path}`;
  const startedAt = Date.now();

  return new Promise<ProbeAttempt>((resolve) => {
    let tcpConnected = false;
    let bodyBuf = '';
    let settled = false;
    const finish = (a: Omit<ProbeAttempt, 'at' | 'durationMs' | 'url' | 'method' | 'tcpConnected'>) => {
      if (settled) return;
      settled = true;
      resolve({
        at: new Date(startedAt).toISOString(),
        durationMs: Date.now() - startedAt,
        url,
        method,
        tcpConnected,
        ...a,
      });
    };

    const req = httpRequest(
      {
        host,
        port,
        path,
        method,
        timeout: timeoutMs,
        headers: { 'User-Agent': 'devteam-preview-probe/1.0' },
      },
      (res) => {
        const status = res.statusCode ?? 0;
        if (method === 'HEAD' || !opts.captureBody) {
          res.resume();
          finish({
            outcome: status >= 200 && status < 400 ? 'success' : 'http-error-status',
            ok: status >= 200 && status < 400,
            status,
            bodySample: null,
            errorCode: null,
            errorMessage: null,
          });
          return;
        }
        // GET: capture up to 200 chars of body so the caller can
        // tell "real app shell" from "build-error overlay" without
        // a second request.
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          if (bodyBuf.length < 200) {
            bodyBuf = (bodyBuf + chunk).slice(0, 200);
          }
        });
        res.on('end', () => {
          finish({
            outcome: status >= 200 && status < 400 ? 'success' : 'http-error-status',
            ok: status >= 200 && status < 400,
            status,
            bodySample: bodyBuf || null,
            errorCode: null,
            errorMessage: null,
          });
        });
        res.on('error', (err) => {
          finish({
            outcome: 'http-timeout',
            ok: false,
            status,
            bodySample: bodyBuf || null,
            errorCode: (err as NodeJS.ErrnoException).code ?? null,
            errorMessage: err.message,
          });
        });
      },
    );

    // Hook the underlying socket so we can detect "TCP connected
    // but no HTTP response" — the most informative failure mode for
    // a stuck dev server (the port is open, the process is alive,
    // but it's not actually serving HTTP yet).
    req.on('socket', (sock) => {
      sock.once('connect', () => { tcpConnected = true; });
    });

    req.on('error', (err) => {
      const e = err as NodeJS.ErrnoException;
      const code = e.code ?? null;
      // ECONNREFUSED / ENOTFOUND / EHOSTUNREACH = TCP never connected.
      // ECONNRESET / EPIPE after `connect` already fired = HTTP layer
      // failure (tcp-opened-but-http-failed).
      const isConnectFailure = !tcpConnected && (
        code === 'ECONNREFUSED'
        || code === 'ENOTFOUND'
        || code === 'EHOSTUNREACH'
        || code === 'EAI_AGAIN'
      );
      finish({
        outcome: isConnectFailure ? 'tcp-failed' : 'http-timeout',
        ok: false,
        status: null,
        bodySample: null,
        errorCode: code,
        errorMessage: err.message,
      });
    });
    req.on('timeout', () => {
      req.destroy();
      finish({
        outcome: tcpConnected ? 'http-timeout' : 'tcp-timeout',
        ok: false,
        status: null,
        bodySample: bodyBuf || null,
        errorCode: 'ETIMEDOUT',
        errorMessage: `probe timed out after ${timeoutMs}ms`,
      });
    });
    req.end();
  });
}

/**
 * Roll-up classification of a list of probe attempts. Used by
 * `last-preview-timeout.json` to pick a single human-readable
 * headline ("Port never opened" / "TCP opened but HTTP failed" /
 * "HTTP responded with error status" / etc.) from a potentially
 * heterogeneous attempt history.
 *
 * Selection rule:
 *   • Empty list → `'no-probes'` (we never even tried).
 *   • Any `success` attempt → `'http-not-ready'` (probe got a 2xx
 *     but the readiness gate rejected it — typically a content-
 *     health overlay match). The CALLER must verify this kind by
 *     also passing in the overlay-detection verdict; in raw probe
 *     space, a success is a success.
 *   • Any `http-error-status` → `'http-error-status'`.
 *   • Any `http-timeout` (= tcpConnected) → `'tcp-opened-no-http'`.
 *   • Otherwise → `'port-never-opened'`.
 */
export type ProbeRollup =
  | 'no-probes'
  | 'port-never-opened'
  | 'tcp-opened-no-http'
  | 'http-error-status'
  | 'http-not-ready';

export function rollupProbes(attempts: ProbeAttempt[]): {
  kind: ProbeRollup;
  total: number;
  tcpEverConnected: boolean;
  httpEverResponded: boolean;
  lastAttempt: ProbeAttempt | null;
  lastStatus: number | null;
} {
  if (attempts.length === 0) {
    return {
      kind: 'no-probes', total: 0,
      tcpEverConnected: false, httpEverResponded: false,
      lastAttempt: null, lastStatus: null,
    };
  }
  const tcpEverConnected = attempts.some((a) => a.tcpConnected);
  const httpEverResponded = attempts.some((a) => a.status !== null);
  const anySuccess = attempts.some((a) => a.outcome === 'success');
  const anyErrorStatus = attempts.some((a) => a.outcome === 'http-error-status');
  const anyHttpTimeout = attempts.some((a) => a.outcome === 'http-timeout');
  const lastAttempt = attempts[attempts.length - 1] ?? null;
  let kind: ProbeRollup;
  if (anySuccess) kind = 'http-not-ready';
  else if (anyErrorStatus) kind = 'http-error-status';
  else if (anyHttpTimeout || tcpEverConnected) kind = 'tcp-opened-no-http';
  else kind = 'port-never-opened';
  return {
    kind,
    total: attempts.length,
    tcpEverConnected,
    httpEverResponded,
    lastAttempt,
    lastStatus: lastAttempt?.status ?? null,
  };
}
