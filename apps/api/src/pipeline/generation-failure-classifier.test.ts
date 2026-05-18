import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyGenerationFailure } from './generation-failure-classifier.js';

test('unmatched failures no longer classify as unknown', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'mystery-phase',
    failedStep: 'mystery-step',
    errorMessage: 'opaque failure signal',
  });
  assert.notEqual(out.category, 'unknown');
  assert.equal(out.category, 'orchestration_failure');
});

test('deterministic contract failures classify as artifact corruption', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'final-assembly',
    failedStep: 'final-assembly:deterministic-contract',
    errorMessage: 'Deterministic generation contract FAILED: dangling internal import: src/app/page.tsx',
  });
  assert.equal(out.category, 'artifact_corruption');
  assert.equal(out.code, 'DETERMINISTIC_CONTRACT');
});

test('install exited with code maps to dependency_install_failure', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'finalize',
    failedStep: 'finalize:execution-validation',
    errorMessage: 'install exited with code 1',
  });
  assert.equal(out.category, 'dependency_install_failure');
  assert.equal(out.code, 'DEPENDENCY_INSTALL');
});

test('generated type error maps to generated_typescript_error', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'finalize',
    failedStep: 'preview:building',
    errorMessage: 'Type error: Type "{ id: string; }" is not assignable to type "number".',
  });
  assert.equal(out.category, 'generated_typescript_error');
  assert.equal(out.code, 'GENERATED_TYPESCRIPT');
});

test('named export mismatch maps to generated_import_export_mismatch', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'finalize',
    failedStep: 'finalize:completed',
    errorMessage: 'Type error: Module "@/lib/api-client" has no exported member fetcher',
  });
  assert.equal(out.category, 'generated_import_export_mismatch');
  assert.equal(out.code, 'GENERATED_IMPORT_EXPORT_MISMATCH');
});

test('deterministic import/export mismatch signal maps to generated_import_export_mismatch', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'final-assembly',
    failedStep: 'final-assembly:deterministic-contract',
    errorMessage: "import/export mismatch: src/app/profile/ProfileContent.tsx imports {fetcher} from '@/lib/api-client'",
  });
  assert.equal(out.category, 'generated_import_export_mismatch');
});

test('local preview build failure with Type error stays generated_typescript_error', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'finalize',
    failedStep: 'finalize:completed',
    errorMessage:
      'Local preview failed: build failed: npm run build exited code=1 - ./src/app/404.tsx:25:21 | Type error: Property "as" does not exist on type ButtonProps',
  });
  assert.equal(out.category, 'generated_typescript_error');
  assert.equal(out.code, 'GENERATED_TYPESCRIPT');
});

test('preview internal crash maps to preview_runner_internal_error', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'preview',
    failedStep: 'preview:building',
    errorMessage: 'Local preview failed: this.snapshotFailure is not a function',
  });
  assert.equal(out.category, 'preview_runner_internal_error');
  assert.equal(out.code, 'PREVIEW_RUNNER_INTERNAL');
});

test('tier1 backend path violation maps to tier1_scope_violation', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'final-assembly',
    failedStep: 'final-assembly:deterministic-contract',
    errorMessage: 'tier1 runtime artifact policy: dropped backend runtime artifact apps/api/src/server.ts',
  });
  assert.equal(out.category, 'tier1_scope_violation');
  assert.equal(out.code, 'TIER1_SCOPE_VIOLATION');
});

test('tier3 missing contracts maps to tier3_contract_missing', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'tier3-contract-first',
    failedStep: 'contract_validating',
    errorMessage: 'tier3_contract_missing: required contract artifacts missing: src/contracts/api-contract.ts',
  });
  assert.equal(out.category, 'tier3_contract_missing');
  assert.equal(out.code, 'TIER3_CONTRACT_MISSING');
});

test('generic backend path mention without deterministic tier1 context does not map to tier1_scope_violation', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'slice-1',
    failedStep: 'builder',
    errorMessage: 'cannot read file apps/api/src/server.ts',
  });
  assert.notEqual(out.category, 'tier1_scope_violation');
});

test('specific dependency install failures are not swallowed by orchestration matcher', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'orchestrator',
    failedStep: 'pipeline',
    errorMessage: 'install exited with code 1',
  });
  assert.equal(out.category, 'dependency_install_failure');
});

test('filesystem permission failures map to filesystem_permission_failure', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'finalize',
    failedStep: 'project-store:write',
    errorMessage: "EPERM: operation not permitted, rename 'project.json.tmp' -> 'project.json'",
  });
  assert.equal(out.category, 'filesystem_permission_failure');
  assert.equal(out.code, 'FILESYSTEM_PERMISSION');
});

test('project-store persistence failures map to project_persistence_failure', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'finalize',
    failedStep: 'project-store:write-failed',
    errorMessage: 'project persistence failed: atomicWriteJson could not persist project.json',
  });
  assert.equal(out.category, 'project_persistence_failure');
  assert.equal(out.code, 'PROJECT_PERSISTENCE');
});

test('project persistence classification wins over timeout keyword', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'pipeline',
    failedStep: 'queued',
    errorMessage: 'mission timeout after 420000ms; project persistence failed: project.json missing',
  });
  assert.equal(out.category, 'project_persistence_failure');
});

test('next static export no-document failure maps to generated_app_build_failure', () => {
  const out = classifyGenerationFailure({
    failedPhase: 'finalize',
    failedStep: 'preview',
    errorMessage: 'Export encountered an error on /_error: /500; no-document-import-in-page; Static worker exited with code: 1',
  });
  assert.equal(out.category, 'generated_app_build_failure');
  assert.equal(out.code, 'GENERATED_BUILD');
});
