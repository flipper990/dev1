# Failed Run Cluster Report

## Cluster Summary (Latest 30 Failed Projects)

| Rank | Root Cause Cluster | Frequency | Affected Phase(s) | Prompt Class Impacted |
|---|---|---:|---|---|
| 1 | Builder empty/unusable output (`builder produced no files`, truncation, invalid payload) | 15 | slice build/rebuild | landing, CRUD, auth, complex/full-stack |
| 2 | Missing error envelope (`error` empty in failed record) | 5 | mixed (mostly generation/preview) | landing, CRUD, auth |
| 3 | Missing deterministic infra (`MISSING_PACKAGE_JSON`) | 3 | slice merge integrity | landing, CRUD, auth |
| 4 | Watchdog no-progress timeout | 2 | build step | CRUD/auth medium complexity |
| 5 | Hard contract violations (dangling import, empty source, QA score mismatch) | 3 (1+1+1) | final-integrity-gate / qa-gate / slice-merge | landing, CRUD |

## Preview-Path Clusters (From `last-preview-*.json`)
- Preview boot timeout/build hung: 1
- Local install failure (environment + generated surface fragility): 1

## Recommended Fixes by Cluster

1. Builder empty/unusable output
- Fix: strict builder output schema + deterministic manifest + contract-based fallback patching.
- Implemented: yes.
- Estimated success-rate impact: +18 to +28 points on simple/medium missions.

2. Missing deterministic infra
- Fix: golden-path base template enforced every slice + final assembly; AI no longer owns core infra files.
- Implemented: yes.
- Estimated impact: +10 to +18 points.

3. Hard contract violations (imports/empty files/layout drift)
- Fix: deterministic generation contract with blocking validation and import-integrity checks pre-finalization.
- Implemented: yes.
- Estimated impact: +8 to +14 points.

4. Watchdog/no-progress
- Fix: reduce generation freedom + stable scaffold baseline to avoid iterative dead loops.
- Implemented: partially (generation-side). No extra generic retries added.
- Estimated impact: +4 to +8 points.

5. Preview-path instability
- Fix: build-first loop with typecheck enabled and diagnostic-driven repair path retained.
- Implemented: strengthened existing execution loop config.
- Estimated impact: +5 to +10 points.

## Notes
- Provider quota/model endpoint errors also appear in historical data, but those are external capacity/config issues, not generation-contract design failures.

## Top 5 Failure Causes (Generation-Centric)

| Cause | Frequency (recent failed set) | Affected Phase | Affected Prompt Class | Recommended Fix | Estimated Success Impact |
|---|---:|---|---|---|---|
| Builder returned unusable/empty artifacts | 15 | slice build/rebuild | all classes | Strict builder schema + mandatory manifest + deterministic fallback patching | +18–28 pts |
| Missing deterministic infra (`package.json`/scripts) | 3 | slice merge | landing/CRUD/auth | Golden-path template baseline at slice + final | +10–18 pts |
| Contract-breaking artifacts (dangling import / empty source / placeholder) | 3 | final-integrity-gate / slice-merge | landing/CRUD | Final deterministic contract gate (blocking) | +8–14 pts |
| No-progress build loops | 2 | build/watchdog | medium/complex | Reduce infra AI freedom + deterministic baseline | +4–8 pts |
| Preview runtime instability (timeout/install failure) | 2 | preview build/install | landing/simple | Build-first validation with typecheck + diagnostic repair | +5–10 pts |

## Exact Failure Categories Requested
- Empty generation: observed (`builder produced no files`, `EMPTY_SOURCE_FILE`).
- Bad prompt decomposition: observed in mixed tree / placeholder-heavy outputs where phase scope drifted.
- Invalid file tree: observed (`app/*` + `src/app/*` mixed, missing targets).
- Missing imports: observed (dangling internal import in final integrity gate).
- Bad package dependencies: observed in generated outputs requiring deterministic package fixes.
- Invalid generated code: observed (incomplete JSX, empty file payloads).
- Preview install failure: observed (`npm install` failed in local preview run).
- Timeout: observed (`preview:building` timeout, watchdog no-progress).
- Artifact assembly failure: observed (integrity gate failures).
- Model output format drift: observed (truncated/invalid builder payload discarded).
