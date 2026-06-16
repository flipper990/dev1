export type FailureCategory =
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
  | 'generated_component_prop_mismatch'
  | 'generated_typescript_error'
  | 'preview_runner_internal_error'
  | 'project_persistence_failure'
  | 'filesystem_permission_failure'
  | 'tier1_scope_violation'
  | 'tier3_contract_missing'
  | 'unknown';

export type QualityTerminalStatus =
  | 'completed_full_quality'
  | 'completed_degraded'
  | 'failed_recoverable'
  | 'failed_unrecoverable';

const RECOVERABLE_FAILURES: FailureCategory[] = [
  'provider_failure',
  'timeout',
  'dependency_install_failure',
  'preview_failure',
  'project_persistence_failure',
  'filesystem_permission_failure',
];

export function deriveQualityTerminalStatus(input: {
  generated: boolean;
  fallbackUsed: boolean;
  failureCategory?: FailureCategory | null;
}): QualityTerminalStatus {
  if (input.generated) {
    return input.fallbackUsed ? 'completed_degraded' : 'completed_full_quality';
  }
  if (input.failureCategory && RECOVERABLE_FAILURES.includes(input.failureCategory)) {
    return 'failed_recoverable';
  }
  return 'failed_unrecoverable';
}
