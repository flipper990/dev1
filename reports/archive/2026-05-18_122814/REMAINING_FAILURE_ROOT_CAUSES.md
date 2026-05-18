# Remaining Failure Root Causes

## Measured Failures in This Validation Attempt

### 1) API cannot start due DB endpoint mismatch
- Frequency: 1/1 blocking attempt
- Affected tier: all tiers (global blocker)
- Exact diagnostic:
  - `connect ECONNREFUSED 127.0.0.1:55432`
- Recommended fix:
  - Start PostgreSQL on configured port `55432` OR update `DATABASE_URL` to the correct running instance and credentials.
- Priority: P0

### 2) PostgreSQL authentication invalid for available local DB
- Frequency: 1/1 blocking attempt
- Affected tier: all tiers (global blocker)
- Exact diagnostic:
  - `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string`
  - `28P01 password authentication failed for user "devteam"`
- Recommended fix:
  - Provide valid credentials for the intended DB user in `DATABASE_URL`.
  - Verify target DB `devteam` exists and auth method is compatible.
- Priority: P0

### 3) E2E runner preflight fails because API is unreachable
- Frequency: 1/1 blocking attempt
- Affected tier: all tiers
- Exact diagnostic:
  - `successful-mission-e2e failed: fetch failed`
- Recommended fix:
  - Resolve API startup blockers first; rerun tiered missions after `/health` is 200.
- Priority: P0

## Root-Cause Cluster Summary
- Runtime infrastructure blockers: 3
- Generation/runtime product pipeline failures: not measurable in this run (no missions executed).
