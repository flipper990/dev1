# Targeted Test Results

Date: 2026-05-17
Scope: Tier 1 regression work, tasks through targeted validation.

## Deterministic Contract Tests
Command:
`npx tsx --test src/pipeline/deterministic-generation-contract.test.ts ...`
Included suites:
- deterministic-generation-contract
- import-repair
- final-integrity-gate
- terminal-state-consistency
- failure-diagnostics
- mission-failure-diagnostics
- mission-terminal-sync
- safe-path
- dependency-reconciliation

Result:
- 42 passed
- 0 failed

## Import Repair Tests
Included in command above.
Result: pass.

## Artifact Integrity Tests
Included in command above (`final-integrity-gate`, dependency reconciliation related checks).
Result: pass.

## Terminal Consistency Tests
Included in command above (`terminal-state-consistency`, `mission-terminal-sync`).
Result: pass.

## Failure Diagnostics Tests
Included in command above (`failure-diagnostics`, `mission-failure-diagnostics`).
Result: pass.

## Fast Contract Tests
Command:
`npm run test:contracts:fast`
Result: `[contract-fast-check] ok`.

## Package Tests
Command:
`npm run test:package:unit`
Result:
- 6 passed
- 0 failed

## Conclusion
All required targeted validation categories passed in this restarted run.
