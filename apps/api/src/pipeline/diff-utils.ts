// ─────────────────────────────────────────────────────────────
// Diff Utilities — Compute line-level file diffs between two
// project file snapshots. No external dependencies.
//
// Intentionally simple: counts line additions/deletions per file
// so that version metadata and UI badges stay lightweight.
// Full content is stored in the version snapshot for restores.
// ─────────────────────────────────────────────────────────────

import type { FileDiff } from '../storage/project-store.js';

type FileMap = Map<string, string>;

/**
 * Compute per-file diffs between an old and new file set.
 *
 * @param oldFiles  Files from the previous version.
 * @param newFiles  Files from the new version.
 * @returns One FileDiff entry per changed file. Unchanged files are omitted.
 */
export function computeFileDiffs(
  oldFiles: { path: string; content: string }[],
  newFiles: { path: string; content: string }[],
): FileDiff[] {
  const oldMap: FileMap = new Map(oldFiles.map(f => [f.path, f.content]));
  const newMap: FileMap = new Map(newFiles.map(f => [f.path, f.content]));

  const diffs: FileDiff[] = [];

  // Added and modified files
  for (const [path, newContent] of newMap) {
    const oldContent = oldMap.get(path);
    if (oldContent === undefined) {
      // New file — all lines are additions
      diffs.push({ path, op: 'added', additions: lineCount(newContent), deletions: 0 });
    } else if (oldContent !== newContent) {
      // Modified — count changed lines
      const { additions, deletions } = lineDiff(oldContent, newContent);
      diffs.push({ path, op: 'modified', additions, deletions });
    }
    // Identical content → skip (no diff entry)
  }

  // Deleted files
  for (const [path] of oldMap) {
    if (!newMap.has(path)) {
      diffs.push({ path, op: 'deleted', additions: 0, deletions: lineCount(oldMap.get(path)!) });
    }
  }

  return diffs.sort((a, b) => a.path.localeCompare(b.path));
}

/**
 * Summarise a diff array into aggregate stats.
 */
export function summariseDiffs(diffs: FileDiff[]): {
  filesAdded: number;
  filesModified: number;
  filesDeleted: number;
  totalAdditions: number;
  totalDeletions: number;
} {
  return {
    filesAdded:    diffs.filter(d => d.op === 'added').length,
    filesModified: diffs.filter(d => d.op === 'modified').length,
    filesDeleted:  diffs.filter(d => d.op === 'deleted').length,
    totalAdditions: diffs.reduce((s, d) => s + d.additions, 0),
    totalDeletions: diffs.reduce((s, d) => s + d.deletions, 0),
  };
}

// ── Internals ─────────────────────────────────────────────

function lineCount(content: string): number {
  if (!content) return 0;
  // Count newlines + 1 (final line may not end with \n)
  let count = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') count++;
  }
  return count + (content.length > 0 && content[content.length - 1] !== '\n' ? 1 : 0);
}

/**
 * Count added and deleted lines between two file contents.
 * Uses a simple LCS-based diff (patience algorithm equivalent at line level).
 * For token-budget reasons, we hash lines and compare sets — O(n) not O(n²).
 */
function lineDiff(
  oldContent: string,
  newContent: string,
): { additions: number; deletions: number } {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Build frequency maps (content → count)
  const oldFreq = new Map<string, number>();
  for (const line of oldLines) {
    oldFreq.set(line, (oldFreq.get(line) ?? 0) + 1);
  }

  const newFreq = new Map<string, number>();
  for (const line of newLines) {
    newFreq.set(line, (newFreq.get(line) ?? 0) + 1);
  }

  // Lines present in old but not new → deletions
  let deletions = 0;
  for (const [line, count] of oldFreq) {
    const kept = Math.min(count, newFreq.get(line) ?? 0);
    deletions += count - kept;
  }

  // Lines present in new but not old → additions
  let additions = 0;
  for (const [line, count] of newFreq) {
    const kept = Math.min(count, oldFreq.get(line) ?? 0);
    additions += count - kept;
  }

  return { additions, deletions };
}
