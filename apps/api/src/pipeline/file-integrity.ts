// Pipeline file integrity auditor.
//
// Runs after every step that produces, transforms, or persists ProjectFile[].
// Detects entries whose `content` is not a non-empty string (the failure mode
// that crashed the local-preview stager: `{ path, content: undefined }` reaches
// fs.writeFile and throws "data argument must be of type string ...").
//
// The auditor is intentionally STEP-AWARE — every call site passes a step
// label so a single log line tells us the EARLIEST point at which an invalid
// entry appeared. That lets us pinpoint introduction (builder vs qa vs polish
// vs assembler vs persistence-roundtrip) without bisecting.
//
// IMPORTANT: this auditor never mutates input. It is a passive observer.
// Hard enforcement happens at:
//   - agent validateOutput() (rejects bad newFiles[] before they enter the
//     pipeline state),
//   - preview-file-validator (rejects bad files before fs.writeFile).

import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';

export type FileIntegrityStep =
  | 'builder.result'
  | 'qa.result'
  | 'polish.result'
  | 'slice.cumulative-merge'
  | 'final-assembly.assembleProject'
  | 'persisted-project.load'
  | string;

export interface FileIntegrityIssue {
  index: number;
  path: string | null;
  reason:
    | 'invalid-path'
    | 'empty-path'
    | 'missing-content-key'
    | 'invalid-content-type'
    | 'empty-content';
  typeofContent: string;
  contentLength: number | null;
}

export interface FileIntegrityReport {
  step: FileIntegrityStep;
  ok: boolean;
  totalFiles: number;
  invalidCount: number;
  emptyContentCount: number;
  issues: FileIntegrityIssue[];
}

export interface AuditOptions {
  /** Code-file extensions whose empty content is a hard failure. Other
   *  extensions (json, md, .gitignore, etc.) are allowed to be empty. */
  allowEmptyContent?: boolean;
  /** Cap the issues list returned to keep logs bounded. */
  maxIssues?: number;
}

const CODE_EXT_RE = /\.(tsx|jsx|ts|js|mjs|cjs)$/i;

/**
 * Scans a ProjectFile-shaped array for malformed entries. Returns a
 * structured report. Caller decides whether to throw, log, or repair.
 */
export function auditProjectFiles(
  files: unknown,
  step: FileIntegrityStep,
  options: AuditOptions = {},
): FileIntegrityReport {
  const maxIssues = options.maxIssues ?? 50;
  const allowEmpty = options.allowEmptyContent ?? true;

  const report: FileIntegrityReport = {
    step,
    ok: true,
    totalFiles: 0,
    invalidCount: 0,
    emptyContentCount: 0,
    issues: [],
  };

  if (!Array.isArray(files)) {
    report.ok = false;
    report.issues.push({
      index: -1,
      path: null,
      reason: 'invalid-path',
      typeofContent: typeof files,
      contentLength: null,
    });
    return report;
  }

  report.totalFiles = files.length;

  for (let i = 0; i < files.length; i++) {
    const f = files[i] as Record<string, unknown> | null | undefined;
    if (i >= maxIssues && !report.ok) break;

    if (!f || typeof f !== 'object') {
      report.ok = false;
      report.invalidCount++;
      if (report.issues.length < maxIssues) {
        report.issues.push({
          index: i,
          path: null,
          reason: 'invalid-path',
          typeofContent: typeof f,
          contentLength: null,
        });
      }
      continue;
    }

    const path = f.path;
    if (typeof path !== 'string') {
      report.ok = false;
      report.invalidCount++;
      if (report.issues.length < maxIssues) {
        report.issues.push({
          index: i,
          path: null,
          reason: 'invalid-path',
          typeofContent: typeof f.content,
          contentLength: null,
        });
      }
      continue;
    }
    if (path.length === 0) {
      report.ok = false;
      report.invalidCount++;
      if (report.issues.length < maxIssues) {
        report.issues.push({
          index: i,
          path: '',
          reason: 'empty-path',
          typeofContent: typeof f.content,
          contentLength: null,
        });
      }
      continue;
    }

    // Content-key presence vs type. JSON.stringify drops `undefined`-valued
    // keys, so a roundtripped file with originally `content: undefined`
    // shows up here as `'content' in f === false` (key entirely missing).
    if (!('content' in f)) {
      report.ok = false;
      report.invalidCount++;
      if (report.issues.length < maxIssues) {
        report.issues.push({
          index: i,
          path,
          reason: 'missing-content-key',
          typeofContent: 'undefined',
          contentLength: null,
        });
      }
      continue;
    }

    const content = f.content;
    if (typeof content !== 'string') {
      report.ok = false;
      report.invalidCount++;
      if (report.issues.length < maxIssues) {
        report.issues.push({
          index: i,
          path,
          reason: 'invalid-content-type',
          typeofContent: typeof content,
          contentLength: null,
        });
      }
      continue;
    }

    if (content.length === 0) {
      report.emptyContentCount++;
      // Only flag empty content as a hard failure for code files when
      // the caller has set allowEmptyContent=false. The assembler already
      // drops empty code files in a deliberate pass.
      if (!allowEmpty && CODE_EXT_RE.test(path)) {
        report.ok = false;
        report.invalidCount++;
        if (report.issues.length < maxIssues) {
          report.issues.push({
            index: i,
            path,
            reason: 'empty-content',
            typeofContent: 'string',
            contentLength: 0,
          });
        }
      }
    }
  }

  return report;
}

/**
 * Convenience: run the auditor and emit a structured log line. Returns the
 * report so the caller can decide whether to escalate. The log line carries
 * the exact step name so the EARLIEST point of corruption is greppable.
 */
export function auditAndLog(
  files: unknown,
  step: FileIntegrityStep,
  logger: Logger,
  options: AuditOptions = {},
): FileIntegrityReport {
  const report = auditProjectFiles(files, step, options);
  if (!report.ok) {
    logger.error(`[file-integrity] FAIL @ ${step}: ${report.invalidCount}/${report.totalFiles} invalid file entries`, {
      event: 'file-integrity:fail',
      step,
      totalFiles: report.totalFiles,
      invalidCount: report.invalidCount,
      emptyContentCount: report.emptyContentCount,
      firstIssues: report.issues.slice(0, 10),
    });
  } else if (report.emptyContentCount > 0) {
    logger.warn(`[file-integrity] OK @ ${step} (${report.totalFiles} files, ${report.emptyContentCount} with empty content)`, {
      event: 'file-integrity:empty-content',
      step,
      totalFiles: report.totalFiles,
      emptyContentCount: report.emptyContentCount,
    });
  } else {
    logger.debug(`[file-integrity] OK @ ${step} (${report.totalFiles} files)`, {
      event: 'file-integrity:ok',
      step,
      totalFiles: report.totalFiles,
    });
  }
  return report;
}

/**
 * Format a brief one-line summary suitable for a thrown Error message.
 */
export function describeIntegrityIssue(issue: FileIntegrityIssue): string {
  const path = issue.path ?? `<index=${issue.index}>`;
  switch (issue.reason) {
    case 'missing-content-key':
      return `File "${path}" has no content key (typeof=${issue.typeofContent}). Likely cause: serialization dropped an undefined content field, or an agent emitted a file entry without content.`;
    case 'invalid-content-type':
      return `File "${path}" has non-string content (typeof=${issue.typeofContent}).`;
    case 'invalid-path':
      return `File at index ${issue.index} has invalid path (typeof=${issue.typeofContent}).`;
    case 'empty-path':
      return `File at index ${issue.index} has empty path.`;
    case 'empty-content':
      return `File "${path}" has empty content.`;
    default:
      return `File "${path}" failed integrity check (${issue.reason}).`;
  }
}
