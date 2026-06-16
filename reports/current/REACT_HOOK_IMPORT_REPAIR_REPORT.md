# React Hook Import Repair Report

## Objective
Ensure React hooks are never imported from `@/lib/api-client` or other local modules in deterministic generation output.

## Hook list enforced
- `useEffect`
- `useState`
- `useMemo`
- `useCallback`
- `useRef`
- `useReducer`
- `useContext`
- `useTransition`
- `useDeferredValue`
- `useId`

## Repair behavior
- If a file imports these hooks from non-`react` local modules:
  - hooks are rewritten to `import { ... } from 'react'`
  - valid local/api-client symbols are preserved in their original module import
  - if no local symbols remain, that local import is removed
- Existing `react` import is merged (not duplicated).

## Validation hardening
- Slice validator now flags:
  - `react_hook_wrong_source`
  - non-canonical named imports from `@/lib/api-client`
- Deterministic contract now emits structured mismatch fields in unrecoverable cases:
  - `failedFile`, `invalidImportName`, `importedFrom`, `expectedSource`, `repairAttempted`, `repairResult`

## Targeted tests added/updated
- `apps/api/src/pipeline/deterministic-generation-contract.test.ts`
  - mixed import split: `{ useEffect, fetcher }` from api-client -> hook moved to `react`, `fetcher` preserved
  - wrong-local hook import moved to `react`
  - invalid api-client import mismatch contains required structured fields
- `apps/api/src/pipeline/tier-slice-validator.test.ts`
  - early rejection for hook imported from non-`react`
  - early rejection for non-canonical api-client symbol

## Guardrails respected
- No auth, DB, provider config, preview cache, or tier routing implementation changes were made.
