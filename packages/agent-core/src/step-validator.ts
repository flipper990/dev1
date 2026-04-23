// ─────────────────────────────────────────────────────────────
// Step Validator — post-step validation + programmatic repair
//
// Runs after every pipeline step completes. Responsibilities:
//
//   1. VALIDATE the step's output against its declared schema and against
//      cross-step invariants (e.g. developer.files paths exist in the
//      architect.fileTree; backend routes match frontend fetch calls).
//
//   2. REPAIR deterministically where possible — fill missing required
//      fields with safe defaults, coerce wrong shapes, strip phantom
//      entries, and align data models between upstream and downstream
//      artifacts. No LLM call.
//
//   3. FLAG for re-run when a downstream LLM agent can fix the problem
//      better than we can programmatically — e.g. bad code from the
//      developer is flagged so reviewer picks it up; broken UI is flagged
//      so quality_enforcer re-runs.
//
//   4. BLOCK the pipeline when validation fails and the problem is not
//      auto-repairable and no downstream agent can fix it. The user's
//      rule: the pipeline must NOT proceed if errors exist.
//
// This module is pure and deterministic. It does NOT perform network
// calls or LLM invocations. All self-heal decisions happen in <10 ms.
// ─────────────────────────────────────────────────────────────

import type { AgentRole } from './types';
import type { PipelineState } from './pipeline-types';
import { getAgentDefinition } from './agent-registry';

// ── Public types ────────────────────────────────────────────

export type ValidationSeverity = 'info' | 'warning' | 'error' | 'blocker';

export interface ValidationIssue {
  /** Stable id so UIs can dedupe. */
  id: string;
  /** Human-readable issue message. */
  message: string;
  /** Machine-readable category so handlers can branch on intent. */
  category:
    | 'schema'             // required field missing / wrong type
    | 'shape'              // array expected, got object, etc.
    | 'cross-step'         // mismatch with upstream artifact
    | 'empty-output'       // agent returned nothing useful
    | 'ui-broken'          // UI output is unusable
    | 'schema-drift'       // backend/frontend data model mismatch
    | 'code-quality';      // reviewer issues above threshold
  severity: ValidationSeverity;
  /** Field path that triggered the issue, when applicable. */
  path?: string;
  /** A downstream agent role that could fix this. */
  fixableBy?: AgentRole;
}

export interface RepairChange {
  path: string;
  action: 'filled-default' | 'coerced-shape' | 'removed-invalid' | 'aligned-schema';
  detail: string;
}

export interface ValidationResult {
  /** Fully validated and repaired output — safe to store in artifacts. */
  output: Record<string, unknown>;
  /** Issues found, ordered by severity (blocker first). */
  issues: ValidationIssue[];
  /** What was auto-repaired. */
  repairs: RepairChange[];
  /**
   * `ok` — no blockers. The pipeline may proceed.
   * `repaired` — issues existed but were all auto-fixed; pipeline proceeds.
   * `deferred` — issues exist but a downstream agent can fix them; pipeline proceeds.
   * `blocked` — unrepairable errors; the pipeline MUST stop.
   */
  verdict: 'ok' | 'repaired' | 'deferred' | 'blocked';
  /** If verdict is 'blocked', a terminal reason for the UI / logger. */
  blockReason?: string;
}

// ── Small helpers ───────────────────────────────────────────

function arr<T = unknown>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function isStr(v: unknown): v is string  { return typeof v === 'string' && v.length > 0; }
function isNum(v: unknown): v is number  { return typeof v === 'number' && Number.isFinite(v); }
function isBool(v: unknown): v is boolean { return typeof v === 'boolean'; }

function makeIssue(
  id: string,
  message: string,
  category: ValidationIssue['category'],
  severity: ValidationSeverity,
  opts: { path?: string; fixableBy?: AgentRole } = {},
): ValidationIssue {
  return { id, message, category, severity, ...opts };
}

// ── Schema validation (driven by AGENT_DEFINITIONS) ─────────

/**
 * Validate the output against the agent's declared output schema from
 * agent-registry.ts. Every `required: true` field must exist and have a
 * compatible shape. Missing required fields are filled with safe defaults
 * wherever we can — empty array for `array`, empty object for `object`,
 * empty string for `string`, 0 for `number`, false for `boolean`.
 */
function validateSchema(
  role: AgentRole,
  rawOutput: Record<string, unknown>,
): { output: Record<string, unknown>; issues: ValidationIssue[]; repairs: RepairChange[] } {
  const def = getAgentDefinition(role);
  const schema = def.output.schema;
  const output: Record<string, unknown> = { ...rawOutput };
  const issues: ValidationIssue[] = [];
  const repairs: RepairChange[] = [];

  for (const [fieldName, field] of Object.entries(schema)) {
    const actual = output[fieldName];
    const expected = field.type;
    const present = actual !== undefined && actual !== null;

    // Type check when present
    if (present) {
      const typeOk =
        (expected === 'array'   && Array.isArray(actual)) ||
        (expected === 'object'  && typeof actual === 'object' && !Array.isArray(actual)) ||
        (expected === 'string'  && typeof actual === 'string') ||
        (expected === 'number'  && typeof actual === 'number') ||
        (expected === 'boolean' && typeof actual === 'boolean');

      if (!typeOk) {
        // Coerce to expected shape programmatically.
        const safe = defaultForType(expected);
        output[fieldName] = safe;
        repairs.push({
          path: fieldName,
          action: 'coerced-shape',
          detail: `Expected ${expected}, got ${Array.isArray(actual) ? 'array' : typeof actual}. Replaced with safe default.`,
        });
        if (field.required) {
          issues.push(makeIssue(
            `schema.${role}.${fieldName}.shape`,
            `Field "${fieldName}" expected ${expected} but got ${Array.isArray(actual) ? 'array' : typeof actual}; coerced to default.`,
            'shape',
            'warning',
            { path: fieldName },
          ));
        }
      }
      continue;
    }

    // Not present — fill default if required, else ignore.
    if (field.required) {
      output[fieldName] = defaultForType(expected);
      repairs.push({
        path: fieldName,
        action: 'filled-default',
        detail: `Required field "${fieldName}" was missing; filled with empty ${expected}.`,
      });
      issues.push(makeIssue(
        `schema.${role}.${fieldName}.missing`,
        `Required field "${fieldName}" missing from ${role} output; filled with empty ${expected}.`,
        'schema',
        'warning',
        { path: fieldName },
      ));
    }
  }

  return { output, issues, repairs };
}

function defaultForType(t: string): unknown {
  if (t === 'array')   return [];
  if (t === 'object')  return {};
  if (t === 'string')  return '';
  if (t === 'number')  return 0;
  if (t === 'boolean') return false;
  return null;
}

// ── Per-role semantic validation ────────────────────────────

/**
 * Semantic (not just schema) checks per agent role. These encode the
 * cross-step invariants that make the pipeline self-heal: e.g. developer
 * files not empty, reviewer issues have file paths, quality_enforcer
 * verdict is a known value.
 */
function validateSemantic(
  role: AgentRole,
  output: Record<string, unknown>,
  state: PipelineState,
): { output: Record<string, unknown>; issues: ValidationIssue[]; repairs: RepairChange[] } {
  const issues: ValidationIssue[] = [];
  const repairs: RepairChange[] = [];
  const next = { ...output };

  switch (role) {
    case 'intent_expander':
      semanticIntent(next, issues);
      break;
    case 'planner':
      semanticPlanner(next, issues, repairs);
      break;
    case 'architect':
      semanticArchitect(next, issues, repairs);
      break;
    case 'developer':
      semanticDeveloper(next, issues, repairs, state);
      break;
    case 'reviewer':
      semanticReviewer(next, issues, repairs);
      break;
    case 'tester':
      semanticTester(next, issues, repairs);
      break;
    case 'debugger':
      semanticDebugger(next, issues, repairs, state);
      break;
    case 'quality_enforcer':
      semanticQuality(next, issues, repairs);
      break;
    case 'optimizer':
      semanticOptimizer(next, issues, repairs);
      break;
    case 'devops':
      semanticDevops(next, issues, repairs);
      break;
  }

  return { output: next, issues, repairs };
}

// ── Role-specific validators ────────────────────────────────

function semanticIntent(out: Record<string, unknown>, issues: ValidationIssue[]): void {
  const expanded = arr<string>(out['expandedPrompts']);
  if (expanded.length === 0 || !expanded.some((p) => isStr(p) && p.length > 20)) {
    issues.push(makeIssue(
      'intent.empty-expansion',
      'Intent expander produced no usable expandedPrompts. Downstream planning will have nothing to work with.',
      'empty-output',
      'blocker',
      { path: 'expandedPrompts' },
    ));
  }
}

function semanticPlanner(
  out: Record<string, unknown>, issues: ValidationIssue[], repairs: RepairChange[],
): void {
  const tasks = arr<Record<string, unknown>>(out['tasks']);
  if (tasks.length === 0) {
    issues.push(makeIssue(
      'planner.no-tasks',
      'Planner produced zero tasks. The architect will have no work to decompose.',
      'empty-output',
      'blocker',
      { path: 'tasks' },
    ));
  }
  // Ensure every task at least has an id.
  const clean = tasks.map((t, i) => {
    if (!isStr(t['id'])) {
      const fixed = { ...t, id: `task-${i + 1}` };
      repairs.push({ path: `tasks[${i}].id`, action: 'filled-default', detail: 'Synthesized task id.' });
      return fixed;
    }
    return t;
  });
  out['tasks'] = clean;
}

function semanticArchitect(
  out: Record<string, unknown>, issues: ValidationIssue[], repairs: RepairChange[],
): void {
  const fileTree = arr<Record<string, unknown>>(out['fileTree']);
  if (fileTree.length === 0) {
    issues.push(makeIssue(
      'architect.no-files',
      'Architect produced no fileTree entries. The developer would generate nothing.',
      'empty-output',
      'blocker',
      { path: 'fileTree' },
    ));
  }
  // Remove any entries without a path.
  const clean = fileTree.filter((f, i) => {
    if (!isStr(f['path'])) {
      repairs.push({ path: `fileTree[${i}]`, action: 'removed-invalid', detail: 'Entry had no path.' });
      return false;
    }
    return true;
  });
  out['fileTree'] = clean;
}

function semanticDeveloper(
  out: Record<string, unknown>,
  issues: ValidationIssue[],
  repairs: RepairChange[],
  state: PipelineState,
): void {
  const files = arr<Record<string, unknown>>(out['files']);

  if (files.length === 0) {
    issues.push(makeIssue(
      'developer.no-files',
      'Developer generated zero files. Pipeline cannot proceed — nothing to review, test, or deploy.',
      'empty-output',
      'blocker',
      { path: 'files' },
    ));
    return;
  }

  // Strip entries without path or content.
  const clean: Record<string, unknown>[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!isStr(f['path'])) {
      repairs.push({ path: `files[${i}]`, action: 'removed-invalid', detail: 'File missing path.' });
      continue;
    }
    if (typeof f['content'] !== 'string') {
      // Empty content permitted (e.g. .gitkeep); just coerce to string.
      repairs.push({ path: `files[${i}].content`, action: 'coerced-shape', detail: 'File content coerced to string.' });
      clean.push({ ...f, content: '' });
    } else {
      clean.push(f);
    }
  }
  out['files'] = clean;

  // Cross-step: every generated file should map to the architect file tree.
  // If the overlap is below 40%, flag schema-drift; the developer drifted.
  const archArtifact = state.artifacts.get('architect');
  const archTree = arr<Record<string, unknown>>(archArtifact?.['fileTree']);
  if (archTree.length > 0) {
    const archPaths = new Set(archTree.map((t) => String(t['path'] ?? '')));
    const genPaths = clean.map((f) => String(f['path']));
    const overlap = genPaths.filter((p) => archPaths.has(p)).length;
    const ratio = genPaths.length > 0 ? overlap / genPaths.length : 0;
    if (ratio < 0.4 && overlap < 3) {
      issues.push(makeIssue(
        'developer.arch-drift',
        `Developer files diverge from architect fileTree (only ${overlap}/${genPaths.length} match). Reviewer/debugger will need to reconcile.`,
        'cross-step',
        'warning',
        { path: 'files', fixableBy: 'reviewer' },
      ));
    }
  }
}

function semanticReviewer(
  out: Record<string, unknown>, issues: ValidationIssue[], _repairs: RepairChange[],
): void {
  const reviewIssues = arr<Record<string, unknown>>(out['issues']);
  const score = isNum(out['score']) ? (out['score'] as number) : 100;

  // If the reviewer found many issues OR a low score, the debugger is
  // responsible for fixing them next. Not a blocker — defer.
  const critical = reviewIssues.filter((i) => String(i['severity']).toLowerCase() === 'critical').length;
  const errors   = reviewIssues.filter((i) => String(i['severity']).toLowerCase() === 'error'   ).length;

  if (critical > 0 || score < 50 || errors > 10) {
    issues.push(makeIssue(
      'reviewer.failing-score',
      `Reviewer score ${score}/100 with ${critical} critical + ${errors} error issues. Debugger must resolve before the pipeline can proceed.`,
      'code-quality',
      'error',
      { fixableBy: 'debugger' },
    ));
  }

  // Coerce passable
  if (!isBool(out['passable'])) {
    out['passable'] = critical === 0 && errors < 5 && score >= 70;
  }
}

function semanticTester(
  out: Record<string, unknown>, _issues: ValidationIssue[], repairs: RepairChange[],
): void {
  // Non-critical. If no tests were produced just coerce to empty array.
  const testFiles = arr(out['testFiles']);
  if (!Array.isArray(out['testFiles'])) {
    out['testFiles'] = testFiles;
    repairs.push({ path: 'testFiles', action: 'coerced-shape', detail: 'Coerced to array.' });
  }
  if (!out['coverage'] || typeof out['coverage'] !== 'object') {
    out['coverage'] = {};
    repairs.push({ path: 'coverage', action: 'filled-default', detail: 'Coerced to empty object.' });
  }
}

function semanticDebugger(
  out: Record<string, unknown>,
  issues: ValidationIssue[],
  repairs: RepairChange[],
  state: PipelineState,
): void {
  const patches    = arr<Record<string, unknown>>(out['patches']);
  const unresolved = arr<Record<string, unknown>>(out['unresolved']);

  // If the reviewer produced issues and the debugger produced zero patches
  // AND zero unresolved → something is wrong: we silently lost information.
  const reviewArt = state.artifacts.get('reviewer');
  const reviewIssues = arr(reviewArt?.['issues']);
  if (reviewIssues.length > 0 && patches.length === 0 && unresolved.length === 0) {
    // Promote all reviewer issues to unresolved so quality_enforcer sees them.
    out['unresolved'] = reviewIssues;
    repairs.push({
      path: 'unresolved',
      action: 'aligned-schema',
      detail: `Debugger emitted no patches AND no unresolved — forwarded ${reviewIssues.length} reviewer issues to unresolved.`,
    });
    issues.push(makeIssue(
      'debugger.dropped-issues',
      'Debugger returned empty patches and empty unresolved while reviewer reported issues. Forwarded issues to quality_enforcer.',
      'cross-step',
      'warning',
      { fixableBy: 'quality_enforcer' },
    ));
  }
}

function semanticQuality(
  out: Record<string, unknown>, issues: ValidationIssue[], repairs: RepairChange[],
): void {
  const verdict = String(out['verdict'] ?? '').toLowerCase();
  if (verdict !== 'pass' && verdict !== 'needs-improvement') {
    out['verdict'] = 'needs-improvement';
    repairs.push({ path: 'verdict', action: 'coerced-shape', detail: `Unknown verdict "${verdict}"; normalized to 'needs-improvement'.` });
  }

  const scores = obj(out['scores']);
  const findings = arr<Record<string, unknown>>(out['findings']);

  // UI dimension below bar → signal that the UI must be re-run.
  const uiScore = isNum(scores['ui']) ? (scores['ui'] as number)
                : isNum(scores['uiQuality']) ? (scores['uiQuality'] as number)
                : undefined;

  if (uiScore !== undefined && uiScore < 50) {
    issues.push(makeIssue(
      'quality.ui-broken',
      `Quality enforcer scored UI ${uiScore}/100 — below the 50 threshold. UI must be repaired.`,
      'ui-broken',
      'error',
      { fixableBy: 'quality_enforcer' },
    ));
  }

  // Critical findings → error, not blocker (quality_enforcer already ran
  // once; escalating to blocker would kill the pipeline at the final
  // gate. We surface them as errors instead.)
  const critical = findings.filter((f) => String(f['severity']).toLowerCase() === 'critical').length;
  if (critical > 0) {
    issues.push(makeIssue(
      'quality.critical-findings',
      `Quality enforcer reported ${critical} critical findings.`,
      'code-quality',
      'error',
    ));
  }
}

function semanticOptimizer(
  out: Record<string, unknown>, _issues: ValidationIssue[], repairs: RepairChange[],
): void {
  if (!Array.isArray(out['patches'])) { out['patches'] = []; repairs.push({ path: 'patches', action: 'coerced-shape', detail: 'Coerced to array.' }); }
  if (!Array.isArray(out['recommendations'])) { out['recommendations'] = []; repairs.push({ path: 'recommendations', action: 'coerced-shape', detail: 'Coerced to array.' }); }
  if (!out['perfEstimate'] || typeof out['perfEstimate'] !== 'object') { out['perfEstimate'] = {}; repairs.push({ path: 'perfEstimate', action: 'filled-default', detail: 'Filled empty perfEstimate.' }); }
}

function semanticDevops(
  out: Record<string, unknown>, _issues: ValidationIssue[], repairs: RepairChange[],
): void {
  if (!Array.isArray(out['files'])) { out['files'] = []; repairs.push({ path: 'files', action: 'coerced-shape', detail: 'Coerced to array.' }); }
}

// ── Public entry point ──────────────────────────────────────

/**
 * Validate + auto-repair a completed step's output. This is called from
 * the orchestrator immediately after a step transitions to `completed`.
 *
 * Returns a `ValidationResult` whose `verdict` tells the orchestrator
 * whether the pipeline can proceed. The user's rule — "the system must
 * NOT proceed if errors exist" — is encoded here: if any issue has
 * severity `blocker` and wasn't auto-repaired, `verdict` is `'blocked'`
 * and the orchestrator MUST halt.
 */
export function validateAndRepair(
  role: AgentRole,
  rawOutput: Record<string, unknown> | undefined,
  state: PipelineState,
): ValidationResult {
  const initial = rawOutput && typeof rawOutput === 'object' ? rawOutput : {};

  // 1. Schema-level (required fields, types)
  const schemaStep = validateSchema(role, initial);

  // 2. Semantic (cross-step, empty output, ui-broken, etc.)
  const semStep = validateSemantic(role, schemaStep.output, state);

  const issues = [...schemaStep.issues, ...semStep.issues].sort(severitySort);
  const repairs = [...schemaStep.repairs, ...semStep.repairs];
  const output  = semStep.output;

  const blockers = issues.filter((i) => i.severity === 'blocker');
  const errors   = issues.filter((i) => i.severity === 'error');
  const hasDeferrable = errors.some((i) => !!i.fixableBy);

  let verdict: ValidationResult['verdict'];
  let blockReason: string | undefined;

  if (blockers.length > 0) {
    verdict = 'blocked';
    blockReason = blockers.map((b) => b.message).join(' | ');
  } else if (errors.length > 0 && hasDeferrable) {
    verdict = 'deferred';
  } else if (errors.length > 0) {
    verdict = 'blocked';
    blockReason = errors.map((e) => e.message).join(' | ');
  } else if (repairs.length > 0 || issues.length > 0) {
    verdict = 'repaired';
  } else {
    verdict = 'ok';
  }

  return { output, issues, repairs, verdict, blockReason };
}

function severitySort(a: ValidationIssue, b: ValidationIssue): number {
  const order: Record<ValidationSeverity, number> = { blocker: 0, error: 1, warning: 2, info: 3 };
  return order[a.severity] - order[b.severity];
}
