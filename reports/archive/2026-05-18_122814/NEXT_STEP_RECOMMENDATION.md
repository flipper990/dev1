# Next Step Recommendation

Date: 2026-05-17

## Immediate Priority
Investigate and fix `finalize: install exited with code 1` cluster (9/10 in latest rerun).

## Secondary Priority
Investigate QA-gate blocker case (score 90/100 with blocker=1) to ensure deterministic pass/fail diagnostics and recovery behavior.

## Guardrails
- Do not move to Tier 2.
- Keep scope limited to Tier 1 reliability path.
- Do not loosen validation blindly.

## Revalidation Plan
1. Add/adjust deterministic tests around finalize install failure classification and persistence.
2. Run targeted suite.
3. Re-run the same 10 Tier 1 prompts.
4. Lock only if >=9/10.
