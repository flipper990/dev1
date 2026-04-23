// ─────────────────────────────────────────────────────────────
// Agent Input Builder — Constructs per-agent inputs from
// session state and upstream pipeline artifacts.
// ─────────────────────────────────────────────────────────────

import type { AgentRole, Session } from './types';
import { AGENT_DEFINITIONS } from './agent-registry';

// ── Merged-File Helper ──────────────────────────────────────

/**
 * Returns the developer-generated file set with patches applied in order:
 *   1. debugger patches (bug fixes)
 *   2. optimizer patches (perf/quality improvements) — only when applyOptimizer=true
 */
export function getMergedFiles(
  artifacts: Map<AgentRole, Record<string, unknown>>,
  applyOptimizer = false,
): Array<{ path: string; content: string; language?: string }> {
  const devFiles = (artifacts.get('developer') as
    { files?: Array<{ path: string; content: string; language?: string }> } | undefined
  )?.files ?? [];

  const fileMap = new Map(devFiles.map(f => [f.path, { ...f }]));

  const applyPatches = (patches: Array<{ file: string; oldContent: string; newContent: string }>) => {
    for (const patch of patches) {
      const file = fileMap.get(patch.file);
      if (file && file.content === patch.oldContent) {
        file.content = patch.newContent;
      }
    }
  };

  const debugPatches = (artifacts.get('debugger') as
    { patches?: Array<{ file: string; oldContent: string; newContent: string }> } | undefined
  )?.patches ?? [];
  applyPatches(debugPatches);

  // Quality-enforcer patches always apply — they are the final quality gate and must
  // land before downstream consumers (optimizer, devops) see the codebase.
  const qualityPatches = (artifacts.get('quality_enforcer') as
    { patches?: Array<{ file: string; oldContent: string; newContent: string }> } | undefined
  )?.patches ?? [];
  applyPatches(qualityPatches);

  // Quality-enforcer can also create entirely new files (e.g. a missing EmptyState component).
  const qualityNewFiles = (artifacts.get('quality_enforcer') as
    { newFiles?: Array<{ path: string; content: string; language?: string }> } | undefined
  )?.newFiles ?? [];
  for (const nf of qualityNewFiles) {
    if (nf && typeof nf.path === 'string' && typeof nf.content === 'string' && !fileMap.has(nf.path)) {
      fileMap.set(nf.path, { path: nf.path, content: nf.content, language: nf.language });
    }
  }

  if (applyOptimizer) {
    const optPatches = (artifacts.get('optimizer') as
      { patches?: Array<{ file: string; oldContent: string; newContent: string }> } | undefined
    )?.patches ?? [];
    applyPatches(optPatches);
  }

  return Array.from(fileMap.values());
}

// ── Optional-Skip Logic ─────────────────────────────────────

/**
 * Returns a skip reason string if the step should be bypassed,
 * or null if it should execute normally.
 */
export function shouldSkipStep(
  role: AgentRole,
  artifacts: Map<AgentRole, Record<string, unknown>>,
): string | null {
  if (role === 'tester') {
    const files = (artifacts.get('developer') as { files?: unknown[] } | undefined)?.files ?? [];
    if (!Array.isArray(files) || files.length === 0) {
      return 'No generated code files available; skipping tests';
    }
  }

  if (role === 'debugger') {
    const issues = (artifacts.get('reviewer') as { issues?: unknown[] } | undefined)?.issues ?? [];
    const passable = (artifacts.get('reviewer') as { passable?: boolean } | undefined)?.passable ?? false;
    if (Array.isArray(issues) && issues.length === 0 && passable) {
      return 'Reviewer found no issues and marked code passable; skipping debugger';
    }
  }

  if (role === 'optimizer') {
    const files = (artifacts.get('developer') as { files?: unknown[] } | undefined)?.files ?? [];
    if (!Array.isArray(files) || files.length === 0) {
      return 'No generated files to optimize; skipping optimizer';
    }
  }

  if (role === 'quality_enforcer') {
    const files = (artifacts.get('developer') as { files?: unknown[] } | undefined)?.files ?? [];
    if (!Array.isArray(files) || files.length === 0) {
      return 'No generated files to evaluate; skipping quality enforcer';
    }
  }

  if (role === 'devops') {
    const mergedPaths = new Set(getMergedFiles(artifacts, true).map(f => f.path));
    if (mergedPaths.has('Dockerfile') && mergedPaths.has('docker-compose.yml') && mergedPaths.has('.env.example')) {
      return 'Deployment artifacts already generated; skipping devops';
    }
  }

  return null;
}

// ── Input Builder ───────────────────────────────────────────

/**
 * Constructs the input object for a given agent role from the
 * current session and all upstream artifact outputs.
 */
export function buildAgentInput(
  session: Session,
  role: AgentRole,
  artifacts: Map<AgentRole, Record<string, unknown>>,
): Record<string, unknown> {
  const input: Record<string, unknown> = {};

  // ── Expanded-prompt resolution ─────────────────────────────────
  // Every downstream agent MUST see the intent_expander's expanded prompts, not
  // the original user input. Original prompts are only used as a fallback when
  // the expander has not run yet (e.g. intent_expander itself, or resume/update).
  const expanded = artifacts.get('intent_expander') as Record<string, unknown> | undefined;
  const expandedPrompts = Array.isArray(expanded?.expandedPrompts)
    ? (expanded!.expandedPrompts as string[]).filter((p) => typeof p === 'string' && p.length > 0)
    : [];
  const effectivePrompts = expandedPrompts.length > 0 ? expandedPrompts : session.prompts;

  switch (role) {
    case 'intent_expander':
      // The expander is the only agent that sees the raw user prompts.
      input.prompts = session.prompts;
      input.userPreferences = session.artifacts.get('userPreferences') ?? {};
      input.globalMemoryHints = session.artifacts.get('globalMemoryHints') ?? [];
      break;

    case 'planner':
      input.prompts = effectivePrompts;
      input.expandedSpec = expanded ?? {};
      input.userPreferences = session.artifacts.get('userPreferences') ?? {};
      input.globalMemoryHints = session.artifacts.get('globalMemoryHints') ?? [];
      break;

    case 'architect':
      input.plan = artifacts.get('planner') ?? {};
      input.expandedSpec = expanded ?? {};
      input.userPreferences = session.artifacts.get('userPreferences') ?? {};
      input.globalMemoryHints = session.artifacts.get('globalMemoryHints') ?? [];
      break;

    case 'developer': {
      const archArtifact = artifacts.get('architect') as { fileTree?: string[] } | undefined;
      const fileTree: string[] = Array.isArray(archArtifact?.fileTree) ? archArtifact!.fileTree : [];
      const devConcurrency = AGENT_DEFINITIONS['developer']!.maxConcurrency ?? 1;
      const chunkSize = Math.max(1, Math.ceil(fileTree.length / devConcurrency));
      input.spec = artifacts.get('architect') ?? {};
      input.expandedSpec = expanded ?? {};
      input.fileAssignment = fileTree;
      input.fileChunkSize = chunkSize;
      const priorDev = artifacts.get('developer') as { files?: Array<{ path: string; content: string }> } | undefined;
      input.context = priorDev?.files
        ? Object.fromEntries(priorDev.files.map(f => [f.path, f.content]))
        : {};
      break;
    }

    case 'reviewer':
      input.spec = artifacts.get('architect') ?? {};
      input.expandedSpec = expanded ?? {};
      input.files = (artifacts.get('developer') as any)?.files ?? [];
      break;

    case 'tester':
      input.files = (artifacts.get('developer') as any)?.files ?? [];
      input.apiContracts = (artifacts.get('architect') as any)?.apiContracts ?? [];
      input.spec = artifacts.get('architect') ?? {};
      input.expandedSpec = expanded ?? {};
      input.reviewIssues = (artifacts.get('reviewer') as any)?.issues ?? [];
      break;

    case 'debugger': {
      const reviewerArtifact = artifacts.get('reviewer') as
        { issues?: Array<{ file?: string }> } | undefined;
      const reviewerIssues: Array<{ file?: string }> = reviewerArtifact?.issues ?? [];
      const issuedPaths = new Set(
        reviewerIssues.map(i => i.file).filter((f): f is string => typeof f === 'string'),
      );
      const allDevFiles = (artifacts.get('developer') as
        { files?: Array<{ path: string; content: string }> } | undefined)?.files ?? [];
      input.issues = reviewerIssues;
      input.affectedFiles = issuedPaths.size > 0
        ? allDevFiles.filter(f => issuedPaths.has(f.path))
        : allDevFiles;
      const testerArtifact = artifacts.get('tester') as
        { testFiles?: unknown[]; coverage?: unknown } | undefined;
      input.testResults = testerArtifact
        ? { coverage: testerArtifact.coverage ?? {}, testFileCount: testerArtifact.testFiles?.length ?? 0 }
        : null;
      input.spec = artifacts.get('architect') ?? {};
      input.expandedSpec = expanded ?? {};
      break;
    }

    case 'quality_enforcer':
      // Feed merged-post-debugger files so quality decisions account for prior fixes.
      input.expandedSpec = expanded ?? {};
      input.spec = artifacts.get('architect') ?? {};
      input.files = getMergedFiles(artifacts, false);
      input.reviewReport = artifacts.get('reviewer') ?? {};
      input.unresolvedIssues = (artifacts.get('debugger') as any)?.unresolved ?? [];
      break;

    case 'optimizer':
      input.files = getMergedFiles(artifacts);
      input.spec = artifacts.get('architect') ?? {};
      input.expandedSpec = expanded ?? {};
      input.qaReport = artifacts.get('reviewer') ?? {};
      input.qualityReport = artifacts.get('quality_enforcer') ?? {};
      input.unresolvedIssues = (artifacts.get('debugger') as any)?.unresolved ?? [];
      break;

    case 'devops': {
      const archSpec = artifacts.get('architect') as { fileTree?: string[] } | undefined;
      input.spec = archSpec ?? {};
      input.expandedSpec = expanded ?? {};
      input.fileTree = archSpec?.fileTree ?? [];
      input.generatedFiles = getMergedFiles(artifacts, true)
        .map(f => ({ path: f.path, language: f.language }));
      break;
    }
  }

  return input;
}
