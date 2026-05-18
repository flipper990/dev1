# Next Fix Priority

## Highest-Impact Next Fixes (Measured-Data Driven)

1. **Restore API runtime dependency baseline (P0)**
- Ensure PostgreSQL for API is reachable on the configured endpoint (`DATABASE_URL`) and has valid credentials.
- Success check: `GET /health` returns 200 consistently.

2. **Lock deterministic test environment for E2E (P0)**
- Standardize local test DB endpoint/credentials used by `test:missions:e2e` so API startup is deterministic.
- Success check: E2E runner starts and creates mission IDs before first prompt.

3. **Rerun tiered mission validation immediately after runtime fix (P0)**
- Execute: `npm --workspace @devteam/api run test:missions:e2e`
- Only after this run, evaluate Tier 1 stability target (minimum 8/10 before broader focus).

## Rule Application
- Tier 1 is currently not measurable because mission execution is blocked.
- Per rule, focus remains on enabling Tier 1 validation first.
