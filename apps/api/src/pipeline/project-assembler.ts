// Project Assembler — merges agent artifacts into the final file set.
//
// Order of operations (4-agent pipeline):
//   1. builder.files          ← starting point
//   2. qa.newFiles            ← additions (missing components, etc.)
//   3. qa.patches             ← in-place fixes
//   4. polish.newFiles        ← prod artifacts (Dockerfile, README, …)
//   5. polish.patches         ← UI/perf patches
//   6. ensureDeploymentReadiness  ← baseline Dockerfile/.env if missing
//   7. injectUIFoundation     ← cn.ts, Button, tailwind.config.ts if missing

import type { AgentRole } from '../../../../packages/agent-core/src/types.js';
import type { Logger } from '../../../../packages/agent-core/src/base-agent.js';
import type { PipelineState } from '../../../../packages/agent-core/src/orchestrator.js';
import type { TaskSummary } from '../storage/project-store.js';
import type { ProjectFile, Patch, StepSummary } from './generator-types.js';
import { ensureDeploymentReadiness } from './deployment-templates.js';
import { ensureRunnableScaffold } from './runnable-scaffold.js';
import { injectUIFoundation, sanitizeUIFoundation, enforceDesignSystem, enforceImageAssets, ensureNextImageRemotePatterns } from './ui-foundation.js';
import { normalizePolishPaths } from '../../../../packages/agent-core/src/agent-input-builder.js';

export function assembleProject(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  logger: Logger,
): ProjectFile[] {
  const fileMap = new Map<string, ProjectFile>();

  // 1. Builder output is the starting point.
  const builderOut = artifacts.get('builder') as { files?: ProjectFile[] } | undefined;
  for (const file of builderOut?.files ?? []) fileMap.set(file.path, { ...file });

  // 2-3. QA additions and patches. Normalize newFiles to match the builder's
  // chosen layout (standalone vs monorepo) — QA can drift between styles.
  const qaOut = artifacts.get('qa') as { patches?: Patch[]; newFiles?: ProjectFile[] } | undefined;
  const qaNew = normalizePolishPaths(qaOut?.newFiles ?? [], fileMap) as ProjectFile[];
  for (const file of qaNew) {
    if (!fileMap.has(file.path)) fileMap.set(file.path, { ...file });
  }
  if (qaOut?.patches) applyPatches(fileMap, qaOut.patches, 'qa', logger);

  // 4-5. Polish additions and patches. Same normalization — polish often
  // emits apps/web/* even when builder used standalone, producing duplicates.
  const polishOut = artifacts.get('polish') as { patches?: Patch[]; newFiles?: ProjectFile[] } | undefined;
  const polishNew = normalizePolishPaths(polishOut?.newFiles ?? [], fileMap) as ProjectFile[];
  for (const file of polishNew) {
    if (!fileMap.has(file.path)) fileMap.set(file.path, { ...file });
  }
  if (polishOut?.patches) applyPatches(fileMap, polishOut.patches, 'polish', logger);

  // 6-7. Baseline deployment + UI foundation guarantees.
  ensureRunnableScaffold(fileMap);
  ensureDeploymentReadiness(fileMap, artifacts);
  injectUIFoundation(fileMap, artifacts);
  // 8. Repair broken EXISTING tailwind.config / globals.css / design-tokens
  //    files emitted by qa/polish (injectUIFoundation only fills gaps).
  sanitizeUIFoundation(fileMap);
  // 9. Rewrite invented className tokens (bg-cardBackground, text-textPrimary,
  //    etc.) to canonical semantic equivalents so the rendered UI matches the
  //    injected theme regardless of LLM drift.
  const dsResult = enforceDesignSystem(
    fileMap as unknown as Map<string, { path: string; content: string; language?: string }>,
  );
  if (dsResult.totalReplacements > 0) {
    logger.info(
      `enforceDesignSystem: rewrote ${dsResult.totalReplacements} invented className tokens across ${dsResult.filesChanged} file(s)`,
    );
  }

  // 10. Image enforcement — guarantee no broken image icons. Rewrites every
  //     <img>/<Image> with a missing/empty/fictional/unresolved-local src to
  //     a deterministic picsum.photos / pravatar URL.
  const imgResult = enforceImageAssets(fileMap);
  if (imgResult.rewrites > 0) {
    logger.info(
      `enforceImageAssets: rewrote ${imgResult.rewrites} broken image src(s) across ${imgResult.filesChanged} file(s)`,
    );
  }
  // 11. Whitelist placeholder hosts in next.config so Next/Image renders them.
  const nextImgResult = ensureNextImageRemotePatterns(fileMap);
  if (nextImgResult.changed) {
    logger.info('ensureNextImageRemotePatterns: updated next.config images.remotePatterns');
  }

  return Array.from(fileMap.values());
}

export function applyPatches(
  fileMap: Map<string, ProjectFile>,
  patches: Patch[],
  source: string,
  logger: Logger,
): void {
  for (const patch of patches) {
    const file = fileMap.get(patch.file);
    if (!file) {
      logger.warn(`${source} patch target not found: ${patch.file}`);
      continue;
    }
    if (typeof patch.newContent !== 'string') continue;

    const before = file.content;
    let after: string;

    // Allow whole-file replacement when oldContent is empty.
    if (!patch.oldContent) {
      after = patch.newContent;
    } else if (before.includes(patch.oldContent)) {
      after = before.replace(patch.oldContent, patch.newContent);
    } else {
      logger.warn(`${source} patch content mismatch in ${patch.file}`);
      continue;
    }

    // Reject patches that introduce syntactic damage. The QA/polish agents
    // sometimes emit patches whose oldContent matches an opener but whose
    // newContent forgets the original closer, leaving an orphan tail in the
    // file and a permanently broken build. We refuse such patches and keep
    // the previous (working) content.
    if (isCodeFilePath(patch.file)) {
      const beforeOk = isBracketBalanced(before);
      const afterOk = isBracketBalanced(after);
      if (beforeOk && !afterOk) {
        logger.warn(
          `${source} patch REJECTED for ${patch.file}: would unbalance brackets — keeping previous content`,
        );
        continue;
      }
    }

    file.content = after;
  }
}

const CODE_EXT_RE = /\.(tsx|jsx|ts|js|mjs|cjs)$/i;
function isCodeFilePath(p: string): boolean {
  return CODE_EXT_RE.test(p);
}

/**
 * Cheap balance check matching `quality-assurance.ts.checkSyntaxBalance`.
 * Returns true when (), {}, [] balance out and no string/comment is left
 * unterminated. Skips JSX tag pairing — that's checked elsewhere.
 */
function isBracketBalanced(src: string): boolean {
  if (!src.trim()) return true;
  let paren = 0, brace = 0, bracket = 0;
  let inString: '"' | "'" | '`' | null = null;
  let inLineComment = false, inBlockComment = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const prev = i > 0 ? src[i - 1] : '';
    if (inLineComment) { if (c === '\n') inLineComment = false; continue; }
    if (inBlockComment) { if (c === '/' && prev === '*') inBlockComment = false; continue; }
    if (inString) {
      if (c === inString && prev !== '\\') inString = null;
      continue;
    }
    if (c === '/' && src[i + 1] === '/') { inLineComment = true; continue; }
    if (c === '/' && src[i + 1] === '*') { inBlockComment = true; continue; }
    if (c === '"' || c === "'" || c === '`') { inString = c; continue; }
    if (c === '(') paren++;   else if (c === ')') paren--;
    if (c === '{') brace++;   else if (c === '}') brace--;
    if (c === '[') bracket++; else if (c === ']') bracket--;
  }
  return paren === 0 && brace === 0 && bracket === 0 && !inString && !inBlockComment;
}

export function buildTaskSummaries(state: PipelineState): TaskSummary[] {
  return state.tasks.map(t => ({
    id: t.id,
    agentRole: t.agentRole,
    status: t.status,
    durationMs: t.metadata?.latencyMs ?? 0,
    tokensUsed: (t.metadata?.tokensIn ?? 0) + (t.metadata?.tokensOut ?? 0),
    costUsd: t.metadata?.costUsd ?? 0,
    error: t.error?.message,
  }));
}

export function buildStepSummaries(state: PipelineState): StepSummary[] {
  return state.steps.map(s => ({
    stepId: s.stepId,
    name: s.stepId,
    agent: s.agent,
    status: s.status,
    durationMs: s.durationMs,
    error: s.error,
  }));
}
