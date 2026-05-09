# Rollback-Safe Checks

## Purpose
Ensure rollout flags can be disabled quickly without losing app operability.

## Command
- `npm run test:smoke:rollback`

## Cases
1. Legacy shell + workspace + status system disabled.
2. New shell + workspace + status system enabled.

## Assertions
- Pages render expected markers for each variant.
- Workspace remains usable in both modes.

## Operational note
Run this check before and after any canary expansion.
