# Targeted Test Results

## Commands run
1. `npm exec --workspace=@devteam/api -- tsx --test src/pipeline/ui-foundation.test.ts src/pipeline/tier-slice-validator.test.ts src/pipeline/deterministic-generation-contract.test.ts src/pipeline/generation-failure-classifier.test.ts src/pipeline/import-repair.test.ts src/pipeline/orchestration-router.test.ts src/pipeline/prompt-tier-classifier.test.ts`
2. `npm run test:contracts:fast --workspace=@devteam/api`
3. `npm run test:package:unit --workspace=@devteam/api`
4. `npm run typecheck --workspace=@devteam/api`
5. `npm run build --workspace=@devteam/api`

## Results
- Command 1:
  - initial run: 80/81 pass (1 classifier assertion mismatch)
  - after classifier matcher adjustment: **81/81 PASS**
- Command 2: **PASS**
- Command 3: **PASS** (`6/6`)
- Command 4: **PASS**
- Command 5: **PASS**

## Coverage confirmation
- UI foundation/sanitizer tests: included and passing.
- Tier slice validator tests: included and passing (with new `component_prop_mismatch` case).
- Deterministic contract tests: included and passing (including callback-prop repair + unrecoverable fail path).
- Failure classifier tests: included and passing (new `generated_component_prop_mismatch` classification cases).
- Import/export validation tests: included and passing (`import-repair.test.ts`).
- Tier routing classifier non-regression: included and passing (`orchestration-router.test.ts`, `prompt-tier-classifier.test.ts`).
