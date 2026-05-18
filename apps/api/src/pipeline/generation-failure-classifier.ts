export type GenerationFailureCategory =
  | 'provider_failure'
  | 'orchestration_failure'
  | 'artifact_corruption'
  | 'empty_generation'
  | 'timeout'
  | 'preview_failure'
  | 'export_failure'
  | 'dependency_failure'
  | 'dependency_install_failure'
  | 'generated_app_build_failure'
  | 'generated_import_export_mismatch'
  | 'generated_typescript_error'
  | 'preview_runner_internal_error'
  | 'project_persistence_failure'
  | 'filesystem_permission_failure'
  | 'tier1_scope_violation'
  | 'tier3_contract_missing'
  | 'unknown';

export interface GenerationFailureClassification {
  category: GenerationFailureCategory;
  code: string;
  reason: string;
}

export function classifyGenerationFailure(input: {
  failedPhase: string;
  failedStep: string;
  errorMessage: string;
}): GenerationFailureClassification {
  const phase = (input.failedPhase ?? '').toLowerCase();
  const step = (input.failedStep ?? '').toLowerCase();
  const message = (input.errorMessage ?? '').toLowerCase();
  const source = `${phase} ${step} ${message}`;

  if (/\b(builder-empty|produced no files|validation: builder produced no files)\b/.test(source)) {
    return {
      category: 'empty_generation',
      code: 'BUILDER_EMPTY',
      reason: 'Builder returned zero files for the active slice.',
    };
  }
  if (/\b(eperm|eacces|erofs|permission denied|operation not permitted|read-only file system)\b/.test(source)) {
    return {
      category: 'filesystem_permission_failure',
      code: 'FILESYSTEM_PERMISSION',
      reason: 'Filesystem permissions or locks blocked required mission writes.',
    };
  }
  if (/\b(project persistence failed|project-store:write-failed|atomicwritejson|project\.json missing|project save failed|reservation persistence failed|project_persistence_failure)\b/.test(source)) {
    return {
      category: 'project_persistence_failure',
      code: 'PROJECT_PERSISTENCE',
      reason: 'Project metadata/files could not be durably persisted.',
    };
  }
  if (/\b(timeout|timed out|mission-timeout|heartbeat-timeout|stalled-step)\b/.test(source)) {
    return {
      category: 'timeout',
      code: 'MISSION_TIMEOUT',
      reason: 'Mission exceeded allowed execution window or stalled.',
    };
  }
  if (/\b(quota|rate limit|429|provider|model unavailable|provider_unavailable|api key|authentication)\b/.test(source)) {
    return {
      category: 'provider_failure',
      code: 'PROVIDER_UNAVAILABLE',
      reason: 'Provider call failed due to availability, auth, or quota.',
    };
  }
  if (/\b(this\.snapshotfailure is not a function|preview runner internal|local preview failed:\s*this\.)\b/.test(source)) {
    return {
      category: 'preview_runner_internal_error',
      code: 'PREVIEW_RUNNER_INTERNAL',
      reason: 'Preview runner crashed due to an internal runtime error.',
    };
  }
  if (/\b(install exited with code|npm install failed|install timed out|eresolve|eoverride)\b/.test(source)) {
    return {
      category: 'dependency_install_failure',
      code: 'DEPENDENCY_INSTALL',
      reason: 'Generated app dependency installation failed.',
    };
  }
  if (
    /\b(import\/export mismatch|has no exported member|does not provide an export named|does not contain a default export|export .+ was not found in)\b/.test(source)
  ) {
    return {
      category: 'generated_import_export_mismatch',
      code: 'GENERATED_IMPORT_EXPORT_MISMATCH',
      reason: 'Generated application imports symbols that are not exported by target modules.',
    };
  }
  if (/(type error:|typescript error|ts\d{4}\b|has no exported member|is not assignable to type|does not exist on type)/.test(source)) {
    return {
      category: 'generated_typescript_error',
      code: 'GENERATED_TYPESCRIPT',
      reason: 'Generated application contains TypeScript type errors.',
    };
  }
  if (/\b(build failed|run build exited code|failed to compile|next build|vite build)\b/.test(source)) {
    return {
      category: 'generated_app_build_failure',
      code: 'GENERATED_BUILD',
      reason: 'Generated application failed to build.',
    };
  }
  if (/\b(no-document-import-in-page|export encountered an error on \/_(?:error|404|500)|static worker exited with code:\s*1)\b/.test(source)) {
    return {
      category: 'generated_app_build_failure',
      code: 'GENERATED_BUILD',
      reason: 'Generated application failed during Next.js static export/build.',
    };
  }
  const deterministicTier1Context =
    /\b(deterministic generation contract|deterministic-contract|tier1 runtime artifact policy|tier1-policy)\b/.test(source);
  if (
    deterministicTier1Context
    && /\b(tier1 runtime artifact policy|backend runtime artifact|tier1 scope violation|dropped tier1 backend runtime artifact)\b/.test(source)
  ) {
    return {
      category: 'tier1_scope_violation',
      code: 'TIER1_SCOPE_VIOLATION',
      reason: 'Tier 1 artifact scope includes backend/runtime files that must be excluded.',
    };
  }
  if (/\b(tier3_contract_missing|required contract artifacts missing|required contracts missing|missing contract artifact)\b/.test(source)) {
    return {
      category: 'tier3_contract_missing',
      code: 'TIER3_CONTRACT_MISSING',
      reason: 'Tier 3 contract-first flow is missing required contract artifacts.',
    };
  }
  if (/\b(module not found|cannot find module|dependency|package\.json|eoverride|eresolve)\b/.test(source)) {
    return {
      category: 'dependency_failure',
      code: 'DEPENDENCY_RESOLUTION',
      reason: 'Dependency graph or package manifest validation failed.',
    };
  }
  if (/\b(deterministic generation contract|deterministic-contract|dangling internal import|tier1 runtime artifact policy|runtime artifact policy)\b/.test(source)) {
    return {
      category: 'artifact_corruption',
      code: 'DETERMINISTIC_CONTRACT',
      reason: 'Deterministic artifact contract rejected the generated file set.',
    };
  }
  if (/\b(invalid file|integrity|corrupt|malformed|duplicate generated file path|no files were generated)\b/.test(source)) {
    return {
      category: 'artifact_corruption',
      code: 'ARTIFACT_INTEGRITY',
      reason: 'Generated artifacts were malformed, empty, or structurally invalid.',
    };
  }
  if (/\b(preview|dev server|preview-start|runtime validation)\b/.test(source)) {
    return {
      category: 'preview_failure',
      code: 'PREVIEW_BOOT',
      reason: 'Preview runtime failed to start or validate.',
    };
  }
  if (/\bexport\b/.test(source)) {
    return {
      category: 'export_failure',
      code: 'EXPORT_PIPELINE',
      reason: 'Export packaging failed.',
    };
  }
  if (/\b(orchestrator|pipeline|qa-gate|final-assembly|execution-validation)\b/.test(source)) {
    return {
      category: 'orchestration_failure',
      code: 'PIPELINE_ORCHESTRATION',
      reason: 'Pipeline orchestration failed during phase execution.',
    };
  }
  return {
    category: 'orchestration_failure',
    code: 'UNCLASSIFIED_PIPELINE_FAILURE',
    reason: 'Failure did not match a known classification rule; defaulted to orchestration_failure.',
  };
}
