# TypeScript Generation Fix Report

## Objective
Fix the generated TypeScript contract failure at generator/validation layer (not by patching generated output directly).

## Fix implemented
- File: `apps/api/src/pipeline/ui-foundation.ts`
- Added deterministic repair: `repairBrokenDashboardActivityItemContract(fileMap)`
  - Trigger condition:
    - `src/components/dashboard/ActivityFeed.tsx` exists and uses `<ActivityItem activity={...} />`
    - `src/components/dashboard/ActivityItem.tsx` exists and does **not** support `activity` in props contract
  - Repair action:
    - Rewrite `ActivityItem.tsx` to a deterministic, compile-safe contract supporting both:
      - `activity?: ActivityRecord`
      - `item?: ActivityRecord`
    - Keeps compatibility for either call style and prevents TS prop mismatch from reaching preview build.
- Integrated into sanitizer flow:
  - `sanitizeUIFoundation` now calls `repairBrokenDashboardActivityItemContract`.

## Related hardening retained
- Existing in-flight hardening kept:
  - stricter `repairBrokenButtonContract`
  - stricter `repairBrokenAlertContract`

## Why this is safe/minimal
- Narrowly scoped to dashboard `ActivityFeed`/`ActivityItem` mismatch signature.
- No changes to preview observability, cache optimization, tier routing, auth/DB/provider/proxy/UI/file-loss safeguards.
- Deterministic and idempotent sanitizer behavior.
