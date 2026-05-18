import path from 'node:path';

export type UnsafePathReason =
  | 'empty-path'
  | 'null-byte'
  | 'absolute-path'
  | 'path-traversal'
  | 'outside-root'
  | 'windows-invalid-char';

export class UnsafeProjectPathError extends Error {
  readonly code = 'UNSAFE_PROJECT_PATH' as const;

  constructor(
    public readonly inputPath: string,
    public readonly reason: UnsafePathReason,
    message?: string,
  ) {
    super(message ?? `Unsafe project path "${inputPath}" (${reason})`);
    this.name = 'UnsafeProjectPathError';
  }
}

const WINDOWS_DRIVE_PREFIX = /^[A-Za-z]:[\\/]/;
const UNC_PREFIX = /^\\\\/;
const WINDOWS_INVALID_SEGMENT_CHARS = /[<>:"|?*]/;

function normalizeColonRouteSegments(pathValue: string): string {
  const segments = pathValue.split('/');
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i] ?? '';
    const m = /^:([A-Za-z0-9_-]+)$/.exec(seg);
    if (!m) continue;
    segments[i] = `[${m[1]}]`;
  }
  return segments.join('/');
}

function reject(inputPath: string, reason: UnsafePathReason, message: string): never {
  throw new UnsafeProjectPathError(inputPath, reason, message);
}

/**
 * Normalize a relative project path and reject traversal / absolute paths.
 * Returns POSIX-style separators (`/`) for consistency in persisted metadata.
 */
export function normalizeProjectRelativePath(inputPath: string): string {
  if (typeof inputPath !== 'string' || inputPath.trim().length === 0) {
    reject(String(inputPath), 'empty-path', 'Path must be a non-empty string');
  }
  if (inputPath.includes('\0')) {
    reject(inputPath, 'null-byte', 'Path contains a null byte');
  }

  const raw = inputPath.trim();
  if (
    raw.startsWith('/')
    || raw.startsWith('\\')
    || WINDOWS_DRIVE_PREFIX.test(raw)
    || UNC_PREFIX.test(raw)
    || path.isAbsolute(raw)
  ) {
    reject(raw, 'absolute-path', 'Absolute paths are not allowed');
  }

  const posixPath = normalizeColonRouteSegments(raw.replace(/\\/g, '/'));
  let normalized = path.posix.normalize(posixPath);
  while (normalized.startsWith('./')) normalized = normalized.slice(2);
  if (normalized === '.' || normalized.length === 0) {
    reject(raw, 'empty-path', 'Path resolves to empty');
  }
  if (normalized === '..' || normalized.startsWith('../') || normalized.includes('/../')) {
    reject(raw, 'path-traversal', 'Parent directory traversal is not allowed');
  }
  if (WINDOWS_INVALID_SEGMENT_CHARS.test(normalized)) {
    reject(raw, 'windows-invalid-char', 'Path contains Windows-invalid segment characters');
  }

  return normalized;
}

export interface SafeResolvedPath {
  rootDir: string;
  relativePath: string;
  absolutePath: string;
}

/**
 * Resolve a user-provided relative path under `rootDir` and verify the final
 * absolute path remains inside that root.
 */
export function resolvePathWithinRoot(rootDir: string, inputPath: string): SafeResolvedPath {
  const relativePath = normalizeProjectRelativePath(inputPath);
  const resolvedRoot = path.resolve(rootDir);
  const absolutePath = path.resolve(resolvedRoot, relativePath);
  const relFromRoot = path.relative(resolvedRoot, absolutePath);
  if (
    relFromRoot === ''
    || relFromRoot === '.'
    || relFromRoot.startsWith('..')
    || path.isAbsolute(relFromRoot)
  ) {
    if (relativePath === '' || relativePath === '.' || relFromRoot === '' || relFromRoot === '.') {
      reject(inputPath, 'empty-path', 'Path resolves to root directory');
    }
    reject(inputPath, 'outside-root', `Resolved path escapes root (${resolvedRoot})`);
  }

  return { rootDir: resolvedRoot, relativePath, absolutePath };
}

/**
 * Normalize a path to a safe ZIP archive entry name.
 */
export function toSafeArchiveEntryPath(inputPath: string): string {
  return normalizeProjectRelativePath(inputPath);
}
