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
    | 'code-quality'       // reviewer issues above threshold
    | 'logical-inconsistency' // spec internally inconsistent (e.g. dangling ref)
    | 'contract-violation'; // agent broke its declared output contract
  severity: ValidationSeverity;
  /** Field path that triggered the issue, when applicable. */
  path?: string;
  /** A downstream agent role that could fix this. */
  fixableBy?: AgentRole;
}

export interface RepairChange {
  path: string;
  action: 'filled-default' | 'coerced-shape' | 'removed-invalid' | 'aligned-schema' | 'defaulted' | 'deduped';
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
      semanticReviewer(next, issues, repairs, state);
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

  // ── Strict contract: apiContracts, frontendPages, components, dataFlowMap, dependencyList ──

  // apiContracts — every one must have method + path; synthesize id from method+path if missing; dedup by id.
  const apiContracts = arr<Record<string, unknown>>(out['apiContracts']);
  if (apiContracts.length === 0) {
    issues.push(makeIssue(
      'architect.no-api-contracts',
      'Architect produced zero apiContracts. Every backend route the frontend needs must be declared.',
      'empty-output',
      'error',
      { path: 'apiContracts', fixableBy: 'architect' },
    ));
  }
  const seenIds = new Set<string>();
  const cleanApi: Record<string, unknown>[] = [];
  for (let i = 0; i < apiContracts.length; i++) {
    const c = apiContracts[i];
    if (!isStr(c['method']) || !isStr(c['path'])) {
      repairs.push({ path: `apiContracts[${i}]`, action: 'removed-invalid', detail: 'Contract missing method or path.' });
      continue;
    }
    let id = isStr(c['id']) ? c['id'] : `${String(c['method']).toLowerCase()}:${c['path']}`;
    if (seenIds.has(id)) {
      repairs.push({ path: `apiContracts[${i}].id`, action: 'deduped', detail: `Duplicate id "${id}" — suffixed with index.` });
      id = `${id}#${i}`;
    }
    seenIds.add(id);
    c['id'] = id;
    if (!c['requestSchema'])  { c['requestSchema']  = {}; repairs.push({ path: `apiContracts[${i}].requestSchema`,  action: 'defaulted', detail: 'Empty object.' }); }
    if (!c['responseSchema']) { c['responseSchema'] = {}; repairs.push({ path: `apiContracts[${i}].responseSchema`, action: 'defaulted', detail: 'Empty object.' }); }
    if (!Array.isArray(c['errorResponses'])) {
      c['errorResponses'] = [
        { status: 400, body: { error: 'string', message: 'string' } },
        { status: 500, body: { error: 'string', message: 'string' } },
      ];
      repairs.push({ path: `apiContracts[${i}].errorResponses`, action: 'defaulted', detail: 'Inserted 400/500 baseline.' });
    }
    cleanApi.push(c);
  }
  out['apiContracts'] = cleanApi;

  // frontendPages — non-empty, dataDeps resolve to an existing apiId or are mocked.
  const pages = arr<Record<string, unknown>>(out['frontendPages']);
  if (pages.length === 0) {
    issues.push(makeIssue(
      'architect.no-frontend-pages',
      'Architect produced zero frontendPages. Every app route must be declared with its data dependencies.',
      'empty-output',
      'error',
      { path: 'frontendPages', fixableBy: 'architect' },
    ));
  }
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const deps = arr<Record<string, unknown>>(p['dataDeps']);
    for (let j = 0; j < deps.length; j++) {
      const d = deps[j];
      const apiId  = d['apiId'];
      const mocked = d['mocked'] === true;
      if (!mocked && isStr(apiId) && !seenIds.has(apiId)) {
        issues.push(makeIssue(
          'architect.dangling-api-ref',
          `frontendPages[${i}].dataDeps[${j}] references apiId "${apiId}" which is not in apiContracts.`,
          'logical-inconsistency',
          'error',
          { path: `frontendPages[${i}].dataDeps[${j}].apiId`, fixableBy: 'architect' },
        ));
      }
      if (!mocked && !isStr(apiId)) {
        // Auto-repair: if no apiId and not explicitly mocked, flip to mocked with a reason so it doesn't silently break.
        d['mocked'] = true;
        d['reason'] = d['reason'] ?? 'Auto-marked mocked — no apiId was provided.';
        repairs.push({
          path: `frontendPages[${i}].dataDeps[${j}]`,
          action: 'defaulted',
          detail: 'No apiId + no mocked flag → marked mocked:true with reason.',
        });
      }
    }
  }

  // components — must have name + path; drop invalid.
  const components = arr<Record<string, unknown>>(out['components']);
  const seenComp = new Set<string>();
  const cleanComp: Record<string, unknown>[] = [];
  for (let i = 0; i < components.length; i++) {
    const c = components[i];
    if (!isStr(c['name']) || !isStr(c['path'])) {
      repairs.push({ path: `components[${i}]`, action: 'removed-invalid', detail: 'Component missing name or path.' });
      continue;
    }
    if (seenComp.has(c['name'] as string)) {
      repairs.push({ path: `components[${i}]`, action: 'removed-invalid', detail: `Duplicate component name "${c['name']}".` });
      continue;
    }
    seenComp.add(c['name'] as string);
    cleanComp.push(c);
  }
  out['components'] = cleanComp;

  // dataFlowMap — every entry must reference a real apiId.
  const flow = arr<Record<string, unknown>>(out['dataFlowMap']);
  const cleanFlow: Record<string, unknown>[] = [];
  for (let i = 0; i < flow.length; i++) {
    const f = flow[i];
    const to = obj(f['to']);
    const apiId = to['apiId'];
    if (!isStr(apiId) || !seenIds.has(apiId)) {
      repairs.push({ path: `dataFlowMap[${i}]`, action: 'removed-invalid', detail: `Flow references unknown apiId "${String(apiId)}".` });
      continue;
    }
    cleanFlow.push(f);
  }
  out['dataFlowMap'] = cleanFlow;

  // dependencyList — must be an object with at least a frontend or backend array; no empty-name entries.
  const depList = obj(out['dependencyList']);
  for (const bucket of ['frontend', 'backend', 'dev'] as const) {
    const list = arr<Record<string, unknown>>(depList[bucket]);
    depList[bucket] = list.filter((d, idx) => {
      if (!isStr(d['name'])) {
        repairs.push({ path: `dependencyList.${bucket}[${idx}]`, action: 'removed-invalid', detail: 'Dependency missing name.' });
        return false;
      }
      return true;
    });
  }
  out['dependencyList'] = depList;
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

  // ── Strict implementation contract (apiContracts / frontendPages / components must each be covered) ──
  if (archArtifact) {
    const genPaths     = clean.map((f) => String(f['path']));
    const genContent   = clean.map((f) => String(f['content'] ?? ''));
    const allContent   = genContent.join('\n');
    const pathSet      = new Set(genPaths);

    // 1. API contracts — every contract's path should appear in some backend file's content.
    const contracts = arr<Record<string, unknown>>(archArtifact['apiContracts']);
    const missingContracts: string[] = [];
    for (const c of contracts) {
      const method = String(c['method'] ?? '').toUpperCase();
      const p      = String(c['path'] ?? '');
      if (!p) continue;
      const idLabel = isStr(c['id']) ? c['id'] : `${method} ${p}`;
      // Match if the path literal appears anywhere in any file, or a route file exists whose
      // content mentions both the method and the path.
      const hit = allContent.includes(p) || allContent.includes(`"${p}"`) || allContent.includes(`'${p}'`);
      if (!hit) missingContracts.push(idLabel);
    }
    if (missingContracts.length > 0) {
      issues.push(makeIssue(
        'developer.missing-api-contracts',
        `Developer did not implement ${missingContracts.length} apiContract(s): ${missingContracts.slice(0, 5).join(', ')}${missingContracts.length > 5 ? ', …' : ''}. The debugger must add the missing route handlers.`,
        'cross-step',
        'error',
        { path: 'files', fixableBy: 'debugger' },
      ));
    }

    // 2. Frontend pages — every page file path must exist in the generated set (or a close variant).
    const pages = arr<Record<string, unknown>>(archArtifact['frontendPages']);
    const missingPages: string[] = [];
    for (const pg of pages) {
      const file = String(pg['file'] ?? '');
      const name = String(pg['name'] ?? file);
      if (!file) continue;
      if (!pathSet.has(file) && !genPaths.some((gp) => gp.endsWith(file) || file.endsWith(gp))) {
        missingPages.push(name);
      }
    }
    if (missingPages.length > 0) {
      issues.push(makeIssue(
        'developer.missing-pages',
        `Developer did not implement ${missingPages.length} frontend page(s): ${missingPages.slice(0, 5).join(', ')}${missingPages.length > 5 ? ', …' : ''}.`,
        'cross-step',
        'error',
        { path: 'files', fixableBy: 'debugger' },
      ));
    }

    // 3. Components — every component file path must exist.
    const components = arr<Record<string, unknown>>(archArtifact['components']);
    const missingComponents: string[] = [];
    for (const comp of components) {
      const file = String(comp['path'] ?? '');
      const name = String(comp['name'] ?? file);
      if (!file) continue;
      if (!pathSet.has(file) && !genPaths.some((gp) => gp.endsWith(file))) {
        missingComponents.push(name);
      }
    }
    if (missingComponents.length > 0) {
      issues.push(makeIssue(
        'developer.missing-components',
        `Developer did not implement ${missingComponents.length} component(s): ${missingComponents.slice(0, 5).join(', ')}${missingComponents.length > 5 ? ', …' : ''}.`,
        'cross-step',
        'error',
        { path: 'files', fixableBy: 'debugger' },
      ));
    }

    // 4. Checklist file — required by the developer prompt; any "[ ]" box = failure.
    const checklist = clean.find((f) => /IMPLEMENTATION_CHECKLIST\.md$/i.test(String(f['path'])));
    if (!checklist) {
      issues.push(makeIssue(
        'developer.missing-checklist',
        'Developer did not emit IMPLEMENTATION_CHECKLIST.md. The contract requires a machine-readable checklist as the last file.',
        'contract-violation',
        'error',
        { path: 'files', fixableBy: 'debugger' },
      ));
    } else {
      const body = String(checklist['content'] ?? '');
      const uncheckedCount = (body.match(/^\s*-\s*\[\s\]/gmu) ?? []).length;
      if (uncheckedCount > 0) {
        issues.push(makeIssue(
          'developer.unchecked-items',
          `IMPLEMENTATION_CHECKLIST.md contains ${uncheckedCount} unchecked item(s). Per the contract, any "[ ]" box invalidates the output.`,
          'contract-violation',
          'error',
          { path: 'IMPLEMENTATION_CHECKLIST.md', fixableBy: 'debugger' },
        ));
      }
    }

    // 5. Explicit failure file — if the developer emitted IMPLEMENTATION_BLOCKED.md, escalate to blocker.
    const blocked = clean.find((f) => /IMPLEMENTATION_BLOCKED\.md$/i.test(String(f['path'])));
    if (blocked) {
      issues.push(makeIssue(
        'developer.blocked',
        `Developer emitted IMPLEMENTATION_BLOCKED.md — it could not implement part of the spec. Review the file and re-architect.`,
        'contract-violation',
        'blocker',
        { path: 'IMPLEMENTATION_BLOCKED.md' },
      ));
    }
  }
}

function semanticReviewer(
  out: Record<string, unknown>, issues: ValidationIssue[], _repairs: RepairChange[],
  state: PipelineState,
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

  // ── Deterministic full-stack completeness validation (LLM-free) ──
  // Cross-references architect spec vs developer output. These checks run regardless of
  // what the LLM reviewer said so the binary FAIL contract is honoured mechanically.
  const arch = state.artifacts.get('architect');
  const dev  = state.artifacts.get('developer');
  const missingItems: string[] = arr<string>(out['missingItems']).filter((m) => typeof m === 'string');

  if (arch && dev) {
    const files = arr<Record<string, unknown>>(dev['files']);
    const genPaths = files.map((f) => String(f['path'] ?? ''));
    const allContent = files.map((f) => String(f['content'] ?? '')).join('\n');

    // 1. apiContracts → backend route presence. Route literal must appear in some file.
    const contracts = arr<Record<string, unknown>>(arch['apiContracts']);
    let routeHits = 0;
    for (const c of contracts) {
      const p = String(c['path'] ?? '');
      const id = isStr(c['id']) ? c['id'] : `${String(c['method'] ?? '').toUpperCase()} ${p}`;
      if (!p) continue;
      const hit = allContent.includes(`"${p}"`) || allContent.includes(`'${p}'`) || allContent.includes(`\`${p}\``);
      if (hit) { routeHits++; } else {
        missingItems.push(`missing route: ${id} — declared in apiContracts, not found in backend`);
      }
    }

    // 6. Backend route count == 0 && apiContracts non-empty → FAIL
    if (contracts.length > 0 && routeHits === 0) {
      missingItems.push(`broken wiring: ${contracts.length} apiContracts declared but zero backend routes implemented`);
    }
    // 3. apiContracts count > implemented routes
    if (contracts.length > routeHits) {
      // already recorded per-contract above; no duplicate entry
    }

    // 2 + 7. Frontend fetch targets must exist in apiContracts (or be full URLs to external APIs).
    const contractPaths = new Set(contracts.map((c) => String(c['path'] ?? '')).filter(Boolean));
    const fetchRe = /(?:fetch|axios(?:\.(?:get|post|put|patch|delete))?|useSWR|useQuery(?:ies)?)\s*\(\s*[`'"]([^`'"\s]+)[`'"]/g;
    const seenTargets = new Set<string>();
    for (const f of files) {
      const path = String(f['path'] ?? '');
      if (!/\.(tsx?|jsx?|vue|svelte)$/.test(path)) continue;
      if (!/(src\/app|src\/pages|src\/components|src\/routes\/pages|app\/|pages\/|components\/)/i.test(path) && !/\.(tsx|jsx)$/.test(path)) continue;
      const content = String(f['content'] ?? '');
      let m: RegExpExecArray | null;
      fetchRe.lastIndex = 0;
      while ((m = fetchRe.exec(content)) !== null) {
        const target = m[1];
        if (!target || seenTargets.has(target)) continue;
        seenTargets.add(target);
        // Ignore external URLs, template vars, env placeholders.
        if (/^https?:\/\//.test(target))         continue;
        if (target.includes('${') || target.includes('{{')) continue;
        if (target.startsWith('/_next') || target.startsWith('/static')) continue;
        // Check it resolves to an apiContract path (exact or parameterised).
        const resolved = [...contractPaths].some((cp) => {
          if (cp === target) return true;
          // Parameterised match: /api/users/:id ~ /api/users/123
          const re = new RegExp('^' + cp.replace(/:[a-zA-Z_][\w]*/g, '[^/]+') + '$');
          return re.test(target);
        });
        if (!resolved) {
          missingItems.push(`broken contract: ${path} fetches "${target}" but no matching apiContract exists`);
        }
      }
    }

    // 4. frontendPages data dependencies
    const pages = arr<Record<string, unknown>>(arch['frontendPages']);
    const apiIds = new Set(contracts.map((c) => String(c['id'] ?? '')).filter(Boolean));
    for (const pg of pages) {
      const pageFile = String(pg['file'] ?? '');
      const pageName = String(pg['name'] ?? pageFile);
      const deps = arr<Record<string, unknown>>(pg['dataDeps']);
      for (const d of deps) {
        if (d['mocked'] === true) continue;
        const apiId = d['apiId'];
        if (!isStr(apiId) || !apiIds.has(apiId)) {
          missingItems.push(`missing data wiring: page ${pageName} declares dataDep "${String(apiId)}" but no matching apiContract`);
        }
      }
      // page must be implemented
      if (pageFile && !genPaths.some((gp) => gp === pageFile || gp.endsWith(pageFile))) {
        missingItems.push(`missing page: ${pageName} (${pageFile}) — declared in frontendPages, not implemented`);
      }
    }

    // 8. Components
    const components = arr<Record<string, unknown>>(arch['components']);
    for (const c of components) {
      const file = String(c['path'] ?? '');
      const name = String(c['name'] ?? file);
      if (file && !genPaths.some((gp) => gp === file || gp.endsWith(file))) {
        missingItems.push(`missing component: ${name} (${file})`);
      }
    }

    // 5. package.json dependencies — flag obviously invented names.
    const pkgFile = files.find((f) => /(^|\/)package\.json$/.test(String(f['path'] ?? '')));
    if (pkgFile) {
      try {
        const pkg = JSON.parse(String(pkgFile['content'] ?? '{}'));
        const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
        const declaredDeps = new Set<string>();
        const depList = obj(arch['dependencyList']);
        for (const bucket of ['frontend', 'backend', 'dev'] as const) {
          for (const d of arr<Record<string, unknown>>(depList[bucket])) {
            if (isStr(d['name'])) declaredDeps.add(d['name']);
          }
        }
        for (const name of Object.keys(deps)) {
          // Phantom: looks invented — contains obvious placeholder markers.
          if (/(^foo|^bar|^baz|placeholder|^my-|^todo|^example-|^fake-)/i.test(name)) {
            missingItems.push(`missing dependency: package '${name}' in package.json is not a verified npm package`);
          }
          // Declared in architect's dependencyList? Only warn if it isn't — dependencyList is authoritative.
          if (declaredDeps.size > 0 && !declaredDeps.has(name) && !/^@types\//.test(name)) {
            // soft warning, do not add to missingItems to avoid noise
          }
        }
      } catch {
        missingItems.push('broken package.json: could not parse');
      }
    }

    // 9. Checklist
    const checklist = files.find((f) => /IMPLEMENTATION_CHECKLIST\.md$/i.test(String(f['path'] ?? '')));
    if (!checklist) {
      missingItems.push('missing IMPLEMENTATION_CHECKLIST.md');
    } else {
      const unchecked = (String(checklist['content'] ?? '').match(/^\s*-\s*\[\s\]/gmu) ?? []).length;
      if (unchecked > 0) missingItems.push(`checklist has ${unchecked} unchecked item(s)`);
    }

    // 10. Blocked file
    if (files.some((f) => /IMPLEMENTATION_BLOCKED\.md$/i.test(String(f['path'] ?? '')))) {
      missingItems.push('IMPLEMENTATION_BLOCKED.md present — developer gave up on part of the spec');
    }
  }

  // Dedupe and write back.
  out['missingItems'] = [...new Set(missingItems)];

  // Binary verdict — deterministic, overrides the LLM if it disagreed.
  const mechanicalFail = (out['missingItems'] as string[]).length > 0;
  if (mechanicalFail) {
    out['validationResult'] = 'FAIL';
    out['passable'] = false;
    out['score'] = 0;
    issues.push(makeIssue(
      'reviewer.binary-fail',
      `Full-stack QA: ${(out['missingItems'] as string[]).length} completeness failure(s). The debugger must resolve all missing items.`,
      'contract-violation',
      'error',
      { fixableBy: 'debugger' },
    ));
  } else {
    if (!isStr(out['validationResult'])) out['validationResult'] = 'PASS';
    // Coerce passable from score/issues if the LLM omitted it.
    if (!isBool(out['passable'])) {
      out['passable'] = critical === 0 && errors < 5 && score >= 70;
    }
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
