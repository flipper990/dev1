// ─── Project Diff ─────────────────────────────────────────────────────────────
//
// Pure, deterministic file-level diffing. No LLM calls.
// Used by the update pipeline to tell the orchestrator, the UI, and the
// prompt-history entry exactly which files changed during an iteration.

import type { ProjectFile } from '@devteam/core';

export interface ProjectDiff {
  /** Paths that existed before AND after, and whose content changed. */
  modified: string[];
  /** Paths that did not exist before and now do. */
  added: string[];
  /** Paths that existed before and were explicitly removed this iteration. */
  removed: string[];
  /** Paths present in both snapshots with byte-identical content. */
  unchanged: string[];
  /** Union of `added + modified + removed` — convenience for `changedFiles`. */
  changedPaths: string[];
}

/**
 * Diff two file snapshots by path. Order-independent.
 *
 * @param before Files as they existed prior to the iteration.
 * @param after  Files as they exist after the iteration (post-merge).
 * @param removedExplicit Optional allow-list of paths the coder asked to remove.
 *                        Only paths present in `before` are honoured.
 */
export function diffFiles(
  before: ProjectFile[],
  after: ProjectFile[],
  removedExplicit: string[] = [],
): ProjectDiff {
  const beforeMap = new Map(before.map((f) => [f.path, f.content]));
  const afterMap  = new Map(after.map((f) => [f.path, f.content]));

  const added: string[]     = [];
  const modified: string[]  = [];
  const unchanged: string[] = [];

  for (const [path, content] of afterMap) {
    if (!beforeMap.has(path)) {
      added.push(path);
    } else if (beforeMap.get(path) !== content) {
      modified.push(path);
    } else {
      unchanged.push(path);
    }
  }

  // A path is "removed" if the coder explicitly asked for it AND it existed
  // before AND it is no longer in the post-merge set.
  const removed: string[] = [];
  const removedSet = new Set(removedExplicit);
  for (const path of beforeMap.keys()) {
    if (removedSet.has(path) && !afterMap.has(path)) removed.push(path);
  }

  const changedPaths = [...added, ...modified, ...removed].sort();

  return {
    added:    added.sort(),
    modified: modified.sort(),
    removed:  removed.sort(),
    unchanged,
    changedPaths,
  };
}

/**
 * Apply an update-coder's output to the previous file set.
 *
 * Rules:
 *   - A file path in `next` replaces the same path in `prev` (modify).
 *   - A path in `next` not seen in `prev` is added.
 *   - A path in `removedExplicit` is dropped from `prev` entirely.
 *   - Every other file in `prev` is preserved verbatim (no data loss).
 */
export function applyCoderPatch(
  prev: ProjectFile[],
  next: ProjectFile[],
  removedExplicit: string[] = [],
): ProjectFile[] {
  const nextByPath = new Map(next.map((f) => [f.path, f]));
  const remove = new Set(removedExplicit);

  const merged: ProjectFile[] = [];
  for (const file of prev) {
    if (remove.has(file.path)) continue;          // explicitly deleted
    if (nextByPath.has(file.path)) continue;      // will be replaced below
    merged.push(file);                            // untouched — preserved
  }
  for (const file of next) merged.push(file);     // added / modified

  return merged;
}
