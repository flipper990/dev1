# TypeScript Error Classification Report

## Existing classification path
`classifyGenerationFailure(...)` already mapped TypeScript signatures to `generated_typescript_error`.

## Issue found
A realistic string `Type error:` could still be missed when coupled with `build failed ...` due regex boundary behavior, causing misclassification to `generated_app_build_failure`.

## Fix
Updated classifier regex in:
- `apps/api/src/pipeline/generation-failure-classifier.ts`

Change:
- TypeScript matcher now includes:
  - `type error:`
  - `typescript error`
  - `tsNNNN`
  - `has no exported member`
  - `is not assignable to type`
  - `does not exist on type`

## Verification
Added/updated test in:
- `apps/api/src/pipeline/generation-failure-classifier.test.ts`

Case verified:
- `Local preview failed: build failed: ... Type error: ...` => `generated_typescript_error` (not orchestration, not generic build).
