/**
 * Single source of truth for backend base URLs used by the web client.
 *
 * Local default must match `apps/api/src/config.ts` (`API_PORT` default 3003).
 */
export const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:3003';

export function wsBaseFromApiBase(apiBase: string): string {
  return apiBase.replace(/^http:\/\//, 'ws://').replace(/^https:\/\//, 'wss://');
}
