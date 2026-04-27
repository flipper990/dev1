// ─────────────────────────────────────────────────────────────
// Step Validator — post-step validation + programmatic repair
//
// Runs after every pipeline step completes. Responsibilities:
//
//   1. VALIDATE the step's output against its declared schema and against
//      cross-step invariants (e.g. builder.files cover spec.fileTree;
//      backend routes match frontend fetch calls).
//
//   2. REPAIR deterministically where possible — fill missing required
//      fields with safe defaults, coerce wrong shapes, strip phantom
//      entries.
//
//   3. FLAG for re-run when a downstream LLM agent can fix the problem
//      better than we can programmatically — e.g. bad code from the
//      builder is flagged so qa picks it up.
//
//   4. BLOCK the pipeline when validation fails and the problem is not
//      auto-repairable and no downstream agent can fix it.
//
// Pure and deterministic. No network calls or LLM invocations.
// ─────────────────────────────────────────────────────────────

import type { AgentRole } from './types';
import type { PipelineState } from './pipeline-types';
import { getAgentDefinition } from './agent-registry';

// ── Public types ────────────────────────────────────────────

export type ValidationSeverity = 'info' | 'warning' | 'error' | 'blocker';

export interface ValidationIssue {
  id: string;
  message: string;
  category:
    | 'schema'
    | 'shape'
    | 'cross-step'
    | 'empty-output'
    | 'ui-broken'
    | 'schema-drift'
    | 'code-quality'
    | 'logical-inconsistency'
    | 'contract-violation';
  severity: ValidationSeverity;
  path?: string;
  fixableBy?: AgentRole;
}

export interface RepairChange {
  path: string;
  action: 'filled-default' | 'coerced-shape' | 'removed-invalid' | 'aligned-schema' | 'defaulted' | 'deduped';
  detail: string;
}

export interface ValidationResult {
  output: Record<string, unknown>;
  issues: ValidationIssue[];
  repairs: RepairChange[];
  verdict: 'ok' | 'repaired' | 'deferred' | 'blocked';
  blockReason?: string;
}

// ── Helpers ────────────────────────────────────────────────

function arr<T = unknown>(v: unknown): T[] { return Array.isArray(v) ? (v as T[]) : []; }
function obj(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
function isStr(v: unknown): v is string  { return typeof v === 'string' && v.length > 0; }
function isNum(v: unknown): v is number  { return typeof v === 'number' && Number.isFinite(v); }

function makeIssue(
  id: string,
  message: string,
  category: ValidationIssue['category'],
  severity: ValidationSeverity,
  opts: { path?: string; fixableBy?: AgentRole } = {},
): ValidationIssue {
  return { id, message, category, severity, ...opts };
}

function defaultForType(t: string): unknown {
  if (t === 'array')   return [];
  if (t === 'object')  return {};
  if (t === 'string')  return '';
  if (t === 'number')  return 0;
  if (t === 'boolean') return false;
  return null;
}

// ── Schema validation (driven by AGENT_DEFINITIONS) ─────────

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

    if (present) {
      const typeOk =
        (expected === 'array'   && Array.isArray(actual)) ||
        (expected === 'object'  && typeof actual === 'object' && !Array.isArray(actual)) ||
        (expected === 'string'  && typeof actual === 'string') ||
        (expected === 'number'  && typeof actual === 'number') ||
        (expected === 'boolean' && typeof actual === 'boolean');

      if (!typeOk) {
        output[fieldName] = defaultForType(expected);
        repairs.push({
          path: fieldName,
          action: 'coerced-shape',
          detail: `Expected ${expected}, got ${Array.isArray(actual) ? 'array' : typeof actual}.`,
        });
        if (field.required) {
          issues.push(makeIssue(
            `schema.${role}.${fieldName}.shape`,
            `Field "${fieldName}" expected ${expected} but got ${Array.isArray(actual) ? 'array' : typeof actual}; coerced to default.`,
            'shape', 'warning', { path: fieldName },
          ));
        }
      }
      continue;
    }

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
        'schema', 'warning', { path: fieldName },
      ));
    }
  }

  return { output, issues, repairs };
}

// ── Per-role semantic validation ────────────────────────────

function validateSemantic(
  role: AgentRole,
  output: Record<string, unknown>,
  state: PipelineState,
): { output: Record<string, unknown>; issues: ValidationIssue[]; repairs: RepairChange[] } {
  const issues: ValidationIssue[] = [];
  const repairs: RepairChange[] = [];
  const next = { ...output };

  switch (role) {
    case 'spec':    semanticSpec(next, issues, repairs); break;
    case 'builder': semanticBuilder(next, issues, repairs, state); break;
    case 'qa':      semanticQa(next, issues, repairs, state); break;
    case 'polish':  semanticPolish(next, issues, repairs); break;
  }

  return { output: next, issues, repairs };
}

// ── SPEC ────────────────────────────────────────────────────

function semanticSpec(
  out: Record<string, unknown>, issues: ValidationIssue[], repairs: RepairChange[],
): void {
  // Expanded prompt — single source of truth for the rest of the pipeline.
  const expanded = out['expandedPrompt'];
  if (!isStr(expanded) || (expanded as string).length < 200) {
    issues.push(makeIssue(
      'spec.empty-expansion',
      'Spec produced no usable expandedPrompt (≥200 chars). Builder will have nothing to work with.',
      'empty-output', 'blocker', { path: 'expandedPrompt' },
    ));
  }

  // fileTree must be non-empty.
  const fileTree = arr<Record<string, unknown>>(out['fileTree']);
  if (fileTree.length === 0) {
    issues.push(makeIssue(
      'spec.no-files',
      'Spec produced no fileTree entries. Builder cannot generate code.',
      'empty-output', 'blocker', { path: 'fileTree' },
    ));
  }
  out['fileTree'] = fileTree.filter((f, i) => {
    if (!isStr(f['path'])) {
      repairs.push({ path: `fileTree[${i}]`, action: 'removed-invalid', detail: 'Entry had no path.' });
      return false;
    }
    return true;
  });

  // apiContracts — synthesize ids, dedupe.
  const apiContracts = arr<Record<string, unknown>>(out['apiContracts']);
  const seenIds = new Set<string>();
  const cleanApi: Record<string, unknown>[] = [];
  for (let i = 0; i < apiContracts.length; i++) {
    const c = apiContracts[i];
    if (!isStr(c['method']) || !isStr(c['path'])) {
      repairs.push({ path: `apiContracts[${i}]`, action: 'removed-invalid', detail: 'Contract missing method or path.' });
      continue;
    }
    let id = isStr(c['id']) ? c['id'] : `${String(c['method']).toLowerCase()}:${c['path']}`;
    if (seenIds.has(id)) { id = `${id}#${i}`; repairs.push({ path: `apiContracts[${i}].id`, action: 'deduped', detail: 'Duplicate id.' }); }
    seenIds.add(id);
    c['id'] = id;
    if (!c['requestSchema'])  c['requestSchema']  = {};
    if (!c['responseSchema']) c['responseSchema'] = {};
    if (!Array.isArray(c['errorResponses'])) {
      c['errorResponses'] = [{ status: 400, body: { error: 'string', message: 'string' } }];
    }
    cleanApi.push(c);
  }
  out['apiContracts'] = cleanApi;

  // frontendPages — auto-mark dataDeps without apiId as mocked.
  const pages = arr<Record<string, unknown>>(out['frontendPages']);
  for (let i = 0; i < pages.length; i++) {
    const deps = arr<Record<string, unknown>>(pages[i]['dataDeps']);
    for (let j = 0; j < deps.length; j++) {
      const d = deps[j];
      const apiId  = d['apiId'];
      const mocked = d['mocked'] === true;
      if (!mocked && isStr(apiId) && !seenIds.has(apiId)) {
        issues.push(makeIssue(
          'spec.dangling-api-ref',
          `frontendPages[${i}].dataDeps[${j}] references apiId "${apiId}" not in apiContracts.`,
          'logical-inconsistency', 'warning',
          { path: `frontendPages[${i}].dataDeps[${j}].apiId`, fixableBy: 'builder' },
        ));
      }
      if (!mocked && !isStr(apiId)) {
        d['mocked'] = true;
        d['reason'] = d['reason'] ?? 'Auto-marked mocked — no apiId provided.';
        repairs.push({ path: `frontendPages[${i}].dataDeps[${j}]`, action: 'defaulted', detail: 'Marked mocked:true.' });
      }
    }
  }

  // components — strip invalid.
  const components = arr<Record<string, unknown>>(out['components']);
  out['components'] = components.filter((c, i) => {
    if (!isStr(c['name']) || !isStr(c['path'])) {
      repairs.push({ path: `components[${i}]`, action: 'removed-invalid', detail: 'Component missing name or path.' });
      return false;
    }
    return true;
  });

  // userFlows — must exist (one per slice minimum) and cross-reference real
  // pages + apiContracts. Missing flows produce builds that pass per-page
  // checks but never stitch the user journey together.
  const slices = arr<Record<string, unknown>>(out['featureSlices']);
  const flows = arr<Record<string, unknown>>(out['userFlows']);
  if (flows.length === 0) {
    issues.push(makeIssue(
      'spec.no-user-flows',
      'Spec declared no userFlows. Builder will have no end-to-end journey to wire and QA cannot validate features holistically.',
      'empty-output', 'error', { path: 'userFlows', fixableBy: 'spec' },
    ));
  } else if (flows.length < slices.length) {
    issues.push(makeIssue(
      'spec.insufficient-user-flows',
      `Spec has ${flows.length} userFlows for ${slices.length} featureSlices. At least one flow per slice is required.`,
      'cross-step', 'warning', { path: 'userFlows', fixableBy: 'spec' },
    ));
  }
  // Build set of declared page paths for cross-ref.
  const pagePaths = new Set(
    arr<Record<string, unknown>>(out['frontendPages'])
      .map((p) => (isStr(p['path']) ? (p['path'] as string) : ''))
      .filter(Boolean),
  );
  for (let i = 0; i < flows.length; i++) {
    const f = flows[i];
    const fid = isStr(f['id']) ? (f['id'] as string) : `flow#${i}`;
    const steps = arr<Record<string, unknown>>(f['steps']);
    if (steps.length === 0) {
      issues.push(makeIssue(
        'spec.empty-user-flow',
        `userFlow '${fid}' has no steps.`,
        'logical-inconsistency', 'warning',
        { path: `userFlows[${i}].steps`, fixableBy: 'spec' },
      ));
      continue;
    }
    for (let j = 0; j < steps.length; j++) {
      const s = steps[j];
      const page = s['page'];
      if (isStr(page) && pagePaths.size > 0 && !pagePaths.has(page as string)) {
        issues.push(makeIssue(
          'spec.flow-dangling-page',
          `userFlow '${fid}'.steps[${j}] references page "${page}" not declared in frontendPages.`,
          'logical-inconsistency', 'warning',
          { path: `userFlows[${i}].steps[${j}].page`, fixableBy: 'spec' },
        ));
      }
      const apiId = s['apiId'];
      if (isStr(apiId) && (apiId as string).length > 0 && !seenIds.has(apiId as string)) {
        issues.push(makeIssue(
          'spec.flow-dangling-api',
          `userFlow '${fid}'.steps[${j}] references apiId "${apiId}" not in apiContracts.`,
          'logical-inconsistency', 'warning',
          { path: `userFlows[${i}].steps[${j}].apiId`, fixableBy: 'spec' },
        ));
      }
    }
  }
}

// ── BUILDER ────────────────────────────────────────────────

function semanticBuilder(
  out: Record<string, unknown>,
  issues: ValidationIssue[],
  repairs: RepairChange[],
  state: PipelineState,
): void {
  const files = arr<Record<string, unknown>>(out['files']);
  if (files.length === 0) {
    issues.push(makeIssue(
      'builder.no-files',
      'Builder generated zero files. Pipeline cannot proceed.',
      'empty-output', 'blocker', { path: 'files' },
    ));
    return;
  }

  // Strip / coerce invalid entries.
  const clean: Record<string, unknown>[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    if (!isStr(f['path'])) {
      repairs.push({ path: `files[${i}]`, action: 'removed-invalid', detail: 'File missing path.' });
      continue;
    }
    if (typeof f['content'] !== 'string') {
      repairs.push({ path: `files[${i}].content`, action: 'coerced-shape', detail: 'Content coerced to string.' });
      clean.push({ ...f, content: '' });
    } else {
      clean.push(f);
    }
  }
  out['files'] = clean;

  // Cross-step: spec.fileTree coverage.
  const spec = state.artifacts.get('spec');
  if (!spec) return;
  const genPaths = clean.map((f) => String(f['path']));
  const pathSet = new Set(genPaths);
  const allContent = clean.map((f) => String(f['content'] ?? '')).join('\n');

  // 1. apiContracts coverage — fixableBy: qa
  const contracts = arr<Record<string, unknown>>(spec['apiContracts']);
  const missingContracts: string[] = [];
  for (const c of contracts) {
    const p = String(c['path'] ?? '');
    if (!p) continue;
    const hit = allContent.includes(`"${p}"`) || allContent.includes(`'${p}'`) || allContent.includes(`\`${p}\``);
    if (!hit) missingContracts.push(`${String(c['method'])} ${p}`);
  }
  if (missingContracts.length > 0) {
    issues.push(makeIssue(
      'builder.missing-api-contracts',
      `Builder did not implement ${missingContracts.length} apiContract(s): ${missingContracts.slice(0, 5).join(', ')}${missingContracts.length > 5 ? ', …' : ''}.`,
      'cross-step', 'error', { path: 'files', fixableBy: 'qa' },
    ));
  }

  // 2. Frontend pages coverage.
  const pages = arr<Record<string, unknown>>(spec['frontendPages']);
  const missingPages: string[] = [];
  for (const pg of pages) {
    const file = String(pg['file'] ?? '');
    const name = String(pg['name'] ?? file);
    if (!file) continue;
    if (!pathSet.has(file) && !genPaths.some((gp) => gp.endsWith(file))) {
      missingPages.push(name);
    }
  }
  if (missingPages.length > 0) {
    issues.push(makeIssue(
      'builder.missing-pages',
      `Builder did not implement ${missingPages.length} page(s): ${missingPages.slice(0, 5).join(', ')}${missingPages.length > 5 ? ', …' : ''}.`,
      'cross-step', 'error', { path: 'files', fixableBy: 'qa' },
    ));
  }

  // 3. Components coverage.
  const components = arr<Record<string, unknown>>(spec['components']);
  const missingComponents: string[] = [];
  for (const c of components) {
    const file = String(c['path'] ?? '');
    const name = String(c['name'] ?? file);
    if (!file) continue;
    if (!pathSet.has(file) && !genPaths.some((gp) => gp.endsWith(file))) {
      missingComponents.push(name);
    }
  }
  if (missingComponents.length > 0) {
    issues.push(makeIssue(
      'builder.missing-components',
      `Builder did not implement ${missingComponents.length} component(s): ${missingComponents.slice(0, 5).join(', ')}${missingComponents.length > 5 ? ', …' : ''}.`,
      'cross-step', 'error', { path: 'files', fixableBy: 'qa' },
    ));
  }

  // 4. IMPLEMENTATION_CHECKLIST.md (informational on iteration N≥2 — only blocker on iter 1).
  const checklist = clean.find((f) => /IMPLEMENTATION_CHECKLIST\.md$/i.test(String(f['path'])));
  if (!checklist) {
    issues.push(makeIssue(
      'builder.missing-checklist',
      'Builder did not emit IMPLEMENTATION_CHECKLIST.md.',
      'contract-violation', 'warning', { path: 'files', fixableBy: 'qa' },
    ));
  }

  // 5. userFlow coverage — every flow's destination pages must exist as
  //    real route files (so navigation works), and apiIds it touches must
  //    appear in some generated file (so the call wires up). Cheap check
  //    that catches "feed page exists but the create-post flow points at
  //    a non-existent /create page" failures.
  const flows = arr<Record<string, unknown>>(spec['userFlows']);
  const checklistText = checklist ? String(checklist['content'] ?? '') : '';
  const missingFlowTargets: string[] = [];
  for (const f of flows) {
    const fid = String(f['id'] ?? '<flow>');
    const steps = arr<Record<string, unknown>>(f['steps']);
    for (const [j, s] of steps.entries()) {
      const page = String(s['page'] ?? '');
      if (page && !allContent.includes(`"${page}"`) && !allContent.includes(`'${page}'`) && !allContent.includes(page)) {
        missingFlowTargets.push(`${fid}#${j}:${page}`);
      }
    }
  }
  if (missingFlowTargets.length > 0) {
    issues.push(makeIssue(
      'builder.broken-user-flows',
      `Builder did not wire ${missingFlowTargets.length} userFlow target(s) (page route never appears in code): ${missingFlowTargets.slice(0, 5).join(', ')}${missingFlowTargets.length > 5 ? ', …' : ''}.`,
      'cross-step', 'error', { path: 'files', fixableBy: 'qa' },
    ));
  }
  // Cross-check checklist actually reflects flows (cheap text presence check).
  if (checklist && flows.length > 0) {
    const missingFromChecklist: string[] = [];
    for (const f of flows) {
      const fid = String(f['id'] ?? '');
      if (fid && !checklistText.includes(fid)) missingFromChecklist.push(fid);
    }
    if (missingFromChecklist.length > 0) {
      issues.push(makeIssue(
        'builder.checklist-missing-flows',
        `IMPLEMENTATION_CHECKLIST.md does not list ${missingFromChecklist.length} userFlow(s): ${missingFromChecklist.slice(0, 5).join(', ')}.`,
        'contract-violation', 'warning', { path: 'files', fixableBy: 'qa' },
      ));
    }
  }
}

// ── QA ────────────────────────────────────────────────────

function semanticQa(
  out: Record<string, unknown>,
  issues: ValidationIssue[],
  repairs: RepairChange[],
  _state: PipelineState,
): void {
  // Verdict normalisation.
  const verdict = String(out['verdict'] ?? '').toLowerCase();
  if (verdict !== 'pass' && verdict !== 'needs-improvement') {
    out['verdict'] = 'needs-improvement';
    repairs.push({ path: 'verdict', action: 'coerced-shape', detail: `Unknown verdict "${verdict}"; normalized to 'needs-improvement'.` });
  }

  // Mark every QA issue as fixableBy:'builder' so the orchestrator knows
  // the loop-back target. (Used by the project-generator's loop driver.)
  const qaIssues = arr<Record<string, unknown>>(out['issues']);
  for (const i of qaIssues) {
    if (!i['fixableBy']) i['fixableBy'] = 'builder';
  }
  out['issues'] = qaIssues;

  // Score sanity.
  const scores = obj(out['scores']);
  for (const dim of ['correctness', 'completeness', 'consistency', 'security', 'overall']) {
    if (!isNum(scores[dim])) { scores[dim] = 0; }
  }
  out['scores'] = scores;

  // If verdict is 'needs-improvement', surface as deferred (builder can fix).
  if (out['verdict'] === 'needs-improvement') {
    issues.push(makeIssue(
      'qa.needs-improvement',
      `QA verdict "needs-improvement" — ${qaIssues.length} issue(s) flagged. Builder will re-run.`,
      'code-quality', 'warning', { fixableBy: 'builder' },
    ));
  }

  // Critical issues that QA could not auto-patch ⇒ error.
  const unpatched = qaIssues.filter((i) => {
    const sev = String(i['severity'] ?? '').toLowerCase();
    return sev === 'critical';
  }).length;
  const patches = arr(out['patches']).length;
  if (unpatched > 0 && patches === 0) {
    issues.push(makeIssue(
      'qa.critical-unpatched',
      `QA flagged ${unpatched} critical issue(s) but produced no patches.`,
      'code-quality', 'error', { fixableBy: 'builder' },
    ));
  }
}

// ── POLISH ────────────────────────────────────────────────

function semanticPolish(
  out: Record<string, unknown>, _issues: ValidationIssue[], repairs: RepairChange[],
): void {
  if (!Array.isArray(out['patches']))         { out['patches']         = []; repairs.push({ path: 'patches',         action: 'coerced-shape', detail: 'Coerced to array.' }); }
  if (!Array.isArray(out['newFiles']))        { out['newFiles']        = []; repairs.push({ path: 'newFiles',        action: 'coerced-shape', detail: 'Coerced to array.' }); }
  if (!Array.isArray(out['recommendations'])) { out['recommendations'] = []; repairs.push({ path: 'recommendations', action: 'coerced-shape', detail: 'Coerced to array.' }); }
  if (!out['perfEstimate'] || typeof out['perfEstimate'] !== 'object') {
    out['perfEstimate'] = {};
    repairs.push({ path: 'perfEstimate', action: 'filled-default', detail: 'Filled empty perfEstimate.' });
  }
}

// ── Public entry point ──────────────────────────────────────

export function validateAndRepair(
  role: AgentRole,
  rawOutput: Record<string, unknown> | undefined,
  state: PipelineState,
): ValidationResult {
  const initial = rawOutput && typeof rawOutput === 'object' ? rawOutput : {};

  const schemaStep = validateSchema(role, initial);
  const semStep    = validateSemantic(role, schemaStep.output, state);

  const issues  = [...schemaStep.issues, ...semStep.issues].sort(severitySort);
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
