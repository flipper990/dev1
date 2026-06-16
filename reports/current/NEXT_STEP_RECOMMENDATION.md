# Next Step Recommendation

## Single safest next step
Implement a deterministic generated build-quality guard/repair pass for strict ESLint TypeScript policies (`no-explicit-any`, `ban-ts-comment`) in emitted shared utility files before preview build.

## Why this is the safest next action
- Component prop-mismatch class is now covered by deterministic repair/validation and targeted tests.
- The one-prompt rerun no longer failed on the original logout prop-contract signature.
- Latest blocker is now a consistent build-quality class (`generated_app_build_failure`) driven by strict lint/type policy violations in generated files.
- Fixing this quality guard is the narrowest direct unblock for the same prompt path.

## Scope guardrails for next pass
- Keep changes in generation/repair/validation layers.
- Do not change auth/DB/provider config/preview cache/tier routing unless directly required for this build-quality guard.
- Re-validate with the same single dashboard prompt after targeted tests.
