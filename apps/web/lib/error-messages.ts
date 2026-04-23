/**
 * Turn raw backend/network errors into short, user-friendly messages.
 *
 * Backend errors arrive either as thrown `Error` instances (message = JSON
 * stringified body in api.ts) or as plain strings. We map the well-known
 * `code` / status combinations to human copy, and fall back to cleaning up
 * the raw message otherwise.
 *
 * Keep titles ≤ 28 chars and messages ≤ 120 chars — anything longer stops
 * feeling premium in a toast.
 */

export interface HumanError {
  title: string;
  message: string;
  /** Hint used by the UI to choose toast color. */
  severity: 'error' | 'warning' | 'info';
}

interface ParsedBackendError {
  code?: string;
  message?: string;
  statusCode?: number;
  details?: Record<string, unknown>;
}

function parse(raw: unknown): ParsedBackendError {
  if (!raw) return {};
  if (raw instanceof Error) {
    // api.ts throws with the JSON body as message when the server returned
    // structured JSON. Try to parse it out.
    const txt = raw.message;
    if (txt.startsWith('{') || txt.startsWith('[')) {
      try { return JSON.parse(txt) as ParsedBackendError; } catch { /* ignore */ }
    }
    return { message: txt };
  }
  if (typeof raw === 'string') {
    if (raw.startsWith('{')) {
      try { return JSON.parse(raw) as ParsedBackendError; } catch { /* ignore */ }
    }
    return { message: raw };
  }
  if (typeof raw === 'object') return raw as ParsedBackendError;
  return { message: String(raw) };
}

export function humanizeError(raw: unknown, fallbackTitle = 'Something went wrong'): HumanError {
  const parsed = parse(raw);
  const code = parsed.code;
  const msg  = (parsed.message ?? '').trim();

  // ─── Known backend error codes ─────────────────────────────────────────
  if (code === 'COST_LIMIT_EXCEEDED') {
    const d = parsed.details ?? {};
    const kind = d.kind;
    if (kind === 'generation_count') {
      return {
        title: 'Generation limit reached',
        message: `This project has used all ${d.limit} of its generations. Raise the limit in project settings to continue.`,
        severity: 'warning',
      };
    }
    return {
      title: 'Cost limit reached',
      message: `Spend on this project ($${Number(d.currentValue ?? 0).toFixed(2)}) has hit the configured cap ($${Number(d.limit ?? 0).toFixed(2)}).`,
      severity: 'warning',
    };
  }
  if (code === 'PROJECT_LOCKED') {
    return { title: 'Already building', message: 'This project already has a run in progress. Wait for it to finish, then try again.', severity: 'warning' };
  }
  if (code === 'VALIDATION_ERROR') {
    return { title: 'Invalid input', message: msg || 'The request did not match the expected shape.', severity: 'warning' };
  }
  if (code === 'NOT_FOUND' || parsed.statusCode === 404) {
    return { title: 'Not found', message: msg || 'The resource you requested no longer exists.', severity: 'warning' };
  }
  if (code === 'RATE_LIMITED' || parsed.statusCode === 429) {
    return { title: 'Slow down', message: 'Too many requests in a short window. Wait a few seconds and retry.', severity: 'warning' };
  }
  if (parsed.statusCode === 401 || parsed.statusCode === 403) {
    return { title: 'Not authorized', message: msg || 'You do not have access to this action.', severity: 'error' };
  }
  if (parsed.statusCode === 409) {
    return { title: 'Conflict', message: msg || 'That action conflicts with the current project state.', severity: 'warning' };
  }
  if (parsed.statusCode && parsed.statusCode >= 500) {
    return { title: 'Server error', message: msg || 'The backend returned an unexpected error. Try again shortly.', severity: 'error' };
  }

  // ─── Network-style messages ────────────────────────────────────────────
  const lower = msg.toLowerCase();
  if (lower.includes('failed to fetch') || lower.includes('networkerror') || lower.includes('network request failed')) {
    return { title: 'Connection lost', message: 'Could not reach the server. Check your connection and try again.', severity: 'error' };
  }
  if (lower.includes('aborted')) {
    return { title: 'Request cancelled', message: 'The request was cancelled before it completed.', severity: 'info' };
  }
  if (lower.includes('timeout')) {
    return { title: 'Request timed out', message: 'The server took too long to respond. Try again in a moment.', severity: 'warning' };
  }

  // ─── Fallback ──────────────────────────────────────────────────────────
  return {
    title: fallbackTitle,
    message: msg ? truncate(msg, 120) : 'Please try again in a moment.',
    severity: 'error',
  };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max - 1).trimEnd() + '…';
}
