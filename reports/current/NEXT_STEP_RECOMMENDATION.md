# Next Step Recommendation

1. Keep current Button-contract + build-diagnostics fixes.
2. Address next narrow deterministic blocker surfaced by Canary-3:
- enforce canonical `src/lib/api-client` export contract (or deterministic import repair rewrite) so generated usage of `fetcher`/`postJson` cannot drift.
3. Add targeted contract test for dashboard profile page pattern:
- generated import from `@/lib/api-client` must match canonical exports before preview build.
4. Re-run constrained 3-prompt canary after that single fix.

No auth/db/provider/proxy changes are required for this next step.
