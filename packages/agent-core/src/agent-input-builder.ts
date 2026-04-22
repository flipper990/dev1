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

  switch (role) {
    case 'planner':
      input.prompts = session.prompts;
      input.userPreferences = session.artifacts.get('userPreferences') ?? {};
      input.globalMemoryHints = session.artifacts.get('globalMemoryHints') ?? [];
      break;

    case 'architect':
      input.plan = artifacts.get('planner') ?? {};
      input.userPreferences = session.artifacts.get('userPreferences') ?? {};
      input.globalMemoryHints = session.artifacts.get('globalMemoryHints') ?? [];
      break;

    case 'developer': {
      const archArtifact = artifacts.get('architect') as { fileTree?: string[] } | undefined;
      const fileTree: string[] = Array.isArray(archArtifact?.fileTree) ? archArtifact!.fileTree : [];
      const devConcurrency = AGENT_DEFINITIONS['developer'].maxConcurrency ?? 1;
      const chunkSize = Math.max(1, Math.ceil(fileTree.length / devConcurrency));
      input.spec = artifacts.get('architect') ?? {};
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
      input.files = (artifacts.get('developer') as any)?.files ?? [];
      break;

    case 'tester':
      input.files = (artifacts.get('developer') as any)?.files ?? [];
      input.apiContracts = (artifacts.get('architect') as any)?.apiContracts ?? [];
      input.spec = artifacts.get('architect') ?? {};
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
      break;
    }

    case 'optimizer':
      input.files = getMergedFiles(artifacts);
      input.spec = artifacts.get('architect') ?? {};
      input.qaReport = artifacts.get('reviewer') ?? {};
      input.unresolvedIssues = (artifacts.get('debugger') as any)?.unresolved ?? [];
      break;

    case 'devops': {
      const archSpec = artifacts.get('architect') as { fileTree?: string[] } | undefined;
      input.spec = archSpec ?? {};
      input.fileTree = archSpec?.fileTree ?? [];
      input.generatedFiles = getMergedFiles(artifacts, true)
        .map(f => ({ path: f.path, language: f.language }));
      break;
    }
  }

  return input;
}
