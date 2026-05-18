import * as ts from 'typescript';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import { getMergedFiles } from '../../../../packages/agent-core/src/agent-input-builder.js';
import { validateAndFixDependencies } from '../../../../packages/agent-core/src/dependency-validator.js';
import { validateImportIntegrity, missingImportsAsIssues } from '../../../../packages/agent-core/src/import-integrity.js';
import {
  validateImplementationCompleteness,
  completenessViolationsAsIssues,
  extractApiDomains,
} from '../../../../packages/agent-core/src/implementation-completeness.js';
import { normalizeTechStack, stackViolationsAsIssues, validateStackCompliance } from '../../../../packages/agent-core/src/tech-stack.js';
import { uiSystemViolationsAsIssues, validateUiSystemCompliance } from '../../../../packages/agent-core/src/ui-system.js';
import { enforceDeterministicGenerationContract } from './deterministic-generation-contract.js';

export function applyDependencyAutoFix(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  sliceLabel: string,
  logger: Logger,
): void {
  const merged = getMergedFiles(artifacts, /* applyPolish */ false);
  if (merged.length === 0) return;
  const { files: patchedFiles, report } = validateAndFixDependencies(merged);
  if (report.patched.length === 0 && report.unresolved.length === 0) return;

  if (report.patched.length > 0) {
    const builder = (artifacts.get('builder') as { files?: Array<{ path: string; content: string; language?: string }> } | undefined) ?? {};
    const builderFiles = Array.isArray(builder.files) ? [...builder.files] : [];
    const byPath = new Map(builderFiles.map((f) => [f.path, f]));
    for (const patched of patchedFiles) {
      if (!patched.path.replace(/\\/g, '/').endsWith('package.json')) continue;
      const existing = byPath.get(patched.path);
      if (existing && existing.content === patched.content) continue;
      if (existing) byPath.set(patched.path, { ...existing, content: patched.content });
      else byPath.set(patched.path, { path: patched.path, content: patched.content, language: 'json' });
    }
    artifacts.set('builder', { ...builder, files: Array.from(byPath.values()) });

    logger.info(
      `Dep validator on slice ${sliceLabel}: patched ${report.patched.length} package.json file(s), added ${report.added.length} dep(s), reconciled ${report.reconciled.reduce((n, r) => n + r.effects.length, 0)} package pin(s) [pm=${report.packageManager}]`,
      {
        event: 'deps:auto-fix',
        sliceLabel,
        packageManager: report.packageManager,
        added: report.added.map((a) => `${a.name}@${a.version} → ${a.packageJson}`),
      },
    );
  }
  if (report.unresolved.length > 0) {
    logger.warn(
      `Dep validator on slice ${sliceLabel}: ${report.unresolved.length} unresolved import(s)`,
      {
        event: 'deps:unresolved',
        sliceLabel,
        unresolved: report.unresolved.slice(0, 5).map((u) => `${u.name} (${u.reason})`),
      },
    );
  }
}

export function runPostSliceBuildCheck(
  cumulativeFiles: Array<{ path: string; content: string; language?: string }>,
  sliceTouchedPaths: Set<string>,
  sliceLabel: string,
  logger: Logger,
  buildSimplifiedStub: (path: string) => string | null,
): {
  issues: Array<{ file: string; kind: 'parse' | 'import'; message: string; line?: number }>;
  fixed: Array<{ path: string; content: string; language?: string }>;
} {
  const issues: Array<{ file: string; kind: 'parse' | 'import'; message: string; line?: number }> = [];
  const tsRe = /\.(?:tsx?|jsx?|mjs|cjs|mts|cts)$/i;
  for (const f of cumulativeFiles) {
    if (!tsRe.test(f.path)) continue;
    const lower = f.path.toLowerCase();
    const kind: ts.ScriptKind = lower.endsWith('.tsx')
      ? ts.ScriptKind.TSX
      : lower.endsWith('.jsx')
        ? ts.ScriptKind.JSX
        : lower.endsWith('.ts') || lower.endsWith('.mts') || lower.endsWith('.cts')
          ? ts.ScriptKind.TS
          : ts.ScriptKind.JS;
    const sf = ts.createSourceFile(f.path, f.content, ts.ScriptTarget.Latest, false, kind);
    const diags = (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];
    for (const d of diags) {
      const msg = typeof d.messageText === 'string'
        ? d.messageText
        : (d.messageText && typeof d.messageText === 'object' ? (d.messageText as { messageText?: string }).messageText ?? '' : '');
      const pos = typeof d.start === 'number' ? d.start : 0;
      const { line } = sf.getLineAndCharacterOfPosition(pos);
      issues.push({ file: f.path, kind: 'parse', message: msg, line: line + 1 });
    }
  }

  const missing = validateImportIntegrity(cumulativeFiles);
  for (const m of missing) {
    issues.push({ file: m.importer, kind: 'import', message: `unresolved import '${m.specifier}'` });
  }

  if (issues.length === 0) {
    logger.info(`[build-check] Slice ${sliceLabel}: PASS (${cumulativeFiles.length} files, no parse/import errors)`, {
      event: 'build-check:pass',
      sliceLabel,
      fileCount: cumulativeFiles.length,
    });
    return { issues, fixed: [] };
  }

  const brokenFiles = new Set<string>();
  for (const i of issues) {
    const norm = i.file.replace(/\\/g, '/').replace(/^\.\//, '');
    if (sliceTouchedPaths.has(norm) || sliceTouchedPaths.has(i.file)) {
      brokenFiles.add(norm);
    }
  }

  const byFile: Record<string, number> = {};
  for (const i of issues) byFile[i.file] = (byFile[i.file] ?? 0) + 1;
  logger.warn(
    `[build-check] Slice ${sliceLabel}: ${issues.length} issue(s) across ${Object.keys(byFile).length} file(s) — repairing ${brokenFiles.size} touched file(s) with simplified stubs`,
    {
      event: 'build-check:repair',
      sliceLabel,
      totalIssues: issues.length,
      affectedFiles: Object.keys(byFile),
      repairing: Array.from(brokenFiles),
      sample: issues.slice(0, 6).map((i) => `[${i.kind}] ${i.file}${i.line ? `:${i.line}` : ''} — ${i.message}`),
    },
  );

  const fixed: Array<{ path: string; content: string; language?: string }> = [];
  for (const path of brokenFiles) {
    const original = cumulativeFiles.find((f) => f.path === path);
    const stub = buildSimplifiedStub(path);
    if (stub === null) continue;
    fixed.push({ path, content: stub, language: original?.language });
  }
  return { issues, fixed };
}

export function runPostSliceQuickValidation(
  cumulativeFiles: Array<{ path: string; content: string; language?: string }>,
  sliceLabel: string,
  logger: Logger,
): {
  ok: boolean;
  issues: string[];
  patched: Array<{ path: string; content: string; language?: string }>;
  fixes: { synthesizedPackageJson: boolean; addedScripts: string[]; touchedPackageJson: string | null };
} {
  const contract = enforceDeterministicGenerationContract(cumulativeFiles);
  const priorByPath = new Map(cumulativeFiles.map((f) => [f.path.replace(/\\/g, '/'), f]));
  const patched = contract.files.filter((f) => {
    const prev = priorByPath.get(f.path);
    return !prev || prev.content !== f.content || (prev.language ?? '') !== (f.language ?? '');
  });

  const synthesizedPackageJson = contract.addedPaths.includes('package.json');
  const touchedPackageJson = synthesizedPackageJson || contract.patchedPaths.includes('package.json')
    ? 'package.json'
    : null;
  const addedScripts = touchedPackageJson ? ['dev', 'build', 'start', 'preview', 'typecheck'] : [];
  const issues = [...contract.warnings, ...contract.blockingViolations];
  const ok = contract.blockingViolations.length === 0;

  if (ok && issues.length === 0) {
    logger.info(`[quick-check] Slice ${sliceLabel}: PASS (deterministic generation contract)`, {
      event: 'quick-check:pass',
      sliceLabel,
      manifestFiles: contract.manifest.files.length,
      manifestRoutes: contract.manifest.routes.length,
    });
  } else {
    logger.warn(
      `[quick-check] Slice ${sliceLabel}: contract enforced with ${issues.length} issue(s); ${patched.length} file(s) patched`,
      {
        event: 'quick-check:auto-fix',
        sliceLabel,
        issues,
        synthesizedPackageJson,
        touchedPackageJson,
        addedScripts,
        patchedPaths: contract.patchedPaths,
        addedPaths: contract.addedPaths,
      },
    );
  }
  return { ok, issues, patched, fixes: { synthesizedPackageJson, addedScripts, touchedPackageJson } };
}

export function applySimplifiedFallback(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  sliceLabel: string,
  logger: Logger,
  buildSimplifiedStub: (path: string) => string | null,
): { replaced: string[] } {
  const qa = artifacts.get('qa') as { issues?: unknown[]; verdict?: string } | undefined;
  if (!qa || !Array.isArray(qa.issues) || qa.issues.length === 0) return { replaced: [] };
  const affected = new Set<string>();
  for (const raw of qa.issues) {
    const issue = raw as { file?: string; path?: string };
    const p = (issue?.file ?? issue?.path ?? '').trim();
    if (p) affected.add(p.replace(/\\/g, '/').replace(/^\.\//, ''));
  }
  if (affected.size === 0) return { replaced: [] };
  const builder = artifacts.get('builder') as { files?: Array<{ path: string; content: string; language?: string }> } | undefined;
  if (!builder?.files) return { replaced: [] };

  const replaced: string[] = [];
  const newFiles = builder.files.map((f) => {
    const norm = f.path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (!affected.has(norm)) return f;
    const stub = buildSimplifiedStub(norm);
    if (stub === null) return f;
    replaced.push(norm);
    return { ...f, content: stub };
  });
  if (replaced.length === 0) return { replaced: [] };

  artifacts.set('builder', { ...(builder as Record<string, unknown>), files: newFiles });
  artifacts.set('qa', {
    ...qa,
    verdict: 'pass',
    summary: ((qa as { summary?: string }).summary ?? '') + ` [simplified-fallback applied to ${replaced.length} file(s)]`,
    simplifiedFallback: { replaced },
  } as Record<string, unknown>);

  logger.warn(
    `Slice ${sliceLabel} simplified fallback — replaced ${replaced.length} file(s) with safe stubs after QA loop exhausted`,
    { event: 'qa:fallback', sliceLabel, replaced },
  );
  return { replaced };
}

export function assertBuilderProducedFiles(
  sliceState: { status?: string; error?: string; artifacts: Map<AgentRole, Record<string, unknown>> },
  ctx: { phase: string; step: string; sliceLabel: string; sliceId?: string | null; sliceIndex?: number; sliceCount?: number },
  logger: Logger,
): void {
  const builder = sliceState.artifacts.get('builder') as { files?: unknown[] } | undefined;
  const files = Array.isArray(builder?.files) ? builder!.files! : [];
  const orchFailed = sliceState.status === 'failed';
  if (files.length > 0) {
    if (orchFailed) {
      logger.warn('[builder-empty] orchestrator failed but builder emitted files; preserving builder artifacts', {
        event: 'gen:builder-orchestrator-mismatch',
        phase: ctx.phase,
        step: ctx.step,
        sliceLabel: ctx.sliceLabel,
        sliceId: ctx.sliceId ?? null,
        orchestratorStatus: sliceState.status ?? 'unknown',
        orchestratorError: sliceState.error ?? null,
        builderFileCount: files.length,
      });
    }
    return;
  }
  const reason = orchFailed ? `orchestrator status=failed (${sliceState.error ?? 'no error message'})` : 'builder artifact has 0 files';
  const sliceCoord = typeof ctx.sliceIndex === 'number' && typeof ctx.sliceCount === 'number' ? ` slice ${ctx.sliceIndex + 1}/${ctx.sliceCount}` : '';
  const sliceTag = ctx.sliceId ? ` [slice=${ctx.sliceId}]` : '';
  const message = `[builder-empty] ${ctx.phase} → ${ctx.step}${sliceCoord}${sliceTag}: ${reason}`;
  logger.error('[gen:builder-empty] aborting pipeline immediately — builder produced no files', {
    event: 'gen:builder-empty',
    phase: ctx.phase,
    step: ctx.step,
    sliceLabel: ctx.sliceLabel,
    sliceId: ctx.sliceId ?? null,
    sliceIndex: ctx.sliceIndex ?? null,
    sliceCount: ctx.sliceCount ?? null,
    orchestratorStatus: sliceState.status ?? 'unknown',
    orchestratorError: sliceState.error ?? null,
    builderFileCount: files.length,
    reason,
  });
  throw new Error(message);
}

export function enforceImplementationCompleteness(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  sliceLabel: string,
  logger: Logger,
): void {
  const merged = getMergedFiles(artifacts, false);
  if (merged.length === 0) return;
  const spec = artifacts.get('spec');
  const apiDomains = extractApiDomains(spec);
  const report = validateImplementationCompleteness(merged, { apiDomains });
  if (report.inspected === 0 || !report.failed) return;
  const synthetic = completenessViolationsAsIssues(report);
  const qa = (artifacts.get('qa') as { verdict?: string; issues?: unknown[]; summary?: string } | undefined) ?? {};
  const prevIssues = Array.isArray(qa.issues) ? qa.issues : [];
  artifacts.set('qa', { ...qa, verdict: 'needs-improvement', issues: [...prevIssues, ...synthetic] } as Record<string, unknown>);
  const byRule: Record<string, number> = {};
  for (const v of report.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  logger.warn(`Implementation-completeness FAIL on slice ${sliceLabel}: ${report.violations.length} violation(s) — forcing builder rebuild`, {
    event: 'completeness:violation',
    sliceLabel,
    rules: byRule,
    sampleFiles: report.violations.slice(0, 5).map((v) => `${v.rule} → ${v.file}:${v.line ?? '?'}`),
    totalCount: report.totalCount,
  });
}

export function enforceTechStack(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  sliceLabel: string,
  logger: Logger,
): void {
  const merged = getMergedFiles(artifacts, false);
  if (merged.length === 0) return;
  const spec = artifacts.get('spec') as { techStack?: unknown } | undefined;
  const stack = normalizeTechStack(spec?.techStack);
  const report = validateStackCompliance(merged, stack);
  if (!report.failed) return;
  const synthetic = stackViolationsAsIssues(report);
  const qa = (artifacts.get('qa') as { verdict?: string; issues?: unknown[]; summary?: string } | undefined) ?? {};
  const prevIssues = Array.isArray(qa.issues) ? qa.issues : [];
  artifacts.set('qa', { ...qa, verdict: 'needs-improvement', issues: [...prevIssues, ...synthetic] } as Record<string, unknown>);
  const byRule: Record<string, number> = {};
  for (const v of report.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + 1;
  logger.warn(
    `Tech-stack FAIL on slice ${sliceLabel}: ${report.violations.length} violation(s) — chosen=${stack.backend}/${stack.frontend}/${stack.orm}; forcing rebuild`,
    {
      event: 'tech-stack:violation',
      sliceLabel,
      chosen: { backend: stack.backend, frontend: stack.frontend, orm: stack.orm, database: stack.database },
      rules: byRule,
      sampleFiles: report.violations.slice(0, 5).map((v) => `${v.rule} → ${v.file}`),
    },
  );
}

export function enforceUiSystem(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  sliceLabel: string,
  logger: Logger,
): void {
  const merged = getMergedFiles(artifacts, false);
  if (merged.length === 0) return;
  const report = validateUiSystemCompliance(merged);
  if (report.inspected === 0 || !report.failed) return;
  const synthetic = uiSystemViolationsAsIssues(report);
  const qa = (artifacts.get('qa') as { verdict?: string; issues?: unknown[]; summary?: string } | undefined) ?? {};
  const prevIssues = Array.isArray(qa.issues) ? qa.issues : [];
  artifacts.set('qa', { ...qa, verdict: 'needs-improvement', issues: [...prevIssues, ...synthetic] } as Record<string, unknown>);
  const byRule: Record<string, number> = {};
  for (const v of report.violations) byRule[v.rule] = (byRule[v.rule] ?? 0) + (v.count ?? 1);
  logger.warn(
    `UI-system FAIL on slice ${sliceLabel}: ${report.violations.length} violation rule(s), ${report.totalCount} total occurrence(s) — forcing builder rebuild`,
    { event: 'ui-system:violation', sliceLabel, rules: byRule, sampleFiles: report.violations.slice(0, 5).map((v) => `${v.rule} → ${v.file}`), totalCount: report.totalCount },
  );
}

export function injectImportIntegrityIssues(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  sliceLabel: string,
  logger: Logger,
): void {
  const merged = getMergedFiles(artifacts, false);
  if (merged.length === 0) return;
  const missing = validateImportIntegrity(merged);
  if (missing.length === 0) return;
  const synthetic = missingImportsAsIssues(missing);
  const qa = (artifacts.get('qa') as { verdict?: string; issues?: unknown[]; summary?: string } | undefined) ?? {};
  const prevIssues = Array.isArray(qa.issues) ? qa.issues : [];
  artifacts.set('qa', { ...qa, verdict: 'needs-improvement', issues: [...prevIssues, ...synthetic] } as Record<string, unknown>);
  logger.warn(
    `Import integrity FAIL on slice ${sliceLabel}: ${missing.length} missing import(s) — forcing builder rebuild`,
    { sample: missing.slice(0, 3).map((m) => `${m.importer} → ${m.specifier}`) },
  );
}
