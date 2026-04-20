import { randomBytes } from 'node:crypto';

export { config } from './config.js';
export * from './types.js';
export * from './errors.js';
export { Logger, rootLogger } from './logger.js';

// ─── ID generation ────────────────────────────────────────────────────────────

export function generateId(prefix = ''): string {
  const random = randomBytes(12).toString('hex');
  const timestamp = Date.now().toString(36);
  return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

export function now(): string {
  return new Date().toISOString();
}

export function msSince(isoDate: string): number {
  return Date.now() - new Date(isoDate).getTime();
}

// ─── Type guards ──────────────────────────────────────────────────────────────

export function isString(val: unknown): val is string {
  return typeof val === 'string';
}

export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === 'object' && val !== null && !Array.isArray(val);
}

// ─── Async helpers ────────────────────────────────────────────────────────────

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = 'operation',
): Promise<T> {
  let handle: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    handle = setTimeout(() => reject(new Error(`Timeout: ${label} exceeded ${timeoutMs}ms`)), timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(handle!);
  }
}

// ─── Object helpers ───────────────────────────────────────────────────────────

export function stableStringify(val: unknown): string {
  return JSON.stringify(sortKeys(val));
}

function sortKeys(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(sortKeys);
  if (val !== null && typeof val === 'object') {
    return Object.fromEntries(
      Object.entries(val as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sortKeys(v)]),
    );
  }
  return val;
}
